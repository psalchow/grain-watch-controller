import { selectFanStocks } from '../../../src/services/fan/fan.manager';
import type { Stock } from '../../../src/db/types';
import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanControlManager } from '../../../src/services/fan/fan.manager';

function fakeMqtt() {
  const published: Array<{ topic: string; message: string }> = [];
  const subscribed: string[] = [];
  let handler: ((t: string, p: string) => void) | null = null;
  let ended = false;
  return {
    published, subscribed,
    emit: (t: string, p: string) => handler?.(t, p),
    isEnded: () => ended,
    mqtt: {
      publish: (topic: string, message: string) => { published.push({ topic, message }); },
      subscribe: (topic: string) => { subscribed.push(topic); },
      onMessage: (l: (t: string, p: string) => void) => { handler = l; },
      end: () => { ended = true; },
    },
  };
}

async function setup() {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceCount: 5, deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', fanSwitchId: 0,
  }]);
  const f = fakeMqtt();
  const manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
    mqtt: f.mqtt,
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000 },
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, manager, f };
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
    expect(manager.getController('grain-watch-1')!.getStatus().shellyOnline).toBe(true);
  });

  it('publishes to the command topic when the controller acts', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.getController('grain-watch-1')!.command('on');
    expect(f.published).toContainEqual({ topic: '/corn-watch/actors/corn-watch-1/fan-control/command/switch:0', message: 'on' });
  });

  it('exposes a controller for fan stocks and none for non-fan stocks', async () => {
    const { manager } = await setup();
    manager.init();
    expect(manager.getController('grain-watch-1')).not.toBeNull();
    expect(manager.getController('grain-watch-2')).toBeNull();
  });

  it('closes the MQTT connection on shutdown', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.shutdown();
    expect(f.isEnded()).toBe(true);
  });
});

describe('selectFanStocks', () => {
  const base: Stock = {
    id: 'x', name: 'X', deviceCount: 5, deviceGroup: 'g', devicePrefix: '1',
    hasHumidity: false, active: true, createdAt: 'x', fanControlEnabled: false, fanSwitchId: 0,
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
