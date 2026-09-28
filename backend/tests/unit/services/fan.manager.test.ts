import { selectFanStocks } from '../../../src/services/fan/fan.manager';
import type { Stock } from '../../../src/db/types';
import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanControlManager } from '../../../src/services/fan/fan.manager';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';

function fakeMqtt() {
  const published: Array<{ topic: string; message: string; qos?: 0 | 1 | 2 }> = [];
  const subscribed: string[] = [];
  let handler: ((t: string, p: string) => void) | null = null;
  let ended = false;
  return {
    published, subscribed,
    emit: (t: string, p: string) => handler?.(t, p),
    isEnded: () => ended,
    mqtt: {
      publish: (topic: string, message: string, options?: { qos?: 0 | 1 | 2 }) => {
        published.push({ topic, message, ...(options?.qos !== undefined ? { qos: options.qos } : {}) });
      },
      subscribe: (topic: string) => { subscribed.push(topic); },
      onMessage: (l: (t: string, p: string) => void) => { handler = l; },
      end: () => { ended = true; },
    },
  };
}

async function setup() {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, hasGrainSensors: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', fanSwitchId: 0,
    tenantId: DEFAULT_TENANT_ID,
  }]);
  const f = fakeMqtt();
  const enabledStockIds = new Set(['grain-watch-1']);
  const manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
    mqtt: f.mqtt,
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
    fanEnabledStockIds: async () => enabledStockIds,
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, manager, f, enabledStockIds };
}

describe('FanControlManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('subscribes to monitor + online topics on init', async () => {
    const { manager, f } = await setup();
    manager.init();
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/monitor/#');
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/online');
  });

  it('routes a monitor success message to the controller', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.getController('grain-watch-1')!.command('on');
    f.emit(
      '/corn-watch/actors/corn-watch-1/fan-control/monitor/status',
      '{"type":"success","message":"ok","switchState":true,"inputState":true,"timestamp":1}'
    );
    expect(manager.getController('grain-watch-1')!.getStatus().state).toBe('ON');
  });

  it('routes online LWT to the controller overlay', async () => {
    const { manager, f } = await setup();
    manager.init();
    f.emit('/corn-watch/actors/corn-watch-1/fan-control/online', 'true');
    expect(manager.getController('grain-watch-1')!.getStatus().fanControlReachable).toBe(true);
  });

  it('publishes to the command topic when the controller acts', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.getController('grain-watch-1')!.command('on');
    expect(f.published).toContainEqual({
      topic: '/corn-watch/actors/corn-watch-1/fan-control/command/switch:0',
      message: 'on',
      // Switching commands go out at least once; both payloads are idempotent.
      qos: 1,
    });
  });

  it('exposes a controller for fan stocks and none for anything else', async () => {
    const { manager } = await setup();
    manager.init();
    expect(manager.getController('grain-watch-1')).not.toBeNull();
    expect(manager.getController('grain-watch-2')).toBeNull();
  });

  it('releases the MQTT connection and the reconciliation timer on shutdown', async () => {
    const { db, f } = await setup();
    const fanEnabledStockIds = jest.fn().mockResolvedValue(new Set(['grain-watch-1']));
    const manager = new FanControlManager({
      stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
      mqtt: f.mqtt,
      stateRepo: new FanStateRepository(db.db),
      eventsRepo: new FanEventsRepository(db.db),
      timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
      fanEnabledStockIds,
    });
    manager.init();

    manager.shutdown();

    expect(f.isEnded()).toBe(true);
    // A surviving timer would keep reading a database that is already closed.
    jest.advanceTimersByTime(60000 * 3);
    expect(fanEnabledStockIds).not.toHaveBeenCalled();
  });

  describe('retirement', () => {
    const commandTopic = '/corn-watch/actors/corn-watch-1/fan-control/command/switch:0';

    it('stops driving the fan, sends one last off and forgets the stock', async () => {
      const { db, manager, f, enabledStockIds } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;

      enabledStockIds.delete('grain-watch-1');
      await manager.reconcile();

      expect(f.published).toEqual([{ topic: commandTopic, message: 'off', qos: 1 }]);
      expect(manager.getController('grain-watch-1')).toBeNull();
      expect(new FanStateRepository(db.db).get('grain-watch-1')?.desiredOn).toBe(false);

      // No keep-alive left to re-assert `on`, and nothing repeats on later ticks.
      jest.advanceTimersByTime(900000 * 2);
      f.published.length = 0;
      await manager.reconcile();
      expect(f.published).toEqual([]);
    });

    it('records the withdrawal in the audit log', async () => {
      const { db, manager, enabledStockIds } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');

      enabledStockIds.delete('grain-watch-1');
      await manager.reconcile();

      const kinds = new FanEventsRepository(db.db)
        .listRecent('grain-watch-1', 10)
        .map((e) => e.kind);
      expect(kinds).toContain('stand_down');
    });

    it('records the switch-off as a backend action', async () => {
      const { db, manager, f, enabledStockIds } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;

      enabledStockIds.delete('grain-watch-1');
      await manager.reconcile();

      const events = new FanEventsRepository(db.db).listRecent('grain-watch-1', 10);
      const off = events.find(
        (e) => e.kind === 'command' && (e.payload as { action?: string })?.action === 'off',
      );
      expect(off?.source).toBe('backend');
    });

    it('does not command anything from the request path', async () => {
      const { manager, f, enabledStockIds } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      enabledStockIds.delete('grain-watch-1');
      f.published.length = 0;

      // What a request does: refuse the stock, leave the switching to the tick.
      manager.markRetiring('grain-watch-1');
      expect(manager.getController('grain-watch-1')).toBeNull();
      expect(f.published).toEqual([]);

      await manager.reconcile();
      expect(f.published).toEqual([{ topic: commandTopic, message: 'off', qos: 1 }]);
    });

    it('forgets the stock even when the switch-off throws', async () => {
      const { manager, enabledStockIds } = await setup();
      manager.init();
      const controller = manager.getController('grain-watch-1')!;
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(controller, 'command').mockImplementation(() => {
        throw new Error('broker gone');
      });

      enabledStockIds.delete('grain-watch-1');
      await manager.reconcile();

      expect(manager.getController('grain-watch-1')).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('keeps the current wiring when the rows cannot be read', async () => {
      const { db, f } = await setup();
      const manager = new FanControlManager({
        stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
        mqtt: f.mqtt,
        stateRepo: new FanStateRepository(db.db),
        eventsRepo: new FanEventsRepository(db.db),
        timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
        fanEnabledStockIds: () => Promise.reject(new Error('database busy')),
      });
      manager.init();
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await manager.reconcile();

      expect(manager.getController('grain-watch-1')).not.toBeNull();
      expect(f.published).toEqual([]);
      consoleError.mockRestore();
      manager.shutdown();
    });
  });

  const base: Stock = {
    id: 'x', name: 'X', deviceGroup: 'g', devicePrefix: '1',
    hasHumidity: false,
    hasGrainSensors: true, active: true, createdAt: 'x', fanControlEnabled: false, fanSwitchId: 0,
    tenantId: DEFAULT_TENANT_ID,
  };

  it('keeps only fan-enabled stocks that have a topic prefix', () => {
    const result = selectFanStocks([
      { ...base, id: 'a', fanControlEnabled: true, fanTopicPrefix: '/pa', fanSwitchId: 0 },
      { ...base, id: 'b', fanControlEnabled: false },
      { ...base, id: 'c', fanControlEnabled: true }, // no prefix -> excluded
    ]);
    expect(result).toEqual([{ stockId: 'a', topicPrefix: '/pa', switchId: 0 }]);
  });
});
