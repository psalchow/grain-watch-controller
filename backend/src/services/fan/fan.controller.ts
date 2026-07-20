import type { FanStateRepository, FanEventsRepository, FanEvent } from '../../db/repositories';
import type { FanState, FanStatus, FanEventKind, ShellyMonitorMessage } from './types';

export interface FanControllerDeps {
  /** Stock (Halle) this controller drives. */
  stockId: string;
  /** Sends the switch command to the Shelly (wired to its MQTT command topic). */
  publish: (payload: 'on' | 'off') => void;
  /** Persists the desired state so it survives a backend restart (recovery). */
  stateRepo: FanStateRepository;
  /** Append-only log of commands and Shelly feedback, per stock. */
  eventsRepo: FanEventsRepository;
  /** keepAliveMs: interval to re-assert 'on'; watchdogMs: deadline to receive a success ack. */
  timings: { keepAliveMs: number; watchdogMs: number };
  /** Injectable clock for deterministic tests; defaults to real time. */
  now?: () => Date;
}

/** Notified with the latest status on every state/overlay change (drives SSE). */
type ChangeListener = (status: FanStatus) => void;

/**
 * Per-stock fan state machine. Owns desired state, watchdog and keep-alive
 * timers, consumes Shelly monitor messages, and persists an event log.
 */
export class FanController {
  private readonly deps: FanControllerDeps;
  private readonly now: () => Date;
  /** Reported lifecycle state (what the UI shows). */
  private state: FanState = 'OFF';
  /** What the fan should be — source of truth for keep-alive and recovery. */
  private desiredOn = false;
  /** When desiredOn last became true (null while off). */
  private since: string | null = null;
  /** Latest Shelly online/offline (LWT); null = not yet known. */
  private shellyOnline: boolean | null = null;
  /** Last unsolicited-switching warning (overlay, independent of state). */
  private lastWarning: { message: string; ts: string } | null = null;
  /** Last contactor-failure alert / safety shutoff (overlay, independent of state). */
  private lastAlert: { message: string; ts: string } | null = null;
  /** Timestamp of the last state change. */
  private updatedAt: string;
  /** Deadline timer: switch off + FAULT if no success ack arrives in time. */
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Interval timer: re-assert 'on' before the Shelly's 1 h auto-off fires. */
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Active change subscribers (e.g. open SSE streams). */
  private readonly listeners: ChangeListener[] = [];

  constructor(deps: FanControllerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.updatedAt = this.now().toISOString();
  }

  /** On startup: if the persisted desired state was 'on', resume driving the fan. */
  recover(): void {
    const persisted = this.deps.stateRepo.get(this.deps.stockId);
    if (persisted?.desiredOn) {
      this.since = persisted.since;
      this.log('recovery', { resumedDesiredOn: true }, 'backend');
      this.beginTurnOn('backend', false);
    }
  }

  /** User-initiated switch request from the API. */
  command(action: 'on' | 'off', source: 'user'): void {
    if (action === 'on') {
      this.since = this.now().toISOString();
      this.beginTurnOn(source, true);
    } else {
      this.beginTurnOff(source);
    }
  }

  /**
   * Processes a Shelly monitor message. success(on) confirms the pending switch;
   * warning is logged as an overlay only; alert/safety_shutoff drive a FAULT.
   */
  handleShellyMessage(msg: ShellyMonitorMessage): void {
    const ts = this.now().toISOString();
    switch (msg.type) {
      case 'success':
        this.log('success', msg, 'shelly');
        this.clearWatchdog();
        if (msg.switchState) {
          this.setState('ON');
          this.ensureKeepAlive();
        } else {
          this.setState('OFF');
          this.clearKeepAlive();
        }
        break;
      case 'warning':
        this.lastWarning = { message: msg.message, ts };
        this.log('warning', msg, 'shelly');
        this.emit();
        break;
      case 'alert':
        this.lastAlert = { message: msg.message, ts };
        this.log('alert', msg, 'shelly');
        this.enterFault();
        break;
      case 'safety_shutoff':
        this.lastAlert = { message: msg.message, ts };
        this.log('safety_shutoff', msg, 'shelly');
        this.enterFault();
        break;
    }
  }

  /** Logs the Shelly's generic status update (authoritative output state) for the audit trail. */
  handleStatus(raw: string): void {
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* keep raw string */ }
    this.log('status', payload, 'shelly');
  }

  /** Updates the online overlay from the Shelly's retained LWT; logs only real changes. */
  handleOnline(online: boolean): void {
    if (this.shellyOnline === online) return;
    this.shellyOnline = online;
    this.log('online_change', { online }, 'shelly');
    this.emit();
  }

  /** Current status snapshot (state + overlays), as returned by the API and pushed over SSE. */
  getStatus(): FanStatus {
    return {
      stockId: this.deps.stockId,
      state: this.state,
      desiredOn: this.desiredOn,
      shellyOnline: this.shellyOnline,
      lastWarning: this.lastWarning,
      lastAlert: this.lastAlert,
      since: this.since,
      updatedAt: this.updatedAt,
    };
  }

  /** Most recent switching/feedback log entries for this stock, newest first. */
  getRecentEvents(limit: number): FanEvent[] {
    return this.deps.eventsRepo.listRecent(this.deps.stockId, limit);
  }

  /** Subscribes to status changes; returns an unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Releases timers (watchdog + keep-alive); called on shutdown. Does not switch the fan off. */
  stop(): void {
    this.clearWatchdog();
    this.clearKeepAlive();
  }

  // --- internals ---

  /** Enters TURN_ON_PENDING, publishes 'on', arms the watchdog and keep-alive. */
  private beginTurnOn(source: 'user' | 'backend', persist: boolean): void {
    this.desiredOn = true;
    if (persist) this.persistState();
    this.setState('TURN_ON_PENDING');
    this.log('command', { action: 'on' }, source);
    this.deps.publish('on');
    this.armWatchdog();
    this.ensureKeepAlive();
  }

  /** Enters TURN_OFF_PENDING, stops timers, publishes 'off'. */
  private beginTurnOff(source: 'user'): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('TURN_OFF_PENDING');
    this.log('command', { action: 'off' }, source);
    this.deps.publish('off');
  }

  /** Fail-safe: clears desired-on, stops timers, enters FAULT (no more re-asserts). */
  private enterFault(): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('FAULT');
  }

  /** (Re)starts the ack deadline: no success within watchdogMs -> switch off + FAULT. */
  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.deps.publish('off');
      this.log('watchdog_off', { reason: 'no success within watchdog window' }, 'backend');
      this.enterFault();
    }, this.deps.timings.watchdogMs);
  }

  /** Cancels the watchdog if armed. */
  private clearWatchdog(): void {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
  }

  /** Starts the keep-alive interval once (idempotent); re-publishes 'on' while desiredOn. */
  private ensureKeepAlive(): void {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (!this.desiredOn) return;
      this.deps.publish('on');
      this.log('command', { action: 'on', keepAlive: true }, 'backend');
    }, this.deps.timings.keepAliveMs);
  }

  /** Stops the keep-alive interval if running. */
  private clearKeepAlive(): void {
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
  }

  /** Transitions to a new state, stamps updatedAt, and notifies listeners. */
  private setState(next: FanState): void {
    this.state = next;
    this.updatedAt = this.now().toISOString();
    this.emit();
  }

  /** Writes the desired state to the DB so recover() can resume after a restart. */
  private persistState(): void {
    const nowIso = this.now().toISOString();
    this.deps.stateRepo.upsert({
      stockId: this.deps.stockId,
      desiredOn: this.desiredOn,
      since: this.since,
      lastCommandAt: nowIso,
      updatedAt: nowIso,
    });
  }

  /** Appends one entry to the per-stock event log. */
  private log(kind: FanEventKind, payload: unknown, source: 'user' | 'shelly' | 'backend'): void {
    this.deps.eventsRepo.insert({
      stockId: this.deps.stockId,
      ts: this.now().toISOString(),
      kind,
      payload,
      source,
    });
  }

  /** Pushes the current status to all subscribers. */
  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }
}
