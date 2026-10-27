import type { FanStateRepository, FanEventsRepository } from '../../db/repositories/fan.repository';
import type { Stock } from '../../db/types';
import { FanController } from './fan.controller';
import { parseShellyMonitorMessage } from './shelly-message';
import type { InterferenceCause } from './types';

/** Everything the manager needs to drive one stock's fan over MQTT. */
export interface FanWiringConfig {
  stockId: string;
  topicPrefix: string;
  switchId: number;
}

/**
 * Selects the MQTT wiring config for every fan-enabled stock. Pure.
 *
 * A usable topic prefix is as necessary as the flag: without one there is
 * nothing to publish to, so no controller is built and the stock reports no fan
 * control.
 */
export function selectFanStocks(stocks: Stock[]): FanWiringConfig[] {
  return stocks
    .filter((s) => s.fanControlEnabled && s.fanTopicPrefix)
    .map((s) => ({ stockId: s.id, topicPrefix: s.fanTopicPrefix as string, switchId: s.fanSwitchId }));
}

export interface FanManagerDeps {
  stocks: FanWiringConfig[];
  mqtt: {
    publish(topic: string, message: string, options?: { qos?: 0 | 1 | 2 }): void;
    subscribe(topic: string): void;
    unsubscribe(topic: string): void;
    onMessage(listener: (topic: string, payload: string) => void): void;
    end(): void;
  };
  stateRepo: FanStateRepository;
  eventsRepo: FanEventsRepository;
  timings: {
    keepAliveMs: number;
    watchdogMs: number;
    retentionDays: number;
    retentionSweepMs: number;
    /** How often the stock rows are re-read to catch fan control being revoked. */
    reconcileIntervalMs: number;
  };
  /**
   * The wiring every stock that asks for fan control currently wants. Re-read
   * on every reconciliation tick so a row edited underneath the process takes
   * effect without HTTP traffic and without a restart — the full wiring rather
   * than a set of ids, so a changed topic prefix or switch id is noticed too.
   */
  fanWiring: () => Promise<FanWiringConfig[]>;
  /**
   * Notified when a controller reports an interference with its own desired
   * state — a local switch or a fault — with the stock id attached. Set by
   * `bootstrap.ts` to reach the automation service, which this class never
   * imports the type of (design spec §5.5).
   */
  onInterference?: (stockId: string, cause: InterferenceCause) => void;
  /**
   * Notified when this stock's fan control is withdrawn, before the manager's
   * own switch-off in `retireController` — the fourth way automation switches
   * itself off (design spec §5.5). Separate from `onInterference`: the cause
   * here is fixed and known only to this class, never reported by
   * `FanController` itself.
   */
  onControlWithdrawn?: (stockId: string) => void;
  now?: () => Date;
}

interface StockFanWiring {
  stockId: string;
  topicPrefix: string;
  switchId: number;
  commandTopic: string;
  /** The switch's own generic status update — the only status topic that concerns the fan. */
  statusTopic: string;
  controller: FanController;
  /**
   * Set when a request observed that fan control was revoked for this stock.
   * `getController` then refuses it, so the endpoints, the SSE guard and the
   * reported availability all stop serving it at once; the reconciliation tick
   * does the switching shortly after.
   */
  retiring: boolean;
}

/**
 * The three topics one stock's fan listens on. One definition, so a
 * subscription and the unsubscription that undoes it cannot drift apart.
 *
 * Not `status/#`: that also carries the device's peripheral components
 * (temperature, system, wifi), which report every few seconds and say nothing
 * about the fan. The design spec names this one status topic (§2).
 */
function topicsOf(wiring: StockFanWiring): string[] {
  return [`${wiring.topicPrefix}/monitor/#`, wiring.statusTopic, `${wiring.topicPrefix}/online`];
}

export class FanControlManager {
  private readonly fanStocks = new Map<string, StockFanWiring>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: FanManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    // Only the map entries here; the subscriptions and `recover()` belong to
    // `init`, which is also what arms the timers.
    for (const s of deps.stocks) this.createWiring(s);
  }

  init(): void {
    this.deps.mqtt.onMessage((topic, payload) => this.route(topic, payload));
    // Subscribe once: the mqtt client queues these until it connects and
    // re-subscribes automatically on reconnect (resubscribe default).
    for (const wiring of this.fanStocks.values()) this.activateWiring(wiring);
    this.retentionTimer = setInterval(() => this.sweepRetention(), this.deps.timings.retentionSweepMs);
    this.reconcileTimer = setInterval(
      () => void this.reconcile(),
      this.deps.timings.reconcileIntervalMs,
    );
  }

  /**
   * Re-reads the wiring every stock asks for and brings the live controllers
   * into line with it: retire what is gone, re-wire what moved, build what is
   * new.
   *
   * The safety property must not depend on someone using the app: a fan whose
   * row was cleared has to stop even if nobody opens the page again. A failed
   * read is skipped — the next tick retries — rather than treated as a revocation.
   */
  async reconcile(): Promise<void> {
    let desired: FanWiringConfig[];
    try {
      desired = await this.deps.fanWiring();
    } catch (error) {
      console.error('Fan control: reconciliation failed, keeping current wiring', error);
      return;
    }
    const wanted = new Map(desired.map((w) => [w.stockId, w]));

    for (const [stockId, wiring] of [...this.fanStocks]) {
      const want = wanted.get(stockId);
      // Marked by a request counts too: that path only refuses the stock, the
      // switching happens here.
      if (!want || wiring.retiring) {
        this.retire(stockId, 'fan control withdrawn');
        continue;
      }
      if (want.topicPrefix === wiring.topicPrefix && want.switchId === wiring.switchId) continue;
      // The stock keeps its fan control but points at a different device or a
      // different switch. Retire first, so the final `off` goes out on the
      // *old* command topic: the device being disconnected must not keep
      // running. Only then build the new wiring.
      this.retire(stockId, 'fan wiring changed');
      this.buildWiring(want);
    }

    for (const want of wanted.values()) {
      if (!this.fanStocks.has(want.stockId)) this.buildWiring(want);
    }
  }

  getController(stockId: string): FanController | null {
    const wiring = this.fanStocks.get(stockId);
    // Refused from the moment a request marked the stock: the reconciliation
    // tick switches the fan off and drops the wiring shortly after.
    return wiring && !wiring.retiring ? wiring.controller : null;
  }

  /**
   * Takes a stock's fan out of service: stops driving it, sends one last `off`
   * and forgets the wiring.
   *
   * Deliberately a single shot rather than a retry loop. Withdrawing fan
   * control is a rare, supervised change to a stock's installation, the fan is
   * practically never running at that moment, and the Shelly switches itself
   * off after one to two hours without a keep-alive signal — so the backend
   * does not need to chase an acknowledgement to stay safe.
   */
  retireController(stockId: string): void {
    this.retire(stockId, 'fan control withdrawn');
  }

  /**
   * The retirement itself. `reason` lands in the `stand_down` row, so the fan
   * history distinguishes a withdrawal from a re-wire; everything else is
   * identical, deliberately: a re-wire disconnects the device automation was
   * acting on just as a withdrawal does, and the replacement has never been
   * observed, so automation must stand down for it too.
   */
  private retire(stockId: string, reason: string): void {
    const wiring = this.fanStocks.get(stockId);
    if (!wiring) return;

    wiring.retiring = true;

    // Ahead of the switch-off below: automation could not enforce its rules on
    // a stock it no longer has authority over, so it must not claim to (design
    // spec §5.5). A transition, not an action — with automation already
    // disabled the dependency writes nothing.
    try {
      this.deps.onControlWithdrawn?.(stockId);
    } catch (error) {
      console.error(`Fan control: notifying automation of ${stockId}'s withdrawal failed`, error);
    }

    try {
      // Also clears the keep-alive and the persisted desired state, so nothing
      // re-asserts `on` and a later re-enable cannot resume the fan.
      wiring.controller.command('off', 'backend');
    } catch (error) {
      console.error(`Fan control: switching ${stockId} off during retirement failed`, error);
    }

    // Separate from the command on purpose, so this extra record does not add a
    // second way for the switch-off to fail. It does not make the command
    // failure-proof: `turnOffImmediately` writes its own audit row before publishing,
    // so a database failure still swallows the `off` — see the backlog entry
    // "A failing audit write blocks the MQTT command". The device's auto-off
    // covers that case.
    try {
      this.deps.eventsRepo.insert({
        stockId,
        ts: this.now().toISOString(),
        kind: 'stand_down',
        payload: { reason },
        source: 'backend',
      });
    } catch (error) {
      console.error(`Fan control: logging the retirement of ${stockId} failed`, error);
    }

    wiring.controller.stop();
    this.fanStocks.delete(stockId);
    // After the delete, so the guard inside sees only the wirings that remain.
    this.unsubscribeWiring(wiring);
  }

  /**
   * Marks a stock as no longer serviceable without commanding anything.
   *
   * Used by the request path: a GET should not publish to MQTT, and the mark is
   * enough to stop serving the stock immediately. The switching belongs to the
   * reconciliation tick, which picks up marked stocks too.
   */
  markRetiring(stockId: string): void {
    const wiring = this.fanStocks.get(stockId);
    if (wiring) wiring.retiring = true;
  }

  shutdown(): void {
    if (this.retentionTimer) { clearInterval(this.retentionTimer); this.retentionTimer = null; }
    if (this.reconcileTimer) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
    for (const wiring of this.fanStocks.values()) wiring.controller.stop();
    this.deps.mqtt.end();
  }

  /**
   * A stock's complete wiring: the map entry, its subscriptions and the
   * resumption of whatever state survived. Used by the reconciliation tick;
   * the constructor and `init` run the two halves separately, because the
   * subscriptions may only go out once a message listener is registered.
   */
  private buildWiring(config: FanWiringConfig): void {
    try {
      this.activateWiring(this.createWiring(config));
    } catch (error) {
      console.error(`Fan control: building ${config.stockId}'s wiring failed`, error);
    }
  }

  /** The map entry and its controller. No MQTT traffic. */
  private createWiring(config: FanWiringConfig): StockFanWiring {
    const commandTopic = `${config.topicPrefix}/command/switch:${config.switchId}`;
    const wiring: StockFanWiring = {
      stockId: config.stockId,
      topicPrefix: config.topicPrefix,
      switchId: config.switchId,
      commandTopic,
      statusTopic: `${config.topicPrefix}/status/switch:${config.switchId}`,
      controller: new FanController({
        stockId: config.stockId,
        // QoS 1: a switching command must survive a brief broker hiccup. Both
        // payloads are idempotent, so a duplicate delivery is harmless.
        publish: (payload) => this.deps.mqtt.publish(commandTopic, payload, { qos: 1 }),
        stateRepo: this.deps.stateRepo,
        eventsRepo: this.deps.eventsRepo,
        timings: {
          keepAliveMs: this.deps.timings.keepAliveMs,
          watchdogMs: this.deps.timings.watchdogMs,
        },
        now: this.now,
        // Always wired, even with no dependency configured: the wrapper itself
        // checks for one, so there is nothing conditional to express in the
        // property's type under `exactOptionalPropertyTypes`.
        onInterference: (cause: InterferenceCause): void => {
          this.deps.onInterference?.(config.stockId, cause);
        },
      }),
      retiring: false,
    };
    this.fanStocks.set(config.stockId, wiring);
    return wiring;
  }

  /** Subscribes a wiring's topics and resumes its persisted desired state. */
  private activateWiring(wiring: StockFanWiring): void {
    for (const topic of topicsOf(wiring)) this.deps.mqtt.subscribe(topic);
    wiring.controller.recover();
  }

  /**
   * Stops the broker delivering a retired wiring's topics — unless another
   * stock still sits on the same prefix. Two stocks can share one through
   * misconfiguration, and the survivor must keep its feed.
   */
  private unsubscribeWiring(wiring: StockFanWiring): void {
    for (const remaining of this.fanStocks.values()) {
      if (remaining.topicPrefix === wiring.topicPrefix) return;
    }
    try {
      for (const topic of topicsOf(wiring)) this.deps.mqtt.unsubscribe(topic);
    } catch (error) {
      console.error(`Fan control: unsubscribing ${wiring.stockId}'s topics failed`, error);
    }
  }

  private route(topic: string, payload: string): void {
    for (const wiring of this.fanStocks.values()) {
      if (!topic.startsWith(`${wiring.topicPrefix}/`)) continue;
      const suffix = topic.slice(wiring.topicPrefix.length + 1);
      if (suffix.startsWith('monitor/')) {
        const msg = parseShellyMonitorMessage(payload);
        if (msg) wiring.controller.handleShellyMessage(msg);
      } else if (topic === wiring.statusTopic) {
        wiring.controller.handleStatus(payload);
      } else if (suffix === 'online') {
        // The device's own topic name; the controller maps it onto the
        // reachability the API reports.
        wiring.controller.handleReachability(payload.trim() === 'true');
      }
      return;
    }
  }

  private sweepRetention(): void {
    const cutoff = new Date(this.now().getTime() - this.deps.timings.retentionDays * 86400000).toISOString();
    this.deps.eventsRepo.deleteOlderThan(cutoff);
  }
}
