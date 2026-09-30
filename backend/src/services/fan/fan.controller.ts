import type { FanStateRepository, FanEventsRepository, FanEvent } from '../../db/repositories';
import type { FanState, FanStatus, FanEventKind, ShellyMonitorMessage, InterferenceCause } from './types';

/** Who asked for a switch, or who is telling us the state changed. */
type FanEventSource = 'user' | 'shelly' | 'backend' | 'auto';
/** Callers of `command()`: never 'shelly' — that source only ever arises internally, from a monitor message. */
type CommandSource = 'user' | 'backend' | 'auto';

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
  /**
   * Notified when the contactor moved outside our control: a `warning`
   * (`local_switch`) or an `alert` / `safety_shutoff` (`fault`). Deliberately
   * not fired for `watchdog_off` (design spec §5.5). Set by the automation
   * service, wired through `FanControlManager` — `FanController` itself does
   * not know who is listening.
   */
  onInterference?: (cause: InterferenceCause) => void;
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
  /** Whether the fan control currently answers; null = not yet heard from. */
  private fanControlReachable: boolean | null = null;
  /** Whether the contactor's auxiliary contact is closed; null = not yet heard from. */
  private contactorEngaged: boolean | null = null;
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
      this.log('recovery', { resumedDesiredOn: true }, 'backend');
      this.beginTurnOn('backend', false, persisted.since);
    }
  }

  /**
   * Switch request. `source` records who asked: the API passes the default,
   * the manager passes 'backend' when it switches a fan off on retirement,
   * and the automation service (a later task) will pass 'auto'.
   *
   * An `off` while the desired state is already false has nothing to wait
   * for — the Shelly's output does not need to move — so it does not enter
   * TURN_OFF_PENDING; see `turnOffImmediately`.
   */
  command(action: 'on' | 'off', source: CommandSource = 'user'): void {
    if (action === 'on') {
      this.beginTurnOn(source, true, this.now().toISOString());
    } else if (this.desiredOn) {
      this.beginTurnOff(source);
    } else {
      this.turnOffImmediately(source);
    }
  }

  /**
   * Processes a Shelly monitor message. success(on) confirms the pending switch;
   * a warning stands the desired state down (§5.6/§6 of the automation-core
   * design); alert/safety_shutoff drive a FAULT.
   */
  handleShellyMessage(msg: ShellyMonitorMessage): void {
    const ts = this.now().toISOString();
    // Fed from every message, and from `inputState` specifically: it is the
    // auxiliary contact in all four, whereas `switchState` carries the last
    // *commanded* output during a warning/alert, not the relay's real state.
    this.contactorEngaged = msg.inputState;
    switch (msg.type) {
      case 'success':
        this.log('success', msg, 'shelly');
        this.clearWatchdog();
        // The device confirms it reached the commanded state, so any earlier
        // warning or alert describes a condition that has since resolved.
        // Clearing them keeps the card showing the situation now; the event
        // log keeps the record that they occurred.
        this.lastWarning = null;
        this.lastAlert = null;
        if (msg.switchState) {
          this.setState('ON');
          this.ensureKeepAlive();
        } else {
          this.setState('OFF');
          this.clearKeepAlive();
        }
        break;
      case 'warning': {
        this.lastWarning = { message: msg.message, ts };
        this.log('warning', msg, 'shelly');
        // The contactor moved without our command: stand down rather than
        // fight it (the backend cannot open a contactor held by hand), then
        // report what the device just told us instead of a pending state we
        // could never leave (design spec §5.6). The state machine must be
        // left consistent — reported state set, listeners notified — before
        // the interference callback (foreign code, contained below) runs.
        this.turnOffImmediately('shelly');
        this.setState(msg.inputState ? 'ON' : 'OFF');
        this.notifyInterference('local_switch');
        break;
      }
      case 'alert':
        this.lastAlert = { message: msg.message, ts };
        this.log('alert', msg, 'shelly');
        this.enterFault();
        this.notifyInterference('fault');
        break;
      case 'safety_shutoff':
        this.lastAlert = { message: msg.message, ts };
        this.log('safety_shutoff', msg, 'shelly');
        this.enterFault();
        this.notifyInterference('fault');
        break;
    }
  }

  /** Logs the Shelly's generic status update (authoritative output state) for the audit trail. */
  handleStatus(raw: string): void {
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* keep raw string */ }
    this.log('status', payload, 'shelly');
  }

  /**
   * Updates the reachability overlay; logs only real changes.
   *
   * The device reports this by staying connected to the broker, so a loss
   * surfaces only once the broker gives up on it — a multiple of the device's
   * own keep-alive interval, which is configured on the device and not visible
   * from here. Reachable therefore means "was answering recently", not "is
   * answering this second".
   *
   * `online_change` is kept as the recorded event kind: it names an internal
   * audit entry, not part of the published status.
   */
  handleReachability(reachable: boolean): void {
    if (this.fanControlReachable === reachable) return;
    this.fanControlReachable = reachable;
    this.log('online_change', { online: reachable }, 'shelly');
    this.emit();
  }

  /** Current status snapshot (state + overlays), as returned by the API and pushed over SSE. */
  getStatus(): FanStatus {
    return {
      stockId: this.deps.stockId,
      state: this.state,
      desiredOn: this.desiredOn,
      fanControlReachable: this.fanControlReachable,
      contactorEngaged: this.contactorEngaged,
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
  private beginTurnOn(source: CommandSource, persist: boolean, since: string | null): void {
    this.desiredOn = true;
    this.since = since;
    if (persist) this.persistState();
    this.setState('TURN_ON_PENDING');
    this.log('command', { action: 'on' }, source);
    this.deps.publish('on');
    this.armWatchdog();
    this.ensureKeepAlive();
  }

  /** Enters TURN_OFF_PENDING, stops timers, publishes 'off'. Only reachable while desiredOn is true — there is a 'success' to wait for. */
  private beginTurnOff(source: CommandSource = 'user'): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('TURN_OFF_PENDING');
    this.log('command', { action: 'off' }, source);
    this.deps.publish('off');
  }

  /**
   * Releases the desired state and timers without waiting for an
   * acknowledgement, so it never enters TURN_OFF_PENDING. The only exit from
   * that state is a `success`, and neither caller here can ever receive one:
   * an `off` on an already-off fan changes nothing on the Shelly's output for
   * it to confirm, and a local switch bypasses the Shelly's relay entirely, so
   * no status event, no grace timer and no acknowledgement follow (design
   * spec §5.6, §6).
   *
   * Publishes, persists and logs the command row. What gets reported is the
   * caller's business — this method never touches `state` itself; the
   * warning handler sets it explicitly from `inputState` right afterwards,
   * while an ordinary already-off `off` leaves it exactly as it stands.
   */
  private turnOffImmediately(source: FanEventSource): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
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
  private log(kind: FanEventKind, payload: unknown, source: FanEventSource): void {
    this.deps.eventsRepo.insert({
      stockId: this.deps.stockId,
      ts: this.now().toISOString(),
      kind,
      payload,
      source,
    });
  }

  /**
   * Notifies the interference callback, if one is wired. Its future
   * implementation (the automation service's self-disable) writes a flag and
   * an event row — a database call that can throw — and by the time this
   * runs the state machine already reflects the interference (published,
   * persisted, reported), so a throw here must not escape into it: nothing
   * above `handleShellyMessage` catches it, and it would otherwise reach the
   * MQTT client uncaught. Mirrors the containment `emit()` applies below.
   */
  private notifyInterference(cause: InterferenceCause): void {
    if (!this.deps.onInterference) return;
    try {
      this.deps.onInterference(cause);
    } catch (error) {
      console.error(`Fan control: an interference listener for ${this.deps.stockId} threw`, error);
    }
  }

  /** Pushes the current status to all subscribers. */
  private emit(): void {
    const status = this.getStatus();
    // Snapshot: a listener may unsubscribe from inside its own notification
    // (an SSE stream tearing down on retirement does exactly that), which would
    // shift the array underneath the loop and skip the next listener.
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch (error) {
        // Subscribers do real work — an SSE push reads the event log and writes
        // to a socket. A throw must not escape into the state machine: it runs
        // between the state change and the MQTT publish, so it would swallow
        // the very command being issued.
        console.error(`Fan control: a status subscriber for ${this.deps.stockId} threw`, error);
      }
    }
  }
}
