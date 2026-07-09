import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanController } from '../../../src/services/fan/fan.controller';
import type { ShellyMonitorMessage } from '../../../src/services/fan/types';

function successMsg(switchState: boolean): ShellyMonitorMessage {
  return { type: 'success', message: 'ok', switchState, inputState: switchState, timestamp: 1 };
}

async function makeController() {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceCount: 5, deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/p', fanSwitchId: 0,
  }]);
  const published: Array<'on' | 'off'> = [];
  const controller = new FanController({
    stockId: 'grain-watch-1',
    publish: (p) => published.push(p),
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000 },
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, controller, published };
}

describe('FanController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('goes OFF -> TURN_ON_PENDING -> ON on success', async () => {
    const { controller, published } = await makeController();
    expect(controller.getStatus().state).toBe('OFF');
    controller.command('on', 'user');
    expect(controller.getStatus().state).toBe('TURN_ON_PENDING');
    expect(published).toEqual(['on']);
    controller.handleShellyMessage(successMsg(true));
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().desiredOn).toBe(true);
  });

  it('watchdog switches off and faults when no success arrives', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    jest.advanceTimersByTime(10000);
    expect(published).toEqual(['on', 'off']);
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
  });

  it('re-asserts ON via keep-alive while desired on', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on', 'on']);
  });

  it('alert -> FAULT, desired off, stops keep-alive', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'alert', message: 'no follow', switchState: true, inputState: false, timestamp: 2 });
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on']); // no keep-alive re-assert after fault
  });

  it('warning only sets overlay, no state change', async () => {
    const { controller } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'warning', message: 'manual', switchState: true, inputState: true, timestamp: 3 });
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().lastWarning?.message).toBe('manual');
  });

  it('command off -> TURN_OFF_PENDING -> OFF on success(false)', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.command('off', 'user');
    expect(controller.getStatus().state).toBe('TURN_OFF_PENDING');
    expect(published).toEqual(['on', 'off']);
    controller.handleShellyMessage(successMsg(false));
    expect(controller.getStatus().state).toBe('OFF');
  });

  it('recover() resumes ON intent from persisted state', async () => {
    const { db, published } = await makeController();
    new FanStateRepository(db.db).upsert({
      stockId: 'grain-watch-1', desiredOn: true, since: '2026-07-09T09:00:00.000Z',
      lastCommandAt: '2026-07-09T09:00:00.000Z', updatedAt: '2026-07-09T09:00:00.000Z',
    });
    const controller2 = new FanController({
      stockId: 'grain-watch-1', publish: (p) => published.push(p),
      stateRepo: new FanStateRepository(db.db), eventsRepo: new FanEventsRepository(db.db),
      timings: { keepAliveMs: 900000, watchdogMs: 10000 }, now: () => new Date('2026-07-09T10:00:00.000Z'),
    });
    controller2.recover();
    expect(controller2.getStatus().state).toBe('TURN_ON_PENDING');
    expect(published).toContain('on');
  });

  it('notifies onChange listeners', async () => {
    const { controller } = await makeController();
    const seen: string[] = [];
    controller.onChange((s) => seen.push(s.state));
    controller.command('on', 'user');
    expect(seen).toContain('TURN_ON_PENDING');
  });
});
