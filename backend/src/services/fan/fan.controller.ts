import type { FanStateRepository, FanEventsRepository, FanEvent } from '../../db/repositories/fan.repository';
import type { FanState, FanStatus, FanEventKind, ShellyMonitorMessage } from './types';

export interface FanControllerDeps {
  stockId: string;
  publish: (payload: 'on' | 'off') => void;
  stateRepo: FanStateRepository;
  eventsRepo: FanEventsRepository;
  timings: { keepAliveMs: number; watchdogMs: number };
  now?: () => Date;
}

type ChangeListener = (status: FanStatus) => void;

/**
 * Per-hall fan state machine. Owns desired state, watchdog and keep-alive
 * timers, consumes Shelly monitor messages, and persists an event log.
 */
export class FanController {
  private readonly deps: FanControllerDeps;
  private readonly now: () => Date;
  private state: FanState = 'OFF';
  private desiredOn = false;
  private since: string | null = null;
  private shellyOnline: boolean | null = null;
  private lastWarning: { message: string; ts: string } | null = null;
  private lastAlert: { message: string; ts: string } | null = null;
  private updatedAt: string;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: ChangeListener[] = [];

  constructor(deps: FanControllerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.updatedAt = this.now().toISOString();
  }

  recover(): void {
    const persisted = this.deps.stateRepo.get(this.deps.stockId);
    if (persisted?.desiredOn) {
      this.since = persisted.since;
      this.log('recovery', { resumedDesiredOn: true }, 'backend');
      this.beginTurnOn('backend', false);
    }
  }

  command(action: 'on' | 'off', source: 'user'): void {
    if (action === 'on') {
      this.since = this.now().toISOString();
      this.beginTurnOn(source, true);
    } else {
      this.beginTurnOff(source);
    }
  }

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

  handleStatus(raw: string): void {
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* keep raw string */ }
    this.log('status', payload, 'shelly');
  }

  handleOnline(online: boolean): void {
    if (this.shellyOnline === online) return;
    this.shellyOnline = online;
    this.log('online_change', { online }, 'shelly');
    this.emit();
  }

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

  getRecentEvents(limit: number): FanEvent[] {
    return this.deps.eventsRepo.listRecent(this.deps.stockId, limit);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  stop(): void {
    this.clearWatchdog();
    this.clearKeepAlive();
  }

  // --- internals ---

  private beginTurnOn(source: 'user' | 'backend', persist: boolean): void {
    this.desiredOn = true;
    if (persist) this.persistState();
    this.setState('TURN_ON_PENDING');
    this.log('command', { action: 'on' }, source);
    this.deps.publish('on');
    this.armWatchdog();
    this.ensureKeepAlive();
  }

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

  private enterFault(): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('FAULT');
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.deps.publish('off');
      this.log('watchdog_off', { reason: 'no success within watchdog window' }, 'backend');
      this.enterFault();
    }, this.deps.timings.watchdogMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
  }

  private ensureKeepAlive(): void {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (!this.desiredOn) return;
      this.deps.publish('on');
      this.log('command', { action: 'on', keepAlive: true }, 'backend');
    }, this.deps.timings.keepAliveMs);
  }

  private clearKeepAlive(): void {
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
  }

  private setState(next: FanState): void {
    this.state = next;
    this.updatedAt = this.now().toISOString();
    this.emit();
  }

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

  private log(kind: FanEventKind, payload: unknown, source: 'user' | 'shelly' | 'backend'): void {
    this.deps.eventsRepo.insert({
      stockId: this.deps.stockId,
      ts: this.now().toISOString(),
      kind,
      payload,
      source,
    });
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }
}
