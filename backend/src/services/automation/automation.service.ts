import type {
  AutomationRepository,
  FanStateRepository,
  FanEventsRepository,
} from '../../db/repositories';
import type { Stock } from '../../db/types';
import type { DeviceReading, OutdoorReading } from '../influx';
import type { FanController } from '../fan';
import { automationAvailable } from '../fan';
import { offlineAfterMs, buildOutdoorConditions, summariseGrain } from '../conditions';
import { evaluate } from './evaluate';
import type { AutomationReadings, AutomationReason, FanTimingState } from './types';

/**
 * What the service knows about a stock's automation, and nothing more.
 *
 * `available` is deliberately absent: deriving it needs the stock row, every
 * route to one at this layer is asynchronous, and this snapshot has to be
 * synchronous — a listener firing inside an evaluation cannot await. The HTTP
 * layer composes `available` from the row it has fetched anyway (design spec
 * §3.2, §7.1).
 */
export interface AutomationState {
  enabled: boolean;
  reason: AutomationReason | null;
  evaluatedAt: string | null;
}

/** The four occasions on which automation switches itself off (design spec §5.5). */
export type DisableCause =
  | 'manual_command'
  | 'local_switch'
  | 'fault'
  | 'fan_control_withdrawn';

/** The two InfluxDB queries the cycle needs, both keyed on the device group. */
export interface AutomationReadingSource {
  getLatestReadings(deviceGroup: string): Promise<DeviceReading[]>;
  getOutdoorReading(deviceGroup: string): Promise<OutdoorReading>;
}

export interface AutomationServiceDeps {
  automationRepo: Pick<AutomationRepository, 'get' | 'upsert'>;
  /** Source of the switching timestamps; the automation keeps none of its own (design spec §3.3). */
  stateRepo: Pick<FanStateRepository, 'get'>;
  eventsRepo: Pick<FanEventsRepository, 'insert'>;
  readings: AutomationReadingSource;
  /**
   * The stock rows, re-read on every tick so a row edited underneath the
   * process takes effect without a restart — the shape `FanControlManager`
   * uses for `fanEnabledStockIds`.
   */
  listStocks: () => Promise<Stock[]>;
  /** Resolved per evaluation: a controller can be retired between two ticks. */
  getController: (stockId: string) => FanController | null;
  intervalMs: number;
  /** Injectable clock for deterministic tests; defaults to real time. */
  now?: () => Date;
}

/**
 * Consecutive failed reads treated as no data (design spec §5.3). Three ticks
 * of tolerance absorb an ordinary blip; beyond that the plant would be running
 * blind, which is the failure this automation exists to prevent.
 */
const READ_FAILURE_LIMIT = 3;

/** What rule 1 sees when the reads have failed often enough to count as no data. */
const NO_READINGS: AutomationReadings = {
  outdoorTempC: null,
  outdoorHumidityPct: null,
  dewPointC: null,
  outdoorOffline: true,
  grainMeanC: null,
  grainMinC: null,
};

/** The result of the last evaluation of one stock. */
interface LastEvaluation {
  reason: AutomationReason;
  evaluatedAt: string;
}

/**
 * Evaluates the control rule for every stock with automation available and
 * enabled, on a timer, and drives the existing `FanController` when the answer
 * differs from what the fan is doing (design spec §5.2 to §5.5).
 *
 * It owns no switching timestamps and no persisted decision: the minimum times
 * are measured against `fan_state`, and the change is measured against the
 * controller's own desired state, so a restart is corrected by the immediate
 * first evaluation rather than by stored state.
 */
export class AutomationService {
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastEvaluation = new Map<string, LastEvaluation>();
  private readonly readFailures = new Map<string, number>();
  private readonly listeners = new Map<string, Array<(state: AutomationState) => void>>();

  constructor(private readonly deps: AutomationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Evaluates every stock immediately, then on the configured interval. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runCycle(), this.deps.intervalMs);
    void this.runCycle();
  }

  /** Releases the timer. Does not switch any fan off — the controllers own that. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Evaluates one stock through the same path the cycle uses.
   *
   * Called when the user switches automation on: without it the stock would be
   * enabled but undecided until the next tick (design spec §5.2). Never
   * rejects — a failed evaluation must not fail the request that triggered it.
   */
  async evaluateStock(stockId: string): Promise<void> {
    let stock: Stock | undefined;
    try {
      stock = (await this.deps.listStocks()).find((s) => s.id === stockId);
    } catch (error) {
      console.error(`Automation: reading the row for ${stockId} failed`, error);
      return;
    }
    if (!stock) return;
    await this.evaluateSafely(stock);
  }

  /**
   * Switches automation off for a stock and records why.
   *
   * A transition, not an action: with `enabled` already false it writes
   * nothing. The four triggers arrive in bursts — a failing contactor publishes
   * `alert` and `safety_shutoff` together, somebody at the contactor produces a
   * `warning` per edge — and one incident should leave one row (design spec §5.5).
   */
  disable(stockId: string, cause: DisableCause): void {
    try {
      const current = this.deps.automationRepo.get(stockId);
      if (!current.enabled) return;
      this.deps.automationRepo.upsert(stockId, { ...current, enabled: false });
      this.deps.eventsRepo.insert({
        stockId,
        ts: this.now().toISOString(),
        kind: 'automation_disabled',
        payload: { cause },
        source: 'auto',
      });
    } catch (error) {
      // Reached from `FanController`'s interference callback and from the
      // manual-command handler, neither of which can do anything about a
      // failed write — and both of which must carry on switching the fan.
      console.error(`Automation: disabling ${stockId} (${cause}) failed`, error);
      return;
    }
    this.emit(stockId);
  }

  /**
   * Pushes the current state to open streams without evaluating.
   *
   * What the `PUT` calls when the user switched automation off: the handler
   * writes `automation_configured` itself, and a disabled stock is never
   * evaluated again, so this is the only news a second open page would get
   * (design spec §7.1).
   */
  notifyChanged(stockId: string): void {
    this.emit(stockId);
  }

  /** Synchronous snapshot of what the service holds for this stock. */
  getState(stockId: string): AutomationState {
    const last = this.lastEvaluation.get(stockId);
    return {
      enabled: this.deps.automationRepo.get(stockId).enabled,
      reason: last?.reason ?? null,
      evaluatedAt: last?.evaluatedAt ?? null,
    };
  }

  /** Subscribes to state changes for one stock; returns an unsubscribe function. */
  onChange(stockId: string, listener: (state: AutomationState) => void): () => void {
    const list = this.listeners.get(stockId) ?? [];
    list.push(listener);
    this.listeners.set(stockId, list);
    return () => {
      const current = this.listeners.get(stockId);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.listeners.delete(stockId);
    };
  }

  // --- internals ---

  /**
   * One pass over the stock rows. Stocks are processed one after another with
   * errors confined to the stock — a silent stock must not hold up the others.
   */
  private async runCycle(): Promise<void> {
    let stocks: Stock[];
    try {
      stocks = await this.deps.listStocks();
    } catch (error) {
      console.error('Automation: reading the stock rows failed, skipping this cycle', error);
      return;
    }
    for (const stock of stocks) {
      await this.evaluateSafely(stock);
    }
  }

  /** Runs one evaluation with every failure contained to this stock. */
  private async evaluateSafely(stock: Stock): Promise<void> {
    try {
      await this.evaluateOne(stock);
    } catch (error) {
      console.error(`Automation: evaluating ${stock.id} failed`, error);
    }
  }

  private async evaluateOne(stock: Stock): Promise<void> {
    // The row asks for fan control, a controller exists for it, and the stock
    // has grain thermometers — the same predicate the HTTP layer reports as
    // `available`, so the cycle cannot select a stock the API says it will not
    // drive (design spec §3.2).
    if (!automationAvailable(stock)) return;

    const parameters = this.deps.automationRepo.get(stock.id);
    if (!parameters.enabled) return;

    // Resolved separately from the availability check above, and later: a stock
    // can be retired in between, and the cycle must not assume a controller it
    // did not just obtain. Skipped without an event and without a read — this
    // one only saves the two queries; the controller that is acted on is
    // resolved once more below, after them.
    if (this.deps.getController(stock.id) === null) return;

    const readings = await this.read(stock);
    if (readings === null) return;

    const timing = this.timingState(stock.id);
    const at = this.now();
    const decision = evaluate(readings, parameters, timing, at);
    this.lastEvaluation.set(stock.id, {
      reason: decision.reason,
      evaluatedAt: at.toISOString(),
    });

    if (decision.desiredOn !== null) {
      // Both guards are resolved again here rather than reused from above: two
      // awaited InfluxDB queries sit between the selection and this point, and
      // Express handlers share the event loop, so the window is real.
      //
      // The controller, because a request can have declared the stock
      // unserviceable in it. `FanControlManager.markRetiring` sets that mark
      // without touching `enabled`, so the flag re-read does not catch it, and
      // a real retirement drops the wiring and stops the controller — arming
      // the keep-alive on it would leave a fan running on a controller no
      // endpoint and no reconciliation tick can reach again (design spec §5.2).
      //
      // The flag, because a manual command can have switched automation off in
      // the same window, and the tick would otherwise command the fan against
      // the user who just took it over (design spec §5.4).
      const current = this.deps.getController(stock.id);
      if (
        current !== null &&
        decision.desiredOn !== current.getStatus().desiredOn &&
        this.deps.automationRepo.get(stock.id).enabled
      ) {
        this.act(
          stock.id,
          current,
          decision.desiredOn,
          decision.reason,
          readings,
          parameters.deltaOnK,
          timing,
          at,
        );
      }
    }

    this.emit(stock.id);
  }

  /**
   * Issues the command and records why it was decided.
   *
   * The command goes first on purpose: the event row is the audit trail, the
   * command is the safety-relevant action, and a failing write must not be what
   * keeps a fan running. `FanController.command` writes its own `command` row,
   * so an automation switch leaves two rows — what was switched, and why.
   */
  private act(
    stockId: string,
    controller: FanController,
    desiredOn: boolean,
    reason: AutomationReason,
    readings: AutomationReadings,
    deltaOnK: number,
    timing: FanTimingState,
    at: Date,
  ): void {
    controller.command(desiredOn ? 'on' : 'off', 'auto');

    const deltaT =
      readings.grainMeanC !== null && readings.outdoorTempC !== null
        ? Math.round((readings.grainMeanC - readings.outdoorTempC) * 10) / 10
        : null;
    const payload: Record<string, unknown> = {
      reason,
      grainMeanC: readings.grainMeanC,
      grainMinC: readings.grainMinC,
      outdoorTempC: readings.outdoorTempC,
      outdoorHumidityPct: readings.outdoorHumidityPct,
      dewPointC: readings.dewPointC,
      deltaT,
      deltaOnK,
    };
    if (!desiredOn) {
      // From the snapshot taken before the command: `command('off')` clears
      // `fan_state.since` as it persists.
      payload['runMinutes'] =
        timing.since !== null
          ? Math.round((at.getTime() - new Date(timing.since).getTime()) / 60_000)
          : null;
    }

    this.deps.eventsRepo.insert({
      stockId,
      ts: at.toISOString(),
      kind: desiredOn ? 'auto_on' : 'auto_off',
      payload,
      source: 'auto',
    });
  }

  /**
   * Prepares the readings, or answers `null` when this tick has nothing to
   * decide on yet.
   *
   * Counts consecutive failures per stock: the first two are skipped, the third
   * is treated as no data so rule 1 switches the fan off. Copying
   * `FanControlManager.reconcile` unchanged — skip and retry — would let the
   * keep-alive hold a fan on for as long as InfluxDB stayed silent (design spec §5.3).
   */
  private async read(stock: Stock): Promise<AutomationReadings | null> {
    try {
      const [grain, outdoor] = await Promise.all([
        this.deps.readings.getLatestReadings(stock.deviceGroup),
        this.deps.readings.getOutdoorReading(stock.deviceGroup),
      ]);
      this.readFailures.delete(stock.id);

      const offlineThreshold = this.now().getTime() - offlineAfterMs();
      const conditions = buildOutdoorConditions(outdoor, offlineThreshold);
      const summary = summariseGrain(grain, offlineThreshold);
      return {
        outdoorTempC: conditions.temperature,
        outdoorHumidityPct: conditions.humidity,
        dewPointC: conditions.dewPoint,
        outdoorOffline: conditions.offline,
        grainMeanC: summary.meanC,
        grainMinC: summary.minC,
      };
    } catch (error) {
      const failures = (this.readFailures.get(stock.id) ?? 0) + 1;
      this.readFailures.set(stock.id, failures);
      console.error(
        `Automation: reading the measurements for ${stock.id} failed (${failures} in a row)`,
        error,
      );
      return failures >= READ_FAILURE_LIMIT ? NO_READINGS : null;
    }
  }

  /**
   * The minimum-time inputs, read from `fan_state` (design spec §3.3). The
   * automation stores no switching timestamps of its own: the keep-alive does
   * not persist and `recover()` does not re-stamp, so these are the real ones
   * and they survive a restart at no extra cost.
   */
  private timingState(stockId: string): FanTimingState {
    const persisted = this.deps.stateRepo.get(stockId);
    return {
      desiredOn: persisted?.desiredOn ?? false,
      since: persisted?.since ?? null,
      lastCommandAt: persisted?.lastCommandAt ?? null,
    };
  }

  /**
   * Pushes the current state to this stock's subscribers.
   *
   * Fired after every evaluation, not only on a changed reason: `evaluatedAt`
   * is what tells an open page the automation is still alive (design spec §7.1).
   */
  private emit(stockId: string): void {
    const list = this.listeners.get(stockId);
    if (!list || list.length === 0) return;
    const state = this.getState(stockId);
    // Snapshot: a listener may unsubscribe from inside its own notification,
    // which would shift the array underneath the loop.
    for (const listener of [...list]) {
      try {
        listener(state);
      } catch (error) {
        // Subscribers write to sockets. A throw must not escape into the cycle,
        // where it would abandon the remaining stocks.
        console.error(`Automation: a state subscriber for ${stockId} threw`, error);
      }
    }
  }
}
