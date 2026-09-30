import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanController, type FanControllerDeps } from '../../../src/services/fan/fan.controller';
import type { FanState, InterferenceCause, ShellyMonitorMessage } from '../../../src/services/fan/types';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';

function successMsg(switchState: boolean): ShellyMonitorMessage {
  return { type: 'success', message: 'ok', switchState, inputState: switchState, timestamp: 1 };
}

async function makeController(overrides: Partial<FanControllerDeps> = {}) {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, hasGrainSensors: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/p', fanSwitchId: 0,
    tenantId: DEFAULT_TENANT_ID,
  }]);
  const published: Array<'on' | 'off'> = [];
  const controller = new FanController({
    stockId: 'grain-watch-1',
    publish: (p) => published.push(p),
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000 },
    now: () => new Date('2026-07-09T10:00:00.000Z'),
    ...overrides,
  });
  return { db, controller, published };
}

describe('FanController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('goes OFF -> TURN_ON_PENDING -> ON on success', async () => {
    const { controller, published } = await makeController();
    expect(controller.getStatus().state).toBe('OFF');
    controller.command('on');
    expect(controller.getStatus().state).toBe('TURN_ON_PENDING');
    expect(published).toEqual(['on']);
    controller.handleShellyMessage(successMsg(true));
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().desiredOn).toBe(true);
  });

  it('publishes even when a status subscriber throws', async () => {
    const { controller, published } = await makeController();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    controller.onChange(() => {
      throw new Error('subscriber blew up');
    });
    const seen: string[] = [];
    controller.onChange((status) => seen.push(status.state));

    controller.command('on');

    // The throw is contained: the later subscriber still hears it, and the
    // command reaches MQTT — the emit sits between the state change and the
    // publish.
    expect(published).toEqual(['on']);
    expect(seen).toEqual(['TURN_ON_PENDING']);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('watchdog switches off and faults when no success arrives', async () => {
    const { controller, published } = await makeController();
    controller.command('on');
    jest.advanceTimersByTime(10000);
    expect(published).toEqual(['on', 'off']);
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
  });

  it('re-asserts ON via keep-alive while desired on', async () => {
    const { controller, published } = await makeController();
    controller.command('on');
    controller.handleShellyMessage(successMsg(true));
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on', 'on']);
  });

  it('alert -> FAULT, desired off, stops keep-alive', async () => {
    const { controller, published } = await makeController();
    controller.command('on');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'alert', message: 'no follow', switchState: true, inputState: false, timestamp: 2 });
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on']); // no keep-alive re-assert after fault
  });

  it('a warning with the contactor still engaged sets the overlay, publishes off, clears the desired state, and reports ON', async () => {
    const { controller, published } = await makeController();
    controller.command('on');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'warning', message: 'manual', switchState: true, inputState: true, timestamp: 3 });
    // The reported state stays ON because the contactor is still engaged, but
    // that is the device's report, not an unchanged state: a warning stands
    // the desired state down and publishes one off (design spec §5.6).
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().lastWarning?.message).toBe('manual');
    expect(published).toEqual(['on', 'off']);
    expect(controller.getStatus().desiredOn).toBe(false);
  });

  it('clears the warning overlay once the device confirms the commanded state', async () => {
    const { controller } = await makeController();
    controller.command('on');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'warning', message: 'manual', switchState: true, inputState: true, timestamp: 3 });
    expect(controller.getStatus().lastWarning).not.toBeNull();

    // The contactor is back under control and reports success again.
    controller.handleShellyMessage(successMsg(true));

    expect(controller.getStatus().lastWarning).toBeNull();
    // The record of the warning survives in the event log.
    expect(controller.getRecentEvents(50).some((e) => e.kind === 'warning')).toBe(true);
  });

  it('clears the alert overlay when the fan recovers from a fault', async () => {
    const { controller } = await makeController();
    controller.command('on');
    controller.handleShellyMessage({ type: 'alert', message: 'stuck', switchState: false, inputState: false, timestamp: 2 });
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().lastAlert).not.toBeNull();

    controller.command('on');
    controller.handleShellyMessage(successMsg(true));

    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().lastAlert).toBeNull();
    expect(controller.getRecentEvents(50).some((e) => e.kind === 'alert')).toBe(true);
  });

  it('command off -> TURN_OFF_PENDING -> OFF on success(false)', async () => {
    const { controller, published } = await makeController();
    controller.command('on');
    controller.handleShellyMessage(successMsg(true));
    controller.command('off');
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
    controller.command('on');
    expect(seen).toContain('TURN_ON_PENDING');
  });

  describe('contactor overlay and local switching (automation core)', () => {
    it('contactorEngaged starts null and follows inputState, never switchState', async () => {
      const { controller } = await makeController();
      expect(controller.getStatus().contactorEngaged).toBeNull();

      controller.handleShellyMessage(successMsg(true));
      expect(controller.getStatus().contactorEngaged).toBe(true);

      // switchState deliberately disagrees with inputState here: a warning
      // carries desiredInputState in switchState, not the real input.
      controller.handleShellyMessage({ type: 'warning', message: 'manual', switchState: false, inputState: true, timestamp: 2 });
      expect(controller.getStatus().contactorEngaged).toBe(true);

      controller.handleShellyMessage({ type: 'alert', message: 'stuck', switchState: true, inputState: false, timestamp: 3 });
      expect(controller.getStatus().contactorEngaged).toBe(false);
    });

    it('a warning while off publishes exactly one off, stays desiredOn false, logs a command with source shelly, calls onInterference, and reports ON from inputState — never TURN_OFF_PENDING', async () => {
      const interference: InterferenceCause[] = [];
      const { controller, published } = await makeController({ onInterference: (c) => interference.push(c) });
      expect(controller.getStatus().state).toBe('OFF');
      expect(controller.getStatus().desiredOn).toBe(false);
      const seen: FanState[] = [];
      controller.onChange((s) => seen.push(s.state));

      controller.handleShellyMessage({ type: 'warning', message: 'local on', switchState: false, inputState: true, timestamp: 1 });

      expect(published).toEqual(['off']);
      expect(controller.getStatus().desiredOn).toBe(false);
      const commandEvent = controller.getRecentEvents(10).find((e) => e.kind === 'command');
      expect(commandEvent?.source).toBe('shelly');
      expect(interference).toEqual(['local_switch']);
      expect(controller.getStatus().state).toBe('ON');
      // Covers both the no-pending-state rule and the listener notification
      // that makes a locally running fan visible in the app: a bare field
      // assignment instead of setState would leave `seen` empty and still
      // satisfy a merely negative "not TURN_OFF_PENDING" check.
      expect(seen).toEqual(['ON']);
    });

    it('the same warning with inputState false reports OFF', async () => {
      const { controller, published } = await makeController();

      controller.handleShellyMessage({ type: 'warning', message: 'still off', switchState: false, inputState: false, timestamp: 1 });

      expect(published).toEqual(['off']);
      expect(controller.getStatus().state).toBe('OFF');
    });

    it('a warning while the fan was on clears the keep-alive and persists desiredOn=false, so no further on is published', async () => {
      const { db, controller, published } = await makeController();
      controller.command('on');
      controller.handleShellyMessage(successMsg(true));
      expect(published).toEqual(['on']);

      controller.handleShellyMessage({ type: 'warning', message: 'local off', switchState: true, inputState: false, timestamp: 2 });
      expect(published).toEqual(['on', 'off']);
      expect(controller.getStatus().desiredOn).toBe(false);
      // Pins the persisted row, not just the in-memory flag: dropping
      // persistState() from the stand-down would leave desiredOn=true here,
      // and a restart's recover() would re-assert 'on' against the person
      // standing at the contactor.
      expect(new FanStateRepository(db.db).get('grain-watch-1')?.desiredOn).toBe(false);

      jest.advanceTimersByTime(900000);
      expect(published).toEqual(['on', 'off']); // no keep-alive re-assert after the warning
    });

    it('an alert calls onInterference with fault', async () => {
      const interference: InterferenceCause[] = [];
      const { controller } = await makeController({ onInterference: (c) => interference.push(c) });
      controller.command('on');

      controller.handleShellyMessage({ type: 'alert', message: 'no follow', switchState: true, inputState: false, timestamp: 2 });

      expect(interference).toEqual(['fault']);
    });

    it('a safety_shutoff calls onInterference with fault', async () => {
      const interference: InterferenceCause[] = [];
      const { controller } = await makeController({ onInterference: (c) => interference.push(c) });
      controller.command('on');
      controller.handleShellyMessage(successMsg(true));

      controller.handleShellyMessage({ type: 'safety_shutoff', message: 'self-protect', switchState: false, inputState: false, timestamp: 2 });

      expect(interference).toEqual(['fault']);
    });

    it('a watchdog_off does not call onInterference', async () => {
      const interference: InterferenceCause[] = [];
      const { controller } = await makeController({ onInterference: (c) => interference.push(c) });

      controller.command('on');
      jest.advanceTimersByTime(10000);

      expect(controller.getStatus().state).toBe('FAULT');
      expect(interference).toEqual([]);
    });

    it('a user off while the desired state is already false publishes, persists and logs but leaves the reported state unchanged', async () => {
      const { db, controller, published } = await makeController();
      expect(controller.getStatus().state).toBe('OFF');
      expect(controller.getStatus().desiredOn).toBe(false);
      const seen: FanState[] = [];
      controller.onChange((s) => seen.push(s.state));

      controller.command('off');

      expect(published).toEqual(['off']);
      expect(controller.getStatus().state).toBe('OFF');
      expect(controller.getStatus().desiredOn).toBe(false);
      const commandEvent = controller.getRecentEvents(10).find((e) => e.kind === 'command');
      expect(commandEvent?.source).toBe('user');
      // Pins the actual persisted row, not just the in-memory flag —
      // `lastCommandAt` is what the automation's minimum pause is measured
      // against (design spec §3.3), so it must move even on a redundant off.
      const persisted = new FanStateRepository(db.db).get('grain-watch-1');
      expect(persisted?.desiredOn).toBe(false);
      expect(persisted?.lastCommandAt).toBe('2026-07-09T10:00:00.000Z');
      expect(seen).not.toContain('TURN_OFF_PENDING');
    });
  });
});
