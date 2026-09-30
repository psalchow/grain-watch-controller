import { AutomationService } from '../../../../src/services/automation/automation.service';
import type {
  AutomationState,
  AutomationServiceDeps,
} from '../../../../src/services/automation/automation.service';
import { setFanManager } from '../../../../src/services/fan';
import type { FanControlManager, FanController } from '../../../../src/services/fan';
import type { AutomationConfig, DbFanState } from '../../../../src/db/schema';
import type { FanEventInsert } from '../../../../src/db/repositories';
import type { Stock } from '../../../../src/db/types';
import type { DeviceReading, OutdoorReading } from '../../../../src/services/influx';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const INTERVAL_MS = 300_000;

const STOCK_ID = 'grain-watch-1';
const DEVICE_GROUP = 'corn-watch-1';

/** A clock the tests move by hand, so `evaluatedAt` and the minimum times are deterministic. */
let now = new Date(NOW);

function minutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

/**
 * Stands in for `FanController`: the service only ever reads `desiredOn` from
 * the status and calls `command`.
 */
class FakeController {
  desiredOn = false;
  readonly commands: Array<{ action: 'on' | 'off'; source: string }> = [];

  getStatus(): { desiredOn: boolean } {
    return { desiredOn: this.desiredOn };
  }

  command(action: 'on' | 'off', source: string): void {
    this.commands.push({ action, source });
    this.desiredOn = action === 'on';
  }

  /** Handed to the service, which only sees the two members above. */
  asController(): FanController {
    return this as unknown as FanController;
  }
}

/** In-memory stand-in for `AutomationRepository`, defaults included. */
class FakeAutomationRepository {
  private readonly rows = new Map<string, AutomationConfig>();
  private readonly defaults: AutomationConfig = {
    enabled: false,
    deltaOnK: 10,
    deltaOffK: 2,
    maxOutdoorHumidityPct: 80,
    targetTempC: 12,
    targetHysteresisK: 1,
    minRunMinutes: 30,
    minPauseMinutes: 30,
  };

  get(stockId: string): AutomationConfig {
    return { ...(this.rows.get(stockId) ?? this.defaults) };
  }

  upsert(stockId: string, config: AutomationConfig): void {
    this.rows.set(stockId, { ...config });
  }
}

function stock(overrides: Partial<Stock> = {}): Stock {
  return {
    id: STOCK_ID,
    name: 'Halle 1',
    deviceGroup: DEVICE_GROUP,
    devicePrefix: '1.',
    hasHumidity: true,
    hasGrainSensors: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    fanControlEnabled: true,
    fanTopicPrefix: 'shelly/hall-1',
    fanSwitchId: 0,
    tenantId: 'tnt_default',
    ...overrides,
  };
}

/** One fresh device with three equal layers, so mean and minimum are `tempC`. */
function grainReadings(tempC: number): DeviceReading[] {
  return [
    {
      device: '1.1',
      tempTop: tempC,
      tempMid: tempC,
      tempBottom: tempC,
      humidity: 60,
      battery: 430,
      measurementTime: minutesAgo(1),
    },
  ];
}

function outdoorReading(temperature: number, humidity: number): OutdoorReading {
  return {
    temperature,
    humidity,
    temperatureTime: minutesAgo(1),
    humidityTime: minutesAgo(1),
  };
}

function fanState(overrides: Partial<DbFanState> = {}): DbFanState {
  return {
    stockId: STOCK_ID,
    desiredOn: false,
    since: null,
    lastCommandAt: null,
    updatedAt: minutesAgo(0),
    ...overrides,
  };
}

interface Harness {
  service: AutomationService;
  controller: FakeController;
  repo: FakeAutomationRepository;
  events: FanEventInsert[];
  getLatestReadings: jest.Mock<Promise<DeviceReading[]>, [string]>;
  getOutdoorReading: jest.Mock<Promise<OutdoorReading>, [string]>;
  /** Mutable so a test can edit a row between ticks. */
  stocks: Stock[];
  /** Which stocks the fake manager holds a controller for (drives `fanControlAvailable`). */
  wired: Set<string>;
  /** Overridable so a test can retire a controller after the availability check. */
  getController: jest.Mock<FanController | null, [string]>;
  setState(next: DbFanState | null): void;
}

function setup(options: { stocks?: Stock[]; parameters?: Partial<AutomationConfig> } = {}): Harness {
  const controller = new FakeController();
  const repo = new FakeAutomationRepository();
  const events: FanEventInsert[] = [];
  const stocks = options.stocks ?? [stock()];
  const wired = new Set(stocks.map((s) => s.id));
  let current: DbFanState | null = fanState();

  // Automation is enabled with the target rule switched off, so the delta
  // rules alone decide and every test can steer the outcome with two numbers.
  for (const s of stocks) {
    repo.upsert(s.id, {
      enabled: true,
      deltaOnK: 10,
      deltaOffK: 2,
      maxOutdoorHumidityPct: 80,
      targetTempC: null,
      targetHysteresisK: 1,
      minRunMinutes: 30,
      minPauseMinutes: 30,
      ...options.parameters,
    });
  }

  const getLatestReadings = jest.fn<Promise<DeviceReading[]>, [string]>(async () =>
    grainReadings(20),
  );
  const getOutdoorReading = jest.fn<Promise<OutdoorReading>, [string]>(async () =>
    outdoorReading(5, 50),
  );
  const getController = jest.fn<FanController | null, [string]>((stockId) =>
    wired.has(stockId) ? controller.asController() : null,
  );

  // `fanControlAvailable` asks the manager registry, not the injected
  // accessor — the two are read at different moments (design spec §5.2).
  setFanManager({
    getController: (stockId: string) => (wired.has(stockId) ? {} : null),
  } as unknown as FanControlManager);

  const deps: AutomationServiceDeps = {
    automationRepo: repo,
    stateRepo: { get: () => current },
    eventsRepo: { insert: (row) => { events.push(row); } },
    readings: { getLatestReadings, getOutdoorReading },
    listStocks: async () => stocks,
    getController,
    intervalMs: INTERVAL_MS,
    now: () => new Date(now),
  };

  return {
    service: new AutomationService(deps),
    controller,
    repo,
    events,
    getLatestReadings,
    getOutdoorReading,
    stocks,
    wired,
    getController,
    setState(next: DbFanState | null) {
      current = next;
    },
  };
}

/** Advances both the fake timers and the injected clock by one interval. */
async function tick(ms: number = INTERVAL_MS): Promise<void> {
  now = new Date(now.getTime() + ms);
  await jest.advanceTimersByTimeAsync(ms);
}

/** Lets the immediate first evaluation run without moving the clock. */
async function flush(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  now = new Date(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  setFanManager(null);
});

describe('AutomationService — acting on a decision', () => {
  it('switches on and writes auto_on when the decision differs from the controller', async () => {
    // ΔT = 20 - 5 = 15, at or above deltaOnK, and nothing has been commanded
    // yet, so the minimum pause is elapsed.
    const h = setup();
    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([{ action: 'on', source: 'auto' }]);
    const event = h.events.find((e) => e.kind === 'auto_on');
    expect(event).toBeDefined();
    expect(event?.source).toBe('auto');
    expect(event?.stockId).toBe(STOCK_ID);
    expect(event?.payload).toEqual({
      reason: 'delta_ok',
      grainMeanC: 20,
      grainMinC: 20,
      outdoorTempC: 5,
      outdoorHumidityPct: 50,
      dewPointC: expect.any(Number),
      deltaT: 15,
      deltaOnK: 10,
    });
  });

  it('switches off and writes auto_off with the run duration', async () => {
    const h = setup();
    // ΔT = 6 - 5 = 1, below deltaOffK, and the fan has run past the minimum.
    h.getLatestReadings.mockImplementation(async () => grainReadings(6));
    h.controller.desiredOn = true;
    h.setState(fanState({ desiredOn: true, since: minutesAgo(60) }));

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([{ action: 'off', source: 'auto' }]);
    const event = h.events.find((e) => e.kind === 'auto_off');
    expect(event?.source).toBe('auto');
    expect(event?.payload).toEqual({
      reason: 'delta_too_small',
      grainMeanC: 6,
      grainMinC: 6,
      outdoorTempC: 5,
      outdoorHumidityPct: 50,
      dewPointC: expect.any(Number),
      deltaT: 1,
      deltaOnK: 10,
      runMinutes: 60,
    });
  });

  it('issues nothing when the decision agrees with the controller', async () => {
    const h = setup();
    h.controller.desiredOn = true;
    h.setState(fanState({ desiredOn: true, since: minutesAgo(60) }));

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('issues nothing on a hold', async () => {
    const h = setup();
    // ΔT = 10 - 5 = 5, strictly between deltaOffK and deltaOnK.
    h.getLatestReadings.mockImplementation(async () => grainReadings(10));

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.service.getState(STOCK_ID).reason).toBe('hold');
  });

  it('performs no command when automation was switched off between the read and the action', async () => {
    const h = setup();
    // A manual command landing in the window the two awaited queries open.
    h.getOutdoorReading.mockImplementation(async () => {
      h.repo.upsert(STOCK_ID, { ...h.repo.get(STOCK_ID), enabled: false });
      return outdoorReading(5, 50);
    });

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([]);
    expect(h.events).toEqual([]);
  });
});

describe('AutomationService — read failures', () => {
  it('switches off with no_data on the third consecutive failure, not before', async () => {
    const h = setup();
    h.controller.desiredOn = true;
    h.setState(fanState({ desiredOn: true, since: minutesAgo(60) }));
    h.getLatestReadings.mockRejectedValue(new Error('InfluxDB unreachable'));

    h.service.start();
    await flush();
    expect(h.controller.commands).toEqual([]);

    await tick();
    expect(h.controller.commands).toEqual([]);

    await tick();

    expect(h.controller.commands).toEqual([{ action: 'off', source: 'auto' }]);
    const event = h.events.find((e) => e.kind === 'auto_off');
    expect(event?.payload).toMatchObject({
      reason: 'no_data',
      grainMeanC: null,
      outdoorTempC: null,
      deltaT: null,
    });

    // The fourth and fifth failures decide no_data again, but the fan is
    // already off, so the comparison against the controller's desired state
    // blocks any further command. Held in place here because the service
    // keeps no remembered decision to compare against instead.
    await tick();
    await tick();
    h.service.stop();

    expect(h.controller.commands).toHaveLength(1);
    expect(h.events.filter((e) => e.kind === 'auto_off')).toHaveLength(1);
  });

  it('resets the counter on a successful read', async () => {
    const h = setup();
    h.controller.desiredOn = true;
    h.setState(fanState({ desiredOn: true, since: minutesAgo(60) }));
    h.getLatestReadings.mockRejectedValue(new Error('InfluxDB unreachable'));

    h.service.start();
    await flush();
    await tick();

    // One good tick in between; ΔT = 15 keeps the fan on, so nothing is commanded.
    h.getLatestReadings.mockImplementation(async () => grainReadings(20));
    await tick();
    expect(h.controller.commands).toEqual([]);

    h.getLatestReadings.mockRejectedValue(new Error('InfluxDB unreachable'));
    await tick();
    await tick();
    h.service.stop();

    expect(h.controller.commands).toEqual([]);
  });
});

describe('AutomationService — selection', () => {
  it('skips a stock whose controller was retired, without reading', async () => {
    const h = setup();
    h.getController.mockReturnValue(null);

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.getLatestReadings).not.toHaveBeenCalled();
    expect(h.getOutdoorReading).not.toHaveBeenCalled();
    expect(h.controller.commands).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('issues no command when the controller disappears between the read and the action', async () => {
    const h = setup();
    // The stock is declared unserviceable while the two awaited queries run.
    // `FanControlManager.markRetiring` does that without touching `enabled`,
    // so the flag re-read below the decision cannot catch it — only a
    // controller resolved immediately before acting can (design spec §5.2).
    h.getOutdoorReading.mockImplementation(async () => {
      h.wired.delete(STOCK_ID);
      return outdoorReading(5, 50);
    });

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('leaves out a stock without fan control and one without grain thermometers', async () => {
    const h = setup({
      stocks: [
        stock(),
        stock({ id: 'no-fan', deviceGroup: 'group-no-fan', fanControlEnabled: false }),
        stock({ id: 'no-grain', deviceGroup: 'group-no-grain', hasGrainSensors: false }),
      ],
    });

    h.service.start();
    await flush();
    h.service.stop();

    const groupsRead = h.getLatestReadings.mock.calls.map(([group]) => group);
    expect(groupsRead).toEqual([DEVICE_GROUP]);
    expect(h.getOutdoorReading.mock.calls.map(([group]) => group)).toEqual([DEVICE_GROUP]);
  });

  it('honours a stock row edited since the last tick on the next one', async () => {
    const h = setup({ stocks: [stock({ fanControlEnabled: false })] });

    h.service.start();
    await flush();
    expect(h.getLatestReadings).not.toHaveBeenCalled();

    // The row is edited underneath the running process.
    h.stocks[0] = stock({ fanControlEnabled: true });

    await tick();
    h.service.stop();

    expect(h.getLatestReadings).toHaveBeenCalledWith(DEVICE_GROUP);
    expect(h.controller.commands).toEqual([{ action: 'on', source: 'auto' }]);
  });
});

describe('AutomationService — self-disable', () => {
  it('flips the flag, writes automation_disabled with the cause, and is a no-op the second time', () => {
    const h = setup();

    h.service.disable(STOCK_ID, 'local_switch');

    expect(h.repo.get(STOCK_ID).enabled).toBe(false);
    expect(h.events).toEqual([
      {
        stockId: STOCK_ID,
        ts: now.toISOString(),
        kind: 'automation_disabled',
        payload: { cause: 'local_switch' },
        source: 'auto',
      },
    ]);

    h.service.disable(STOCK_ID, 'fault');

    expect(h.events).toHaveLength(1);
  });

  it('keeps the other parameters when it switches automation off', () => {
    const h = setup({ parameters: { deltaOnK: 14, minPauseMinutes: 45 } });

    h.service.disable(STOCK_ID, 'fan_control_withdrawn');

    expect(h.repo.get(STOCK_ID)).toMatchObject({
      enabled: false,
      deltaOnK: 14,
      minPauseMinutes: 45,
    });
  });
});

describe('AutomationService — the cycle and the listeners', () => {
  it('evaluates once immediately on start, before the first interval elapses', async () => {
    const h = setup();

    h.service.start();
    await flush();

    expect(h.getLatestReadings).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('stops evaluating after stop()', async () => {
    const h = setup();

    h.service.start();
    await flush();
    h.service.stop();
    await tick();

    expect(h.getLatestReadings).toHaveBeenCalledTimes(1);
  });

  it('evaluates a single stock on demand, without waiting for the interval', async () => {
    const h = setup();

    await h.service.evaluateStock(STOCK_ID);

    expect(h.controller.commands).toEqual([{ action: 'on', source: 'auto' }]);
  });

  it('fires onChange after every evaluation, not only on a changed reason', async () => {
    const h = setup();
    // ΔT = 5 — a hold that stays a hold, so the reason never changes.
    h.getLatestReadings.mockImplementation(async () => grainReadings(10));
    const seen: AutomationState[] = [];
    const unsubscribe = h.service.onChange(STOCK_ID, (state) => seen.push(state));

    h.service.start();
    await flush();
    await tick();
    h.service.stop();

    expect(seen).toHaveLength(2);
    expect(seen[0]?.reason).toBe('hold');
    expect(seen[1]?.reason).toBe('hold');
    expect(seen[0]?.evaluatedAt).not.toBe(seen[1]?.evaluatedAt);
    expect(seen[1]?.enabled).toBe(true);

    unsubscribe();
    await tick();
    expect(seen).toHaveLength(2);
  });

  it('pushes the state when notifyChanged is called, without evaluating', async () => {
    const h = setup();
    const seen: AutomationState[] = [];
    h.service.onChange(STOCK_ID, (state) => seen.push(state));

    h.service.notifyChanged(STOCK_ID);

    expect(seen).toHaveLength(1);
    expect(h.getLatestReadings).not.toHaveBeenCalled();
  });

  it('reports an unevaluated stock as never evaluated', () => {
    const h = setup();

    expect(h.service.getState(STOCK_ID)).toEqual({
      enabled: true,
      reason: null,
      evaluatedAt: null,
    });
  });

  it('confines a throw outside the read path to that stock, and evaluateStock never rejects', async () => {
    // `getController` sits outside the try/catch the failure counter owns, so
    // only the per-stock containment can catch this one.
    const h = setup({
      stocks: [stock({ id: 'broken', deviceGroup: 'group-broken' }), stock()],
    });
    h.getController.mockImplementation((stockId: string) => {
      if (stockId === 'broken') throw new Error('the controller registry broke');
      return h.controller.asController();
    });

    // The documented contract: a failed evaluation must not reject into the
    // request that triggered it.
    await expect(h.service.evaluateStock('broken')).resolves.toBeUndefined();
    expect(h.controller.commands).toEqual([]);

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([{ action: 'on', source: 'auto' }]);
  });

  it('confines an error in one stock to that stock', async () => {
    const h = setup({
      stocks: [stock({ id: 'broken', deviceGroup: 'group-broken' }), stock()],
    });
    h.getLatestReadings.mockImplementation(async (group: string) => {
      if (group === 'group-broken') throw new Error('InfluxDB unreachable');
      return grainReadings(20);
    });

    h.service.start();
    await flush();
    h.service.stop();

    expect(h.controller.commands).toEqual([{ action: 'on', source: 'auto' }]);
  });
});
