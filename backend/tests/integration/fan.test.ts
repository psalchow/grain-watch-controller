import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { eq } from 'drizzle-orm';
import { initDb, closeDb, getDb } from '../../src/db';
import { stocks } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../src/db/repositories';
import { seedStocks } from '../../src/db/seed';
import { FanControlManager } from '../../src/services/fan/fan.manager';
import { setFanManager } from '../../src/services/fan';

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

const published: Array<{ topic: string; message: string }> = [];

let manager: FanControlManager;

beforeEach(async () => {
  initDb({ path: ':memory:' });
  runMigrations(getDb());
  await seedStocks(new StockRepository(getDb()));
  resetServiceSingletonsForTests();
  published.length = 0;
  manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/p', switchId: 0 }],
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

afterEach(() => { manager.shutdown(); setFanManager(null); closeDb(); });

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
});
