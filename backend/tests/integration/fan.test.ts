import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
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
    influxdb: { url: 'http://localhost:8086', token: 't', org: 'o', bucket: 'b', measurement: 'Temp', outdoorTemperatureMeasurement: 'ot', outdoorHumidityMeasurement: 'oh', outdoorLookback: '1h' },
  },
}));

function token(): string {
  return jwt.sign({ userId: 'u1', username: 'admin', role: 'admin', stockAccess: ['*'] }, JWT_SECRET, { expiresIn: '1h' });
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
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000 },
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

  it('POST /fan/command rejects invalid action', async () => {
    const res = await request(app()).post('/api/v1/stocks/grain-watch-1/fan/command').set('Authorization', `Bearer ${token()}`).send({ action: 'spin' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan');
    expect(res.status).toBe(401);
  });
});
