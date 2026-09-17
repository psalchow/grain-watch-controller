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
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';
import { setAuthService } from '../../src/middleware';
import { StockRepository } from '../../src/db/repositories';
import { seedStocks } from '../../src/db/seed';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

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
      outdoorMaxSkew: '15m',
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
  stockAccess: string[];
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
    setAuthService(null);

    // Create test tokens
    adminToken = createToken({
      userId: 'usr_001',
      username: 'admin',
      role: 'admin',
      stockAccess: ['*'],
    });

    viewerToken = createToken({
      userId: 'usr_002',
      username: 'viewer',
      role: 'viewer',
      stockAccess: ['grain-watch-1', 'grain-watch-2'],
    });

    restrictedViewerToken = createToken({
      userId: 'usr_003',
      username: 'restricted',
      role: 'viewer',
      stockAccess: ['grain-watch-1'],
    });

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

    it('should return filtered stocks for viewer with limited access', async () => {
      const response = await request(app)
        .get('/api/v1/stocks')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.stocks).toHaveLength(1);
      expect(response.body.stocks[0].id).toBe('grain-watch-1');
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
        // The older of the two timestamps, matching the offline decision
        lastMeasurement: '2026-01-16T09:00:00.000Z',
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

    it('flags outdoor conditions as offline when only one of the two values is stale', async () => {
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
      expect(response.body.outdoor.offline).toBe(true);
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
      expect(response.body.outdoor.temperature).toBe(8.5);
      // The surviving value still reports its own age
      expect(response.body.outdoor.lastMeasurement).not.toBeNull();
    });

    it('suppresses derived outdoor values when the two measurements drift apart', async () => {
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
      expect(response.body.outdoor.temperature).toBe(12.4);
      expect(response.body.outdoor.humidity).toBe(78);
      expect(response.body.outdoor.dewPoint).toBeNull();
      expect(response.body.outdoor.absoluteHumidity).toBeNull();
      expect(response.body.outdoor.derivedUnavailableReason).toBe('skew');
    });

    it('reports no skew reason when a derived value is simply not computable', async () => {
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
      expect(response.body.outdoor.derivedUnavailableReason).toBeNull();
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
        derivedUnavailableReason: null,
        temperature: null,
        humidity: null,
        dewPoint: null,
        absoluteHumidity: null,
        lastMeasurement: null,
      });
    });

    it('reports the older of the two outdoor timestamps so age and flag agree', async () => {
      const fresh = new Date(Date.now() - 60 * 1000).toISOString();
      const stale = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      mockGetOutdoorReading.mockResolvedValue({
        temperature: 12.4,
        humidity: 78,
        temperatureTime: fresh,
        humidityTime: stale,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor.lastMeasurement).toBe(stale);
      expect(response.body.outdoor.offline).toBe(true);
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
          bottom: new Map(),
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
        devices: ['1.1', '1.2', '1.3', '1.4', '1.5'],
      });
      expect(response.body.series.temperature).toBeDefined();
      expect(response.body.series.temperature.top).toHaveLength(5);
      expect(response.body.series.temperature.top[0]).toEqual([
        { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
        { t: '2026-05-19T00:30:00.000Z', v: 12.4 },
      ]);
      // Device 1.3 had no series — empty array.
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
          deviceCount: 0,
          deviceGroup: 'corn-watch-9',
          devicePrefix: '9',
          hasHumidity: false,
          hasGrainSensors: false,
          active: true,
          createdAt: '2026-06-02T00:00:00.000Z',
          fanControlEnabled: true,
          fanSwitchId: 0,
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
