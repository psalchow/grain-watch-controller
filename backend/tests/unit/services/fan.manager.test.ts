import { selectFanStocks } from '../../../src/services/fan/fan.manager';
import type { Stock } from '../../../src/db/types';
import { createTestDb } from '../../setup/db';
import { FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { insertStock } from '../../setup/stocks';
import { FanControlManager } from '../../../src/services/fan/fan.manager';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';

function fakeMqtt() {
  const published: Array<{ topic: string; message: string; qos?: 0 | 1 | 2 }> = [];
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  let handler: ((t: string, p: string) => void) | null = null;
  let ended = false;
  return {
    published, subscribed, unsubscribed,
    emit: (t: string, p: string) => handler?.(t, p),
    isEnded: () => ended,
    mqtt: {
      publish: (topic: string, message: string, options?: { qos?: 0 | 1 | 2 }) => {
        published.push({ topic, message, ...(options?.qos !== undefined ? { qos: options.qos } : {}) });
      },
      subscribe: (topic: string) => { subscribed.push(topic); },
      unsubscribe: (topic: string) => { unsubscribed.push(topic); },
      onMessage: (l: (t: string, p: string) => void) => { handler = l; },
      end: () => { ended = true; },
    },
  };
}

const PREFIX = '/corn-watch/actors/corn-watch-1/fan-control';

async function setup() {
  const db = createTestDb();
  await insertStock(db.db, { id: 'grain-watch-1', fanControlEnabled: true, fanTopicPrefix: PREFIX });
  const f = fakeMqtt();
  // Mutable: a test edits this array to express a configuration change and
  // then runs a reconciliation tick against it.
  const wiring: Array<{ stockId: string; topicPrefix: string; switchId: number }> = [
    { stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 },
  ];
  const manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 }],
    mqtt: f.mqtt,
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
    fanWiring: async () => wiring,
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, manager, f, wiring };
}

describe('FanControlManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('subscribes to monitor + status + online topics on init', async () => {
    const { manager, f } = await setup();
    manager.init();
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/monitor/#');
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/online');
    // The switch's own status only: a wildcard also delivers the device's
    // peripheral components (temperature, system, wifi), which say nothing
    // about the fan (design spec §2).
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/status/switch:0');
    expect(f.subscribed).not.toContain('/corn-watch/actors/corn-watch-1/fan-control/status/#');
  });

  it('routes the switch status to the controller and ignores other components', async () => {
    const { manager, f } = await setup();
    manager.init();
    const controller = manager.getController('grain-watch-1')!;
    const statusEvents = () => controller.getRecentEvents(50).filter((e) => e.kind === 'status');

    f.emit('/corn-watch/actors/corn-watch-1/fan-control/status/temperature:100', '{"id":100,"tC":9.7}');
    expect(statusEvents()).toHaveLength(0);

    f.emit('/corn-watch/actors/corn-watch-1/fan-control/status/switch:0', '{"id":0,"output":true}');
    expect(statusEvents()).toHaveLength(1);
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
    const fanWiring = jest
      .fn()
      .mockResolvedValue([{ stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 }]);
    const manager = new FanControlManager({
      stocks: [{ stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 }],
      mqtt: f.mqtt,
      stateRepo: new FanStateRepository(db.db),
      eventsRepo: new FanEventsRepository(db.db),
      timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
      fanWiring,
    });
    manager.init();

    manager.shutdown();

    expect(f.isEnded()).toBe(true);
    // A surviving timer would keep reading a database that is already closed.
    jest.advanceTimersByTime(60000 * 3);
    expect(fanWiring).not.toHaveBeenCalled();
  });

  describe('retirement', () => {
    const commandTopic = '/corn-watch/actors/corn-watch-1/fan-control/command/switch:0';

    it('stops driving the fan, sends one last off and forgets the stock', async () => {
      const { db, manager, f, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;

      wiring.length = 0;
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
      const { db, manager, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');

      wiring.length = 0;
      await manager.reconcile();

      const kinds = new FanEventsRepository(db.db)
        .listRecent('grain-watch-1', 10)
        .map((e) => e.kind);
      expect(kinds).toContain('stand_down');
    });

    it('records the switch-off as a backend action', async () => {
      const { db, manager, f, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;

      wiring.length = 0;
      await manager.reconcile();

      const events = new FanEventsRepository(db.db).listRecent('grain-watch-1', 10);
      const off = events.find(
        (e) => e.kind === 'command' && (e.payload as { action?: string })?.action === 'off',
      );
      expect(off?.source).toBe('backend');
    });

    it('does not command anything from the request path', async () => {
      const { manager, f, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      wiring.length = 0;
      f.published.length = 0;

      // What a request does: refuse the stock, leave the switching to the tick.
      manager.markRetiring('grain-watch-1');
      expect(manager.getController('grain-watch-1')).toBeNull();
      expect(f.published).toEqual([]);

      await manager.reconcile();
      expect(f.published).toEqual([{ topic: commandTopic, message: 'off', qos: 1 }]);
    });

    it('forgets the stock even when the switch-off throws', async () => {
      const { manager, wiring } = await setup();
      manager.init();
      const controller = manager.getController('grain-watch-1')!;
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(controller, 'command').mockImplementation(() => {
        throw new Error('broker gone');
      });

      wiring.length = 0;
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
        fanWiring: () => Promise.reject(new Error('database busy')),
      });
      manager.init();
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await manager.reconcile();

      expect(manager.getController('grain-watch-1')).not.toBeNull();
      expect(f.published).toEqual([]);
      consoleError.mockRestore();
      manager.shutdown();
    });

    it("unsubscribes the retired stock's topics", async () => {
      const { manager, f, wiring } = await setup();
      manager.init();

      wiring.length = 0;
      await manager.reconcile();

      expect(f.unsubscribed).toEqual([
        `${PREFIX}/monitor/#`,
        `${PREFIX}/status/switch:0`,
        `${PREFIX}/online`,
      ]);
    });

    it('unsubscribes only once the last stock on the prefix is retired', async () => {
      // Two stocks on one prefix is a misconfiguration, but the survivor's feed
      // must not go dark because its neighbour was retired.
      const { db, f } = await setup();
      await insertStock(db.db, { id: 'grain-watch-2', fanControlEnabled: true, fanTopicPrefix: PREFIX });
      const wiring = [
        { stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 },
        { stockId: 'grain-watch-2', topicPrefix: PREFIX, switchId: 1 },
      ];
      const manager = new FanControlManager({
        stocks: [...wiring],
        mqtt: f.mqtt,
        stateRepo: new FanStateRepository(db.db),
        eventsRepo: new FanEventsRepository(db.db),
        timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
        fanWiring: async () => wiring,
      });
      manager.init();

      wiring.splice(1, 1);
      await manager.reconcile();

      expect(manager.getController('grain-watch-2')).toBeNull();
      expect(f.unsubscribed).toEqual([]);

      // Once the survivor goes too, nobody shares the prefix any more: the
      // topics are taken down now, which an implementation that never
      // unsubscribes would not do.
      wiring.length = 0;
      await manager.reconcile();

      expect(f.unsubscribed).toEqual([
        `${PREFIX}/monitor/#`,
        `${PREFIX}/status/switch:0`,
        `${PREFIX}/online`,
      ]);
      manager.shutdown();
    });
  });

  describe('building on the reconciliation tick', () => {
    it('builds, subscribes and recovers a stock that appears in the wiring', async () => {
      const { db, manager, f, wiring } = await setup();
      manager.init();
      await insertStock(db.db, { id: 'grain-watch-2', fanControlEnabled: true, fanTopicPrefix: '/p2' });
      // A desired state left behind by an earlier run: `recover()` resumes it,
      // which is how the build path proves it ran the full wiring.
      new FanStateRepository(db.db).upsert({
        stockId: 'grain-watch-2',
        desiredOn: true,
        since: '2026-07-09T09:00:00.000Z',
        lastCommandAt: '2026-07-09T09:00:00.000Z',
        updatedAt: '2026-07-09T09:00:00.000Z',
      });

      wiring.push({ stockId: 'grain-watch-2', topicPrefix: '/p2', switchId: 1 });
      await manager.reconcile();

      expect(manager.getController('grain-watch-2')).not.toBeNull();
      expect(f.subscribed).toContain('/p2/monitor/#');
      expect(f.subscribed).toContain('/p2/status/switch:1');
      expect(f.subscribed).toContain('/p2/online');
      expect(f.published).toContainEqual({ topic: '/p2/command/switch:1', message: 'on', qos: 1 });
    });

    it('re-wires a changed topic prefix, switching the old device off', async () => {
      const { manager, f, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;

      wiring[0]!.topicPrefix = '/relocated';
      await manager.reconcile();

      // On the *old* command topic: the device being disconnected must not be
      // left running.
      expect(f.published).toEqual([{ topic: `${PREFIX}/command/switch:0`, message: 'off', qos: 1 }]);
      expect(f.unsubscribed).toEqual([
        `${PREFIX}/monitor/#`,
        `${PREFIX}/status/switch:0`,
        `${PREFIX}/online`,
      ]);
      expect(f.subscribed).toContain('/relocated/monitor/#');
      expect(f.subscribed).toContain('/relocated/status/switch:0');
      expect(f.subscribed).toContain('/relocated/online');

      const rebuilt = manager.getController('grain-watch-1');
      expect(rebuilt).not.toBeNull();
      rebuilt!.command('on');
      expect(f.published).toContainEqual({ topic: '/relocated/command/switch:0', message: 'on', qos: 1 });
    });

    it('re-wires a changed switch id, switching the old switch off', async () => {
      const { manager, f, wiring } = await setup();
      manager.init();
      manager.getController('grain-watch-1')!.command('on');
      f.published.length = 0;
      f.subscribed.length = 0;

      wiring[0]!.switchId = 1;
      await manager.reconcile();

      expect(f.published).toEqual([{ topic: `${PREFIX}/command/switch:0`, message: 'off', qos: 1 }]);
      // The prefix survives the re-wire, so its shared topics are taken down
      // and put back up; the switch's own status topic moves.
      expect(f.unsubscribed).toContain(`${PREFIX}/status/switch:0`);
      expect(f.subscribed).toContain(`${PREFIX}/status/switch:1`);
      expect(f.subscribed).toContain(`${PREFIX}/monitor/#`);
      expect(f.subscribed).toContain(`${PREFIX}/online`);

      manager.getController('grain-watch-1')!.command('on');
      expect(f.published).toContainEqual({ topic: `${PREFIX}/command/switch:1`, message: 'on', qos: 1 });
    });

    it('builds nothing when the wiring cannot be read', async () => {
      const { db, f } = await setup();
      const manager = new FanControlManager({
        stocks: [],
        mqtt: f.mqtt,
        stateRepo: new FanStateRepository(db.db),
        eventsRepo: new FanEventsRepository(db.db),
        timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
        fanWiring: () => Promise.reject(new Error('database busy')),
      });
      manager.init();
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await manager.reconcile();

      expect(manager.getController('grain-watch-1')).toBeNull();
      expect(f.subscribed).toEqual([]);
      consoleError.mockRestore();
      manager.shutdown();
    });
  });

  describe('automation wiring', () => {
    it("forwards a controller's interference to the manager's dependency with the stock id", async () => {
      const { db } = await setup();
      const f = fakeMqtt();
      const interference: Array<{ stockId: string; cause: string }> = [];
      const manager = new FanControlManager({
        stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
        mqtt: f.mqtt,
        stateRepo: new FanStateRepository(db.db),
        eventsRepo: new FanEventsRepository(db.db),
        timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
        fanWiring: async () => [{ stockId: 'grain-watch-1', topicPrefix: PREFIX, switchId: 0 }],
        onInterference: (stockId, cause) => interference.push({ stockId, cause }),
      });
      manager.init();

      f.emit(
        '/corn-watch/actors/corn-watch-1/fan-control/monitor/status',
        '{"type":"warning","message":"local switch","switchState":false,"inputState":true,"timestamp":1}'
      );

      expect(interference).toEqual([{ stockId: 'grain-watch-1', cause: 'local_switch' }]);
    });

    it('calls onControlWithdrawn with fan_control_withdrawn before switching the fan off', async () => {
      const { db, wiring } = await setup();
      const f = fakeMqtt();
      const order: string[] = [];
      const manager = new FanControlManager({
        stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
        mqtt: f.mqtt,
        stateRepo: new FanStateRepository(db.db),
        eventsRepo: new FanEventsRepository(db.db),
        timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
        fanWiring: async () => wiring,
        onControlWithdrawn: (stockId) => order.push(`withdrawn:${stockId}`),
      });
      manager.init();
      const controller = manager.getController('grain-watch-1')!;
      const commandSpy = jest.spyOn(controller, 'command').mockImplementation((action) => {
        order.push(`command:${action}`);
      });

      wiring.length = 0;
      await manager.reconcile();

      expect(order).toEqual(['withdrawn:grain-watch-1', 'command:off']);
      commandSpy.mockRestore();
    });
  });

  const base: Stock = {
    id: 'x', name: 'X', deviceGroup: 'g',
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
