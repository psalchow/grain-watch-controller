import request from 'supertest';
import type { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { eq } from 'drizzle-orm';
import { initDb, closeDb, getDb } from '../../src/db';
import { stocks, AUTOMATION_DEFAULTS, DEFAULT_TENANT_ID } from '../../src/db/schema';
import type { AutomationConfig } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';
import {
  StockRepository,
  FanStateRepository,
  FanEventsRepository,
  AutomationRepository,
} from '../../src/db/repositories';
import { seedStocks } from '../../src/db/seed';
import { FanControlManager } from '../../src/services/fan/fan.manager';
import { setFanManager } from '../../src/services/fan';
import { AutomationService, setAutomationService } from '../../src/services/automation';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

jest.mock('../../src/config', () => ({
  config: {
    port: 3000, nodeEnv: 'test',
    jwt: { secret: 'test-secret-key-for-testing-only-must-be-long-enough', expiresIn: '24h' },
    influxdb: { url: 'http://localhost:8086', token: 't', org: 'o', bucket: 'b', measurement: 'Temp', outdoorTemperatureMeasurement: 'ot', outdoorHumidityMeasurement: 'oh', latestLookback: '1h', offlineAfter: '15m', outdoorMaxSkew: '15m' },
  },
}));

function token(): string {
  return jwt.sign({ userId: 'u1', username: 'admin', role: 'admin', tenants: [{ id: 'tnt_default', name: 'Standard' }] }, JWT_SECRET, { expiresIn: '1h' });
}

/** A viewer belonging to a tenant that owns none of the seeded halls. */
function foreignToken(): string {
  return jwt.sign({ userId: 'u2', username: 'viewer', role: 'viewer', tenants: [{ id: 'tnt_foreign', name: 'Fremder Betrieb' }] }, JWT_SECRET, { expiresIn: '1h' });
}

const published: Array<{ topic: string; message: string }> = [];

let manager: FanControlManager;

beforeEach(async () => {
  initDb({ path: ':memory:' });
  runMigrations(getDb());
  await seedStocks(new StockRepository(getDb()));
  // A hall with fan control but no grain thermometers: automation is
  // unavailable for it although the fan endpoints serve it (design spec §3.2).
  await new StockRepository(getDb()).upsertMany([
    {
      id: 'fan-only',
      name: 'Halle ohne Thermometer',
      deviceGroup: 'corn-watch-9',
      devicePrefix: '9',
      hasHumidity: false,
      hasGrainSensors: false,
      active: true,
      createdAt: '2026-06-02T00:00:00.000Z',
      fanControlEnabled: true,
      fanTopicPrefix: '/q',
      fanSwitchId: 0,
      tenantId: DEFAULT_TENANT_ID,
    },
  ]);
  resetServiceSingletonsForTests();
  published.length = 0;
  manager = new FanControlManager({
    stocks: [
      { stockId: 'grain-watch-1', topicPrefix: '/p', switchId: 0 },
      { stockId: 'fan-only', topicPrefix: '/q', switchId: 0 },
    ],
    mqtt: { publish: (topic, message) => published.push({ topic, message }), subscribe: () => {}, onMessage: () => {}, end: () => {} },
    stateRepo: new FanStateRepository(getDb()),
    eventsRepo: new FanEventsRepository(getDb()),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000, reconcileIntervalMs: 60000 },
    fanEnabledStockIds: async () => {
      const current = await new StockRepository(getDb()).findAll();
      return new Set(current.filter((s) => s.fanControlEnabled && s.fanTopicPrefix).map((s) => s.id));
    },
  });
  manager.init();
  setFanManager(manager);
});

afterEach(() => { manager.shutdown(); setFanManager(null); setAutomationService(null); closeDb(); });

function app() { return finaliseApp(createApp({ enableLogging: false })); }

describe('fan endpoints', () => {
  it('GET /fan returns status for a fan hall', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('OFF');
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('GET /fan returns 404 for a non-fan hall', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-2/fan').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('POST /fan/command on publishes and moves to pending', async () => {
    const res = await request(app()).post('/api/v1/stocks/grain-watch-1/fan/command').set('Authorization', `Bearer ${token()}`).send({ action: 'on' });
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('TURN_ON_PENDING');
    expect(published).toContainEqual({ topic: '/p/command/switch:0', message: 'on' });
  });

  it('stops serving a stock whose row was disabled under the running process', async () => {
    // The operator's kill switch: clear the flag without a restart, so the
    // controller built at startup is still in the manager.
    getDb()
      .update(stocks)
      .set({ fanControlEnabled: false })
      .where(eq(stocks.id, 'grain-watch-1'))
      .run();

    const status = await request(app()).get('/api/v1/stocks/grain-watch-1/fan').set('Authorization', `Bearer ${token()}`);
    expect(status.status).toBe(404);

    const command = await request(app())
      .post('/api/v1/stocks/grain-watch-1/fan/command')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'on' });
    expect(command.status).toBe(404);
    // The request path refuses the stock without touching MQTT: neither the
    // status read nor the rejected command publishes anything. Switching the
    // fan off is the reconciliation tick's job, covered by the next test.
    expect(published).toEqual([]);

    // That tick then sends the one best-effort `off`, even for a fan that is
    // already off.
    await manager.reconcile();
    expect(published).toEqual([{ topic: '/p/command/switch:0', message: 'off' }]);
  });

  it('switches a running fan off when its row is cleared under the process', async () => {
    const on = await request(app())
      .post('/api/v1/stocks/grain-watch-1/fan/command')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'on' });
    expect(on.status).toBe(200);
    expect(published).toEqual([{ topic: '/p/command/switch:0', message: 'on' }]);

    getDb()
      .update(stocks)
      .set({ fanControlEnabled: false })
      .where(eq(stocks.id, 'grain-watch-1'))
      .run();

    // The request path only stops serving the stock…
    const after = await request(app()).get('/api/v1/stocks/grain-watch-1/fan').set('Authorization', `Bearer ${token()}`);
    expect(after.status).toBe(404);
    expect(published.some((p) => p.message === 'off')).toBe(false);

    // …the reconciliation tick is what switches the fan off.
    await manager.reconcile();
    expect(published).toContainEqual({ topic: '/p/command/switch:0', message: 'off' });
  });

  it('POST /fan/command disables automation with manual_command, unconditionally and before the switch', async () => {
    const disable = jest.fn();
    // `getState` too: the command response carries the automation snapshot, so
    // the page it answers cannot keep showing an automation this very command
    // has just switched off.
    setAutomationService({
      disable,
      getState: () => ({ enabled: false, reason: null, evaluatedAt: null }),
    } as unknown as AutomationService);
    const controller = manager.getController('grain-watch-1')!;
    const commandSpy = jest.spyOn(controller, 'command');

    const res = await request(app())
      .post('/api/v1/stocks/grain-watch-1/fan/command')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'on' });

    expect(res.status).toBe(200);
    expect(disable).toHaveBeenCalledWith('grain-watch-1', 'manual_command');
    // The controller reads no automation-enabled flag itself — whether this is
    // a no-op for a stock already disabled is the service's call, not the
    // controller's, and that assertion belongs to the service's own tests
    // (design spec §5.5, brief Step 1). What this controller must get right is
    // calling it every time, ahead of the switch.
    expect(disable.mock.invocationCallOrder[0]).toBeLessThan(commandSpy.mock.invocationCallOrder[0]!);
    commandSpy.mockRestore();
  });

  it('POST /fan/command rejects invalid action', async () => {
    const res = await request(app()).post('/api/v1/stocks/grain-watch-1/fan/command').set('Authorization', `Bearer ${token()}`).send({ action: 'spin' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan');
    expect(res.status).toBe(401);
  });

  it('GET /fan/stream sends SSE headers that survive an nginx reverse proxy', async () => {
    // The stream never completes, so read the headers off the response event
    // and abort rather than awaiting the request.
    const req = request(app())
      .get('/api/v1/stocks/grain-watch-1/fan/stream')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(false);

    const headers = await new Promise<Record<string, string>>(
      (resolve, reject) => {
        req.on('response', (res) => {
          // Aborting below resets the socket; swallow the reset so it does not
          // surface as an unhandled error event once the test has finished.
          res.on('error', () => {});
          resolve(res.headers as Record<string, string>);
        });
        req.on('error', reject);
        req.end();
      }
    );
    req.abort();

    expect(headers['content-type']).toContain('text/event-stream');
    expect(headers['cache-control']).toContain('no-cache');
    // Without this nginx buffers the stream and status changes stall.
    expect(headers['x-accel-buffering']).toBe('no');
  });

  it('GET /fan carries the contactor state and the automation snapshot', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    // `null` until the Shelly has said anything, but present in the payload.
    expect(res.body.status).toHaveProperty('contactorEngaged', null);
    expect(res.body.automation).toEqual({
      available: true,
      enabled: false,
      reason: null,
      evaluatedAt: null,
    });
  });

  it('GET /fan reports automation as unavailable for a hall without grain thermometers', async () => {
    const res = await request(app()).get('/api/v1/stocks/fan-only/fan').set('Authorization', `Bearer ${token()}`);

    // The fan endpoints serve the hall — only the automation is out of reach.
    expect(res.status).toBe(200);
    expect(res.body.automation.available).toBe(false);
  });
});

/** The stored configuration used by the write tests; every value differs from the default. */
const STORED_CONFIG: AutomationConfig = {
  enabled: true,
  deltaOnK: 8,
  deltaOffK: 3,
  maxOutdoorHumidityPct: 75,
  targetTempC: 10,
  targetHysteresisK: 0.5,
  minRunMinutes: 45,
  minPauseMinutes: 20,
};

const AUTOMATION_URL = '/api/v1/stocks/grain-watch-1/fan/automation';

describe('automation configuration endpoints', () => {
  it('GET returns the defaults while no row exists', async () => {
    const res = await request(app()).get(AUTOMATION_URL).set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(AUTOMATION_DEFAULTS);
  });

  it('PUT stores and echoes the configuration, and a later GET returns it', async () => {
    const put = await request(app()).put(AUTOMATION_URL).set('Authorization', `Bearer ${token()}`).send(STORED_CONFIG);
    expect(put.status).toBe(200);
    expect(put.body).toEqual(STORED_CONFIG);

    const get = await request(app()).get(AUTOMATION_URL).set('Authorization', `Bearer ${token()}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(STORED_CONFIG);
  });

  it('accepts a null targetTempC', async () => {
    const res = await request(app())
      .put(AUTOMATION_URL)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...STORED_CONFIG, targetTempC: null });

    expect(res.status).toBe(200);
    expect(res.body.targetTempC).toBeNull();
  });

  // Every bound from the plan's Global Constraints, both ends where there are two.
  it.each([
    ['deltaOnK above 20', { deltaOnK: 20.1 }],
    ['deltaOffK below 2', { deltaOffK: 1.9 }],
    ['deltaOffK not below deltaOnK', { deltaOnK: 6, deltaOffK: 6 }],
    ['deltaOffK above deltaOnK', { deltaOnK: 6, deltaOffK: 7 }],
    ['maxOutdoorHumidityPct below 40', { maxOutdoorHumidityPct: 39.9 }],
    ['maxOutdoorHumidityPct above 100', { maxOutdoorHumidityPct: 100.1 }],
    ['targetTempC below -10', { targetTempC: -10.1 }],
    ['targetTempC above 30', { targetTempC: 30.1 }],
    ['targetHysteresisK below 0', { targetHysteresisK: -0.1 }],
    ['targetHysteresisK above 5', { targetHysteresisK: 5.1 }],
    ['minRunMinutes below 0', { minRunMinutes: -1 }],
    ['minRunMinutes above 240', { minRunMinutes: 241 }],
    ['a fractional minRunMinutes', { minRunMinutes: 30.5 }],
    ['minPauseMinutes below 5', { minPauseMinutes: 4 }],
    ['minPauseMinutes above 240', { minPauseMinutes: 241 }],
    ['a fractional minPauseMinutes', { minPauseMinutes: 30.5 }],
    ['a non-boolean enabled', { enabled: 'yes' }],
    ['a missing field', { minPauseMinutes: undefined }],
  ])('PUT rejects %s with 400', async (_name, patch) => {
    const res = await request(app())
      .put(AUTOMATION_URL)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...STORED_CONFIG, ...patch });

    expect(res.status).toBe(400);
    // Nothing was stored: the read still answers with the defaults.
    expect(new AutomationRepository(getDb()).get('grain-watch-1')).toEqual(AUTOMATION_DEFAULTS);
  });

  it.each([['get'], ['put']] as const)('%s answers 404 for a hall without fan control', async (method) => {
    const res = await call(method, '/api/v1/stocks/grain-watch-2/fan/automation', token());

    expect(res.status).toBe(404);
  });

  it.each([['get'], ['put']] as const)(
    '%s answers 404 for a hall without grain thermometers',
    async (method) => {
      const res = await call(method, '/api/v1/stocks/fan-only/fan/automation', token());

      expect(res.status).toBe(404);
    }
  );

  it.each([['get'], ['put']] as const)('%s answers 403 for a user outside the tenant', async (method) => {
    const res = await call(method, AUTOMATION_URL, foreignToken());

    expect(res.status).toBe(403);
  });

  it('PUT writes automation_configured with the values before and after', async () => {
    const res = await request(app()).put(AUTOMATION_URL).set('Authorization', `Bearer ${token()}`).send(STORED_CONFIG);
    expect(res.status).toBe(200);

    const events = new FanEventsRepository(getDb()).listRecent('grain-watch-1', 50);
    const configured = events.find((e) => e.kind === 'automation_configured');
    expect(configured).toBeDefined();
    expect(configured!.source).toBe('user');
    expect(configured!.payload).toEqual({ before: AUTOMATION_DEFAULTS, after: STORED_CONFIG });
  });

  it('evaluates the stock when automation is switched on', async () => {
    const service = stubService();

    const res = await request(app()).put(AUTOMATION_URL).set('Authorization', `Bearer ${token()}`).send(STORED_CONFIG);

    expect(res.status).toBe(200);
    expect(service.evaluateStock).toHaveBeenCalledWith('grain-watch-1');
    // Switching on needs no explicit push: the evaluation emits on its own (design spec §7.1).
    expect(service.notifyChanged).not.toHaveBeenCalled();
  });

  it('neither evaluates nor pushes when only a parameter changes', async () => {
    new AutomationRepository(getDb()).upsert('grain-watch-1', STORED_CONFIG);
    const service = stubService();

    const res = await request(app())
      .put(AUTOMATION_URL)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...STORED_CONFIG, minRunMinutes: 60 });

    expect(res.status).toBe(200);
    expect(service.evaluateStock).not.toHaveBeenCalled();
    expect(service.notifyChanged).not.toHaveBeenCalled();
  });

  it('pushes to an open stream when automation is switched off', async () => {
    new AutomationRepository(getDb()).upsert('grain-watch-1', STORED_CONFIG);
    setAutomationService(realService());
    const instance = app();
    const stream = await openFanStream(instance, 'grain-watch-1');

    try {
      const first = await stream.next();
      expect(first.automation).toMatchObject({ available: true, enabled: true });

      const res = await request(instance)
        .put(AUTOMATION_URL)
        .set('Authorization', `Bearer ${token()}`)
        .send({ ...STORED_CONFIG, enabled: false });
      expect(res.status).toBe(200);

      // A disabled stock is never evaluated again, so this push is the only
      // news a second open page would ever get (design spec §7.1).
      const pushed = await stream.next();
      expect(pushed.automation).toMatchObject({ available: true, enabled: false });
      expect(pushed.status.stockId).toBe('grain-watch-1');
    } finally {
      stream.close();
    }
  });

  it('carries the automation snapshot on a fan status change too', async () => {
    setAutomationService(realService());
    const instance = app();
    const stream = await openFanStream(instance, 'grain-watch-1');

    try {
      await stream.next();

      const res = await request(instance)
        .post('/api/v1/stocks/grain-watch-1/fan/command')
        .set('Authorization', `Bearer ${token()}`)
        .send({ action: 'on' });
      expect(res.status).toBe(200);

      const pushed = await stream.next();
      expect(pushed.status.state).toBe('TURN_ON_PENDING');
      expect(pushed.automation).toMatchObject({ available: true, enabled: false });
    } finally {
      stream.close();
    }
  });
});

/** The same request on both endpoints, so the shared refusals are stated once. */
function call(method: 'get' | 'put', url: string, bearer: string): request.Test {
  const req = request(app())[method](url).set('Authorization', `Bearer ${bearer}`);
  return method === 'put' ? req.send(STORED_CONFIG) : req;
}

/** An automation service whose two follow-up calls can be observed. */
function stubService(): { evaluateStock: jest.Mock; notifyChanged: jest.Mock } {
  const stub = {
    evaluateStock: jest.fn().mockResolvedValue(undefined),
    notifyChanged: jest.fn(),
    getState: () => ({ enabled: false, reason: null, evaluatedAt: null }),
    onChange: () => () => {},
  };
  setAutomationService(stub as unknown as AutomationService);
  return stub;
}

/**
 * A real service on the test database, with the InfluxDB reads stubbed out and
 * no timer started — the push paths are what these tests exercise.
 */
function realService(): AutomationService {
  return new AutomationService({
    automationRepo: new AutomationRepository(getDb()),
    stateRepo: new FanStateRepository(getDb()),
    eventsRepo: new FanEventsRepository(getDb()),
    readings: {
      getLatestReadings: async () => [],
      getOutdoorReading: async () => ({
        temperature: null,
        humidity: null,
        temperatureTime: null,
        humidityTime: null,
      }),
    },
    listStocks: () => new StockRepository(getDb()).findAll(),
    getController: (stockId) => manager.getController(stockId),
    intervalMs: 300000,
  });
}

interface Frame {
  status: { stockId: string; state: string };
  automation: Record<string, unknown>;
}

interface OpenStream {
  /** Resolves with the next SSE payload, or with one already buffered. */
  next(): Promise<Frame>;
  close(): void;
}

/** Opens an SSE stream and hands out its frames one at a time. */
async function openFanStream(instance: Express, stockId: string): Promise<OpenStream> {
  const buffered: Frame[] = [];
  const waiting: Array<(frame: Frame) => void> = [];
  let rest = '';

  const req = request(instance)
    .get(`/api/v1/stocks/${stockId}/fan/stream`)
    .set('Authorization', `Bearer ${token()}`)
    .buffer(false);

  await new Promise<void>((resolve, reject) => {
    req.on('response', (res) => {
      // Aborting below resets the socket; swallow the reset so it does not
      // surface as an unhandled error once the test has finished.
      res.on('error', () => {});
      res.on('data', (chunk: Buffer) => {
        rest += chunk.toString();
        let boundary = rest.indexOf('\n\n');
        while (boundary >= 0) {
          const block = rest.slice(0, boundary);
          rest = rest.slice(boundary + 2);
          const data = block.split('\n').find((line) => line.startsWith('data: '));
          if (data) {
            const frame = JSON.parse(data.slice('data: '.length)) as Frame;
            const waiter = waiting.shift();
            if (waiter) waiter(frame);
            else buffered.push(frame);
          }
          boundary = rest.indexOf('\n\n');
        }
      });
      resolve();
    });
    req.on('error', reject);
    req.end();
  });

  return {
    next: () =>
      buffered.length > 0
        ? Promise.resolve(buffered.shift()!)
        : new Promise<Frame>((resolve) => waiting.push(resolve)),
    close: () => req.abort(),
  };
}
