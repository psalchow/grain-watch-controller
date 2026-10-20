import type { FanStateRepository, FanEventsRepository } from '../../db/repositories/fan.repository';
import type { Stock } from '../../db/types';
import { FanController } from './fan.controller';
import { parseShellyMonitorMessage } from './shelly-message';
import type { InterferenceCause } from './types';

/**
 * Selects the MQTT wiring config for every fan-enabled stock. Pure.
 *
 * A usable topic prefix is as necessary as the flag: without one there is
 * nothing to publish to, so no controller is built and the stock reports no fan
 * control.
 */
export function selectFanStocks(
  stocks: Stock[],
): Array<{ stockId: string; topicPrefix: string; switchId: number }> {
  return stocks
    .filter((s) => s.fanControlEnabled && s.fanTopicPrefix)
    .map((s) => ({ stockId: s.id, topicPrefix: s.fanTopicPrefix as string, switchId: s.fanSwitchId }));
}

export interface FanManagerDeps {
  stocks: Array<{ stockId: string; topicPrefix: string; switchId: number }>;
  mqtt: {
    publish(topic: string, message: string, options?: { qos?: 0 | 1 | 2 }): void;
    subscribe(topic: string): void;
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
   * Ids of the stocks that currently ask for fan control. Re-read on every
   * reconciliation tick so a row edited underneath the process takes effect
   * without HTTP traffic and without a restart.
   */
  fanEnabledStockIds: () => Promise<Set<string>>;
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

export class FanControlManager {
  private readonly fanStocks = new Map<string, StockFanWiring>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: FanManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    for (const s of deps.stocks) {
      const commandTopic = `${s.topicPrefix}/command/switch:${s.switchId}`;
      const statusTopic = `${s.topicPrefix}/status/switch:${s.switchId}`;
      const controller = new FanController({
        stockId: s.stockId,
        // QoS 1: a switching command must survive a brief broker hiccup. Both
        // payloads are idempotent, so a duplicate delivery is harmless.
        publish: (payload) => this.deps.mqtt.publish(commandTopic, payload, { qos: 1 }),
        stateRepo: deps.stateRepo,
        eventsRepo: deps.eventsRepo,
        timings: { keepAliveMs: deps.timings.keepAliveMs, watchdogMs: deps.timings.watchdogMs },
        now: this.now,
        // Always wired, even with no dependency configured: the wrapper itself
        // checks for one, so there is nothing conditional to express in the
        // property's type under `exactOptionalPropertyTypes`.
        onInterference: (cause: InterferenceCause): void => {
          deps.onInterference?.(s.stockId, cause);
        },
      });
      this.fanStocks.set(s.stockId, {
        stockId: s.stockId,
        topicPrefix: s.topicPrefix,
        commandTopic,
        statusTopic,
        controller,
        retiring: false,
      });
    }
  }

  init(): void {
    this.deps.mqtt.onMessage((topic, payload) => this.route(topic, payload));
    // Subscribe once: the mqtt client queues these until it connects and
    // re-subscribes automatically on reconnect (resubscribe default).
    for (const wiring of this.fanStocks.values()) {
      this.deps.mqtt.subscribe(`${wiring.topicPrefix}/monitor/#`);
      // Not `status/#`: that also carries the device's peripheral components
      // (temperature, system, wifi), which report every few seconds and say
      // nothing about the fan. The design spec names this one topic (§2).
      this.deps.mqtt.subscribe(wiring.statusTopic);
      this.deps.mqtt.subscribe(`${wiring.topicPrefix}/online`);
      wiring.controller.recover();
    }
    this.retentionTimer = setInterval(() => this.sweepRetention(), this.deps.timings.retentionSweepMs);
    this.reconcileTimer = setInterval(
      () => void this.reconcile(),
      this.deps.timings.reconcileIntervalMs,
    );
  }

  /**
   * Re-reads which stocks still ask for fan control and retires the rest.
   *
   * The safety property must not depend on someone using the app: a fan whose
   * row was cleared has to stop even if nobody opens the page again. A failed
   * read is skipped — the next tick retries — rather than treated as a revocation.
   */
  async reconcile(): Promise<void> {
    let enabled: Set<string>;
    try {
      enabled = await this.deps.fanEnabledStockIds();
    } catch (error) {
      console.error('Fan control: reconciliation failed, keeping current wiring', error);
      return;
    }
    for (const [stockId, wiring] of [...this.fanStocks]) {
      // Marked by a request counts too: that path only refuses the stock, the
      // switching happens here.
      if (!enabled.has(stockId) || wiring.retiring) this.retireController(stockId);
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
   * control is a rare, supervised change to a hall's installation, the fan is
   * practically never running at that moment, and the Shelly switches itself
   * off after one to two hours without a keep-alive signal — so the backend
   * does not need to chase an acknowledgement to stay safe.
   */
  retireController(stockId: string): void {
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
        payload: { reason: 'fan control withdrawn' },
        source: 'backend',
      });
    } catch (error) {
      console.error(`Fan control: logging the retirement of ${stockId} failed`, error);
    }

    wiring.controller.stop();
    this.fanStocks.delete(stockId);
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
