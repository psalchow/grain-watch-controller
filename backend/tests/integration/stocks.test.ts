/**
 * Integration tests for stock endpoints.
 *
 * Tests stock listing, latest readings, time-series data,
 * summary, and battery status endpoints.
 */

import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb, getSqliteHandle } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';
import { setAuthService } from '../../src/middleware';
import { StockRepository, AutomationRepository } from '../../src/db/repositories';
import { DEFAULT_TENANT_ID, AUTOMATION_DEFAULTS } from '../../src/db/schema';
import { seedStocks } from '../../src/db/seed';
import { setFanManager } from '../../src/services/fan';
import type { FanControlManager } from '../../src/services/fan';

/**
 * Stands in for the manager bootstrap builds: a controller exists exactly for
 * the stocks whose MQTT wiring is complete, which is what the fan endpoints
 * answer from.
 */
const wiredStocks = new Set(['grain-watch-1', 'fan-only']);
const fakeFanManager = {
  getController: (stockId: string) => (wiredStocks.has(stockId) ? {} : null),
} as unknown as FanControlManager;

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

/**
 * A second tenant owning `grain-watch-2`.
 *
 * Without it both seeded halls sit in `tnt_default`, and the denied-access and
 * list-filter cases below would pass while covering nothing.
 */
const SECOND_TENANT_ID = 'tnt_second';
const DEFAULT_TENANT = { id: DEFAULT_TENANT_ID, name: 'Standard' };
const SECOND_TENANT = { id: SECOND_TENANT_ID, name: 'Zweiter Betrieb' };

// Mock the config module
jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
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
      outdoorTemperatureMeasurement: 'outdoor-temperature',
      outdoorHumidityMeasurement: 'outdoor-humidity',
      latestLookback: '1h',
      offlineAfter: '15m',
    },
  },
}));

// Mock InfluxDB service
jest.mock('../../src/services/influx/influx.service', () => {
  const mockGetLatestReadings = jest.fn();
  const mockGetHistory = jest.fn();
  const mockGetOutdoorReading = jest.fn();

  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getLatestReadings: mockGetLatestReadings,
      getHistory: mockGetHistory,
      getOutdoorReading: mockGetOutdoorReading,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    __mockGetLatestReadings: mockGetLatestReadings,
    __mockGetHistory: mockGetHistory,
    __mockGetOutdoorReading: mockGetOutdoorReading,
  };
});

/**
 * Helper function to create a valid JWT token.
 */
function createToken(payload: {
  userId: string;
  username: string;
  role: 'admin' | 'viewer';
  tenants: { id: string; name: string }[];
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('Stock Endpoints', () => {
  let app: Express;
  let adminToken: string;
  let viewerToken: string;
  let restrictedViewerToken: string;

  const mockedInflux = jest.requireMock('../../src/services/influx/influx.service');
  const mockGetLatestReadings = mockedInflux.__mockGetLatestReadings;
  const mockGetHistory = mockedInflux.__mockGetHistory;
  const mockGetOutdoorReading = mockedInflux.__mockGetOutdoorReading;

  beforeAll(async () => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    await seedStocks(new StockRepository(getDb()));

    // Move the second hall into its own tenant, so "denied" and "filtered"
    // remain reachable states. Tenants are SQL-managed, hence the raw handle.
    const sqlite = getSqliteHandle();
    sqlite
      .prepare('INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
      .run(SECOND_TENANT_ID, SECOND_TENANT.name, '2026-06-02T00:00:00.000Z');
    sqlite
      .prepare('UPDATE stocks SET tenant_id = ? WHERE id = ?')
      .run(SECOND_TENANT_ID, 'grain-watch-2');

    setAuthService(null);

    // Create test tokens
    adminToken = createToken({
      userId: 'usr_001',
      username: 'admin',
      role: 'admin',
      tenants: [DEFAULT_TENANT],
    });

    // Belongs to both tenants, so this viewer reaches both halls.
    viewerToken = createToken({
      userId: 'usr_002',
      username: 'viewer',
      role: 'viewer',
      tenants: [DEFAULT_TENANT, SECOND_TENANT],
    });

    restrictedViewerToken = createToken({
      userId: 'usr_003',
      username: 'restricted',
      role: 'viewer',
      tenants: [DEFAULT_TENANT],
    });

    setFanManager(fakeFanManager);

    // Create app
    app = createApp();
    finaliseApp(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestReadings.mockReset();
    mockGetHistory.mockReset();
    mockGetOutdoorReading.mockReset();
    mockGetOutdoorReading.mockResolvedValue({
      temperature: 12.4,
      humidity: 78,
      temperatureTime: '2026-01-16T09:00:00.000Z',
      humidityTime: '2026-01-16T09:00:30.000Z',
    });

    // Set up default mock responses
    mockGetLatestReadings.mockResolvedValue([
      {
        device: '1.1',
        tempTop: 10.5,
        tempMid: 11.2,
        tempBottom: 9.8,
        humidity: 85,
        battery: 436,
        measurementTime: '2026-01-16T09:00:00.000Z',
      },
      {
        device: '1.2',
        tempTop: 10.8,
        tempMid: 11.5,
        tempBottom: 10.1,
        humidity: 82,
        battery: 428,
        measurementTime: '2026-01-16T09:01:00.000Z',
      },
    ]);
  });

  afterAll(() => {
    setFanManager(null);
    setAuthService(null);
    closeDb();
    resetServiceSingletonsForTests();
  });

  describe('GET /api/v1/stocks', () => {
    it('should return all stocks for admin user', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stocks');
      expect(response.body).toHaveProperty('total');
      expect(response.body.stocks).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.stocks[0]).toHaveProperty('id');
      expect(response.body.stocks[0]).toHaveProperty('name');
      expect(response.body.stocks[0]).toHaveProperty('active', true);
    });

    it('should return only the halls of the viewer tenant', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.stocks).toHaveLength(1);
      expect(response.body.stocks[0].id).toBe('grain-watch-1');
    });

    it('should return the halls of every tenant a viewer belongs to', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(
        response.body.stocks.map((s: { id: string }) => s.id).sort(),
      ).toEqual(['grain-watch-1', 'grain-watch-2']);
    });

    it('reports fan control only for stocks with a live controller', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const byId = Object.fromEntries(
        response.body.stocks.map((s: { id: string; fanControlEnabled: boolean }) => [
          s.id,
          s.fanControlEnabled,
        ]),
      );
      expect(byId['grain-watch-1']).toBe(true);
      // No controller was built for this one, so the fan endpoints would 404
      expect(byId['grain-watch-2']).toBe(false);
    });

    it('reports the automation state for every stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const byId = Object.fromEntries(
        response.body.stocks.map((s: { id: string; automation: unknown }) => [s.id, s.automation]),
      );
      // Wired controller plus grain thermometers, no row yet: available, off.
      expect(byId['grain-watch-1']).toEqual({ available: true, enabled: false });
      // No controller, so the automation could not drive it either.
      expect(byId['grain-watch-2']).toEqual({ available: false, enabled: false });
    });

    it('reports a configured automation as enabled', async () => {
      const repo = new AutomationRepository(getDb());
      repo.upsert('grain-watch-1', { ...AUTOMATION_DEFAULTS, enabled: true });

      try {
        const response = await request(app)
          .get('/api/v1/stocks')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        const stock = response.body.stocks.find((s: { id: string }) => s.id === 'grain-watch-1');
        expect(stock.automation).toEqual({ available: true, enabled: true });
      } finally {
        repo.upsert('grain-watch-1', AUTOMATION_DEFAULTS);
      }
    });

    it('reads the automation rows in one query for the whole list', async () => {
      const getMany = jest.spyOn(AutomationRepository.prototype, 'getMany');
      const get = jest.spyOn(AutomationRepository.prototype, 'get');

      try {
        const response = await request(app)
          .get('/api/v1/stocks')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(getMany).toHaveBeenCalledTimes(1);
        // One read per stock would not scale with the hall count.
        expect(get).not.toHaveBeenCalled();
      } finally {
        getMany.mockRestore();
        get.mockRestore();
      }
    });

    it('reports no fan control when fan control never came up in this process', async () => {
      setFanManager(null);

      try {
        const response = await request(app)
          .get('/api/v1/stocks')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(
          response.body.stocks.every((s: { fanControlEnabled: boolean }) => !s.fanControlEnabled),
        ).toBe(true);
      } finally {
        setFanManager(fakeFanManager);
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/v1/stocks');

      expect(response.status).toBe(401);
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/stocks/:stockId/latest', () => {
    it('should return latest readings for authorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stockId', 'grain-watch-1');
      expect(response.body).toHaveProperty('stockName');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('devices');
      expect(response.body.devices).toHaveLength(2);
      expect(response.body.devices[0]).toHaveProperty('device');
      expect(response.body.devices[0]).toHaveProperty('temperature');
      expect(response.body.devices[0].temperature).toHaveProperty('top');
      expect(response.body.devices[0].temperature).toHaveProperty('mid');
      expect(response.body.devices[0].temperature).toHaveProperty('bottom');
      expect(response.body.devices[0]).toHaveProperty('humidity');
      expect(response.body.devices[0]).toHaveProperty('batteryMV');
    });

    it('includes outdoor conditions with derived values', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('outdoor');
      expect(response.body.outdoor).toMatchObject({
        temperature: 12.4,
        humidity: 78,
        // The newer of the two timestamps: the last sign of life from the sensor
        lastMeasurement: '2026-01-16T09:00:30.000Z',
      });
      expect(typeof response.body.outdoor.dewPoint).toBe('number');
      expect(typeof response.body.outdoor.absoluteHumidity).toBe('number');
      expect(response.body.outdoor.dewPoint).toBeCloseTo(8.7, 0);
      expect(response.body.outdoor.absoluteHumidity).toBeCloseTo(8.5, 0);
    });

    it('flags outdoor conditions as offline past the threshold', async () => {
      const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 12.4,
        humidity: 78,
        temperatureTime: stale,
        humidityTime: stale,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.offline).toBe(true);
      expect(response.body.outdoor.temperature).toBe(12.4);
    });

    it('keeps outdoor conditions current while only one of the two values is fresh', async () => {
      // One sensor, two series: the sink publishes only what changed, so an
      // unchanged humidity ages while the temperature keeps arriving. The fresh
      // half is the proof that the sensor is alive.
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 12.4,
        humidity: 78,
        temperatureTime: new Date(Date.now() - 60 * 1000).toISOString(),
        humidityTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.offline).toBe(false);
      expect(response.body.outdoor.offlineReason).toBeNull();
      expect(typeof response.body.outdoor.dewPoint).toBe('number');
    });

    it('flags outdoor conditions as offline when one of the two readings is missing', async () => {
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 8.5,
        humidity: null,
        temperatureTime: new Date(Date.now() - 60 * 1000).toISOString(),
        humidityTime: null,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.offline).toBe(true);
      expect(response.body.outdoor.offlineReason).toBe('partner-missing');
      expect(response.body.outdoor.temperature).toBe(8.5);
      // The surviving value still reports its own age
      expect(response.body.outdoor.lastMeasurement).not.toBeNull();
    });

    it('reports no dew point when a derived value is simply not computable', async () => {
      const now = new Date().toISOString();
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 12.4,
        humidity: 0,
        temperatureTime: now,
        humidityTime: now,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.dewPoint).toBeNull();
    });

    it('returns null outdoor values when no outdoor data exists', async () => {
      mockGetOutdoorReading.mockResolvedValue({
        temperature: null,
        humidity: null,
        temperatureTime: null,
        humidityTime: null,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor).toEqual({
        offline: false,
        offlineReason: null,
        temperature: null,
        humidity: null,
        dewPoint: null,
        absoluteHumidity: null,
        lastMeasurement: null,
      });
    });

    it('reports the newer of the two outdoor timestamps so age and flag agree', async () => {
      const fresh = new Date(Date.now() - 60 * 1000).toISOString();
      const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 12.4,
        humidity: 78,
        temperatureTime: fresh,
        humidityTime: old,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.lastMeasurement).toBe(fresh);
      expect(response.body.outdoor.offline).toBe(false);
    });

    it('should return 403 for unauthorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-2/latest')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });

    it('should allow admin access to any stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-2/latest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
    });

    it('should return 200 with no devices when every reading is outside the window', async () => {
      mockGetLatestReadings.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.devices).toEqual([]);
      expect(response.body.timestamp).toBeNull();
      expect(response.body).toHaveProperty('outdoor');
    });

    it('should return 404 for an unknown stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/does-not-exist/latest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    it('should flag readings older than the offline threshold', async () => {
      const fresh = new Date(Date.now() - 60 * 1000).toISOString();
      const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      mockGetLatestReadings.mockResolvedValue([
        { device: '1.2', tempTop: 9, tempMid: 9, tempBottom: 9, humidity: null, battery: null, measurementTime: stale },
        { device: '1.1', tempTop: 10, tempMid: 10, tempBottom: 10, humidity: null, battery: null, measurementTime: fresh },
      ]);

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      // Sorted by device id, so the fresh 1.1 comes first
      expect(response.body.devices.map((d: { device: string }) => d.device)).toEqual(['1.1', '1.2']);
      expect(response.body.devices[0].offline).toBe(false);
      expect(response.body.devices[1].offline).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /stocks/:stockId/history', () => {
    beforeEach(() => {
      mockGetHistory.mockResolvedValue({
        temperature: {
          top: new Map([
            ['1.1', [
              { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
              { t: '2026-05-19T00:30:00.000Z', v: 12.4 },
            ]],
            ['1.2', [
              { t: '2026-05-19T00:00:00.000Z', v: 13.0 },
              { t: '2026-05-19T00:30:00.000Z', v: 13.2 },
            ]],
          ]),
          mid: new Map(),
          bottom: new Map([
            ['1.3', [{ t: '2026-05-19T00:00:00.000Z', v: 11.0 }]],
          ]),
        },
      });
    });

    it('returns 200 with the expected response shape for resolution=day', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/history?resolution=day')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        stockId: 'grain-watch-1',
        stockName: 'Halle 8',
        resolution: 'day',
        intervalSeconds: 1800,
        // Exactly the devices the group reported in any layer, not a
        // configured roster: 1.3 only appears in the bottom layer.
        devices: ['1.1', '1.2', '1.3'],
      });
      expect(response.body.series.temperature).toBeDefined();
      expect(response.body.series.temperature.top).toHaveLength(3);
      expect(response.body.series.temperature.top[0]).toEqual([
        { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
        { t: '2026-05-19T00:30:00.000Z', v: 12.4 },
      ]);
      // A layer without data for a reported device stays an empty array.
      expect(response.body.series.temperature.mid[0]).toEqual([]);
      expect(response.body.series.temperature.top[2]).toEqual([]);
      // Humidity not enabled for grain-watch-1.
      expect(response.body.series.humidity).toBeUndefined();
    });

    it.each([
      ['day', 1800],
      ['week', 21600],
      ['month', 43200],
      ['year', 86400],
    ])('returns the correct intervalSeconds for resolution=%s', async (resolution, intervalSeconds) => {
      const response = await request(app)
        .get(`/api/v1/stocks/grain-watch-1/history?resolution=${resolution}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.intervalSeconds).toBe(intervalSeconds);
    });

    it('returns 400 for an unknown resolution', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/history?resolution=hour')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
    });

    it('returns 400 when resolution is missing', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/history')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
    });

    it('returns 404 for an unknown stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/unknown-stock/history?resolution=day')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    it('returns 403 for a viewer without access to the stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-2/history?resolution=day')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/history?resolution=day');

      expect(response.status).toBe(401);
    });
  });

  describe('stocks without grain thermometers', () => {
    beforeAll(async () => {
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
          fanTopicPrefix: '/corn-watch/actors/corn-watch-9/fan-control',
          fanSwitchId: 0,
          tenantId: DEFAULT_TENANT_ID,
        },
      ]);
    });

    it('reports outdoor conditions without querying stock sensors', async () => {
      mockGetLatestReadings.mockClear();

      const response = await request(app)
        .get('/api/v1/stocks/fan-only/latest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.hasGrainSensors).toBe(false);
      expect(response.body.devices).toEqual([]);
      expect(response.body.fanControlEnabled).toBe(true);
      expect(mockGetLatestReadings).not.toHaveBeenCalled();
    });

    it('reports fan control without automation for a hall without thermometers', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const stock = response.body.stocks.find((s: { id: string }) => s.id === 'fan-only');
      // `available` implies fan control, never the other way round: this hall is
      // served by the fan endpoints but cannot be automated in v1, because the
      // differential rule needs grain thermometers (design spec §3.2).
      expect(stock.fanControlEnabled).toBe(true);
      expect(stock.automation).toEqual({ available: false, enabled: false });

      // And nowhere in this payload does automation claim more than fan control.
      for (const s of response.body.stocks as Array<{
        fanControlEnabled: boolean;
        automation: { available: boolean };
      }>) {
        if (s.automation.available) expect(s.fanControlEnabled).toBe(true);
      }
    });

    it('returns an empty history without querying InfluxDB', async () => {
      mockGetHistory.mockClear();

      const response = await request(app)
        .get('/api/v1/stocks/fan-only/history?resolution=day')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.devices).toEqual([]);
      expect(response.body.series.temperature.top).toEqual([]);
      expect(mockGetHistory).not.toHaveBeenCalled();
    });
  });

});
