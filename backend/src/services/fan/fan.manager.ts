import type { FanStateRepository, FanEventsRepository } from '../../db/repositories/fan.repository';
import type { Stock } from '../../db/types';
import { FanController } from './fan.controller';
import { parseShellyMonitorMessage } from './shelly-message';

/** Selects the MQTT wiring config for every fan-enabled stock. Pure. */
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
    publish(topic: string, message: string): void;
    subscribe(topic: string): void;
    onMessage(listener: (topic: string, payload: string) => void): void;
  };
  stateRepo: FanStateRepository;
  eventsRepo: FanEventsRepository;
  timings: { keepAliveMs: number; watchdogMs: number; retentionDays: number; retentionSweepMs: number };
  now?: () => Date;
}

interface HallWiring {
  stockId: string;
  topicPrefix: string;
  commandTopic: string;
  controller: FanController;
}

export class FanControlManager {
  private readonly halls = new Map<string, HallWiring>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: FanManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    for (const s of deps.stocks) {
      const commandTopic = `${s.topicPrefix}/command/switch:${s.switchId}`;
      const controller = new FanController({
        stockId: s.stockId,
        publish: (payload) => this.deps.mqtt.publish(commandTopic, payload),
        stateRepo: deps.stateRepo,
        eventsRepo: deps.eventsRepo,
        timings: { keepAliveMs: deps.timings.keepAliveMs, watchdogMs: deps.timings.watchdogMs },
        now: this.now,
      });
      this.halls.set(s.stockId, { stockId: s.stockId, topicPrefix: s.topicPrefix, commandTopic, controller });
    }
  }

  init(): void {
    this.deps.mqtt.onMessage((topic, payload) => this.route(topic, payload));
    for (const hall of this.halls.values()) {
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/monitor/#`);
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/status/#`);
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/online`);
      hall.controller.recover();
    }
    this.retentionTimer = setInterval(() => this.sweepRetention(), this.deps.timings.retentionSweepMs);
  }

  isFanStock(stockId: string): boolean {
    return this.halls.has(stockId);
  }

  getController(stockId: string): FanController | null {
    return this.halls.get(stockId)?.controller ?? null;
  }

  shutdown(): void {
    if (this.retentionTimer) { clearInterval(this.retentionTimer); this.retentionTimer = null; }
    for (const hall of this.halls.values()) hall.controller.stop();
  }

  private route(topic: string, payload: string): void {
    for (const hall of this.halls.values()) {
      if (!topic.startsWith(`${hall.topicPrefix}/`)) continue;
      const suffix = topic.slice(hall.topicPrefix.length + 1);
      if (suffix.startsWith('monitor/')) {
        const msg = parseShellyMonitorMessage(payload);
        if (msg) hall.controller.handleShellyMessage(msg);
      } else if (suffix.startsWith('status/')) {
        hall.controller.handleStatus(payload);
      } else if (suffix === 'online') {
        hall.controller.handleOnline(payload.trim() === 'true');
      }
      return;
    }
  }

  private sweepRetention(): void {
    const cutoff = new Date(this.now().getTime() - this.deps.timings.retentionDays * 86400000).toISOString();
    this.deps.eventsRepo.deleteOlderThan(cutoff);
  }
}
