/**
 * Tests for application bootstrap functionality.
 */

// Set DATABASE_PATH before config module loads so bootstrap uses :memory:
process.env['DATABASE_PATH'] = ':memory:';

import { closeDb, initDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { seedStocks } from '../../src/db/seed';
import {
  StockRepository,
  FanStateRepository,
  FanEventsRepository,
  AutomationRepository,
} from '../../src/db/repositories';
import type { DeviceReading, OutdoorReading } from '../../src/services/influx';
import {
  getUserService,
  userService,
  influxService,
  resetServiceSingletonsForTests,
} from '../../src/services';
import { getFanManager } from '../../src/services/fan';
import { getAutomationService } from '../../src/services/automation';
import { config } from '../../src/config';
import {
  bootstrapApplication,
  validateBootstrap,
  initFanControl,
  shutdownFanControl,
} from '../../src/bootstrap';

// Records what the fake MQTT client below would have sent, for the
// automation-wiring tests. Prefixed `mock*` so `jest.mock` below may
// reference it (babel-plugin-jest-hoist's one exception to "no out-of-scope
// references" in a mock factory).
const mockPublished: Array<{ topic: string; message: string }> = [];

jest.mock('../../src/services/mqtt', () => ({
  createMqttService: jest.fn(() => ({
    publish: (topic: string, message: string) => { mockPublished.push({ topic, message }); },
    subscribe: () => {},
    onMessage: () => {},
    end: () => {},
  })),
}));

// Override config.database.path to use in-memory SQLite for all tests.
// NOTE: `mqtt` and `fan` are intentionally omitted from this mock.
// Their absence causes initFanControl() to short-circuit (graceful-degradation guard),
// which prevents the unit test from opening a real MQTT socket or leaking
// FanControlManager retention-sweep timers across the 7+ bootstrapApplication() calls.
// WARNING: do NOT add `mqtt`/`fan` here unless you also mock
// `createMqttService` from `../../src/services/mqtt` and call manager.shutdown()
// in afterEach — otherwise the suite will open sockets and leak timers.
jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    database: { path: ':memory:' },
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
    },
    influxdb: {
      url: 'http://localhost:8086',
      token: 'test-token',
      org: 'test-org',
      bucket: 'testdb',
      measurement: 'Temp',
    },
  },
}));

describe('Application Bootstrap', () => {
  // bootstrapApplication itself does initDb + runMigrations + seedStocks now.
  beforeEach(() => {});

  afterEach(() => {
    closeDb();
    resetServiceSingletonsForTests();
    jest.restoreAllMocks();
  });

  describe('bootstrapApplication', () => {
    it('should create default admin user when no users exist', async () => {
      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(true);
      expect(result.defaultAdminUsername).toBe('admin');

      // Verify the user was actually created
      expect(await userService.countUsers()).toBe(1);
      const admin = await userService.findUserByUsername('admin');
      expect(admin?.username).toBe('admin');
      expect(admin?.role).toBe('admin');
      expect(admin?.tenants).toEqual([{ id: 'tnt_default', name: 'Standard' }]);
    });

    it('should not create default users when a user already exists', async () => {
      // Bootstrap once to set up the DB
      await bootstrapApplication();

      // The admin user was created; reset singletons so getUserService() returns
      // a fresh instance pointing at the same (still open) DB, then add another user.
      resetServiceSingletonsForTests();

      // Now mock initializeDefaultUsers to simulate "users already exist" path
      jest
        .spyOn(getUserService(), 'initializeDefaultUsers')
        .mockResolvedValueOnce(null);

      // Close and reopen the DB via a fresh bootstrap — but that would re-init.
      // Instead, test the "skip" path directly: mock the service on a second bootstrap.
      // We need to close and re-open so initDb doesn't throw.
      closeDb();
      resetServiceSingletonsForTests();

      // Spy on getUserService to inject a mock that returns null from initializeDefaultUsers
      const servicesModule = await import('../../src/services');
      jest
        .spyOn(servicesModule, 'getUserService')
        .mockReturnValue({
          initializeDefaultUsers: jest.fn().mockResolvedValue(null),
          countUsers: jest.fn().mockResolvedValue(1),
        } as unknown as ReturnType<typeof servicesModule.getUserService>);

      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(false);
      expect(result.defaultAdminUsername).toBeUndefined();
    });

    it('should throw when initializeDefaultUsers fails', async () => {
      // Spy on getUserService to inject a mock that throws
      const servicesModule = await import('../../src/services');
      jest
        .spyOn(servicesModule, 'getUserService')
        .mockReturnValue({
          initializeDefaultUsers: jest.fn().mockRejectedValue(new Error('Simulated bootstrap failure')),
        } as unknown as ReturnType<typeof servicesModule.getUserService>);

      await expect(bootstrapApplication()).rejects.toThrow('Bootstrap failed: Simulated bootstrap failure');
    });
  });

  describe('validateBootstrap', () => {
    beforeEach(async () => {
      // validateBootstrap needs the DB to be initialised; use bootstrapApplication to do it
      await bootstrapApplication();
    });

    it('should return true when users exist', async () => {
      // bootstrapApplication already created the admin user
      const isValid = await validateBootstrap();
      expect(isValid).toBe(true);
    });

    it('should return false on validation errors', async () => {
      // Mock countUsers to throw an error
      const mockError = new Error('Simulated validation error');
      jest
        .spyOn(getUserService(), 'countUsers')
        .mockRejectedValueOnce(mockError);

      // Mock console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const isValid = await validateBootstrap();

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Bootstrap validation failed:',
        'Simulated validation error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Default admin credentials', () => {
    it('should create admin with expected credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');

      expect(admin).not.toBeNull();
      expect(admin?.username).toBe('admin');
      expect(admin?.role).toBe('admin');
      expect(admin?.tenants).toEqual([{ id: 'tnt_default', name: 'Standard' }]);
      expect(admin?.active).toBe(true);

      // Verify password hash exists
      expect(admin?.passwordHash).toBeDefined();
      expect(admin?.passwordHash).not.toBe('changeme123'); // Should be hashed
    });

    it('should allow login with default admin credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');
      expect(admin).not.toBeNull();

      // Import bcrypt to verify password
      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.compare('changeme123', admin!.passwordHash);

      expect(isValid).toBe(true);
    });
  });

  describe('fan automation wiring', () => {
    // A record view of the mocked config so `mqtt`/`fan` — absent everywhere
    // else in this file to keep `initFanControl` short-circuiting (see the
    // warning above) — can be added and removed per test.
    const configRecord = config as unknown as Record<string, unknown>;

    const FAN_TEST_CONFIG = {
      mqtt: { url: 'mqtt://localhost:1883' },
      fan: {
        keepAliveMs: 900000,
        watchdogMs: 10000,
        retentionDays: 90,
        retentionSweepMs: 21600000,
        reconcileIntervalMs: 3600000,
        // Long enough that the interval never fires again during a test.
        automationIntervalMs: 3600000,
      },
    };

    const AUTOMATION_ENABLED = {
      enabled: true,
      deltaOnK: 10,
      deltaOffK: 2,
      maxOutdoorHumidityPct: 80,
      targetTempC: null,
      targetHysteresisK: 1,
      minRunMinutes: 30,
      minPauseMinutes: 30,
    };

    function grainReading(tempC: number): DeviceReading[] {
      return [{
        device: '1.1', tempTop: tempC, tempMid: tempC, tempBottom: tempC,
        humidity: 60, battery: 430, measurementTime: new Date().toISOString(),
      }];
    }

    function outdoorReading(temperature: number, humidity: number): OutdoorReading {
      const now = new Date().toISOString();
      return { temperature, humidity, temperatureTime: now, humidityTime: now };
    }

    /**
     * Settles the fire-and-forget cycle `automationService.start()` kicks off:
     * a real (async) stock read, then two mocked InfluxDB reads awaited
     * together, then the command and event write. Several macrotask hops
     * cover all of it without pinning to internal await counts.
     */
    async function flushAutomationCycle(): Promise<void> {
      for (let i = 0; i < 10; i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    async function primeDb() {
      const db = initDb({ path: ':memory:' });
      runMigrations(db);
      await seedStocks(new StockRepository(db));
      return db;
    }

    beforeEach(() => {
      mockPublished.length = 0;
    });

    afterEach(() => {
      shutdownFanControl();
      delete configRecord['mqtt'];
      delete configRecord['fan'];
    });

    it('does not construct the automation service when fan/MQTT configuration is missing', async () => {
      // Deliberately no FAN_TEST_CONFIG here — mqtt/fan stay absent, as in
      // every other test in this file.
      await primeDb();

      await initFanControl();

      expect(getAutomationService()).toBeNull();
    });

    it("after initFanControl, automation is running and its first evaluation resolves a real controller", async () => {
      Object.assign(configRecord, FAN_TEST_CONFIG);
      const db = await primeDb();
      new AutomationRepository(db).upsert('grain-watch-1', AUTOMATION_ENABLED);
      const getLatestReadings = jest
        .spyOn(influxService, 'getLatestReadings')
        .mockResolvedValue(grainReading(20));
      jest.spyOn(influxService, 'getOutdoorReading').mockResolvedValue(outdoorReading(5, 50));

      await initFanControl();
      await flushAutomationCycle();

      expect(getFanManager()).not.toBeNull();
      expect(getAutomationService()).not.toBeNull();
      // A controller resolving to `null` would return before ever reading a
      // measurement (design spec §5.2), so this call happening at all shows
      // the wiring is complete and a real controller was found — not, on its
      // own, that any particular statement in `initFanControl` had to run
      // before another: all four are synchronous and this evaluation only
      // resumes on a later microtask, after the whole function has returned
      // (see the comment above `manager.init()` in bootstrap.ts).
      expect(getLatestReadings).toHaveBeenCalledWith('corn-watch-1');
    });

    it("a persisted desired state has been recovered before automation's first evaluation reads it", async () => {
      Object.assign(configRecord, FAN_TEST_CONFIG);
      const db = await primeDb();
      new AutomationRepository(db).upsert('grain-watch-1', AUTOMATION_ENABLED);
      // A fan that was already running before the restart.
      const since = '2026-09-29T00:00:00.000Z';
      new FanStateRepository(db).upsert({
        stockId: 'grain-watch-1', desiredOn: true, since, lastCommandAt: since, updatedAt: since,
      });
      // Readings the rules agree with: the fan should indeed be on.
      jest.spyOn(influxService, 'getLatestReadings').mockResolvedValue(grainReading(20));
      jest.spyOn(influxService, 'getOutdoorReading').mockResolvedValue(outdoorReading(5, 50));

      await initFanControl();
      await flushAutomationCycle();

      // `recover()` publishes the one `on` that resumes the run. Automation's
      // first evaluation agrees with the already-resumed state and issues no
      // second, redundant `on` and no `auto_on` event. This pins the outcome
      // — the state automation reads is the recovered one — not a statement
      // order: see the comment above `manager.init()` in bootstrap.ts for why
      // that order is not, today, independently observable.
      expect(mockPublished.filter((p) => p.message === 'on')).toHaveLength(1);
      const events = new FanEventsRepository(db).listRecent('grain-watch-1', 20);
      expect(events.some((e) => e.kind === 'auto_on')).toBe(false);
    });
  });
});
