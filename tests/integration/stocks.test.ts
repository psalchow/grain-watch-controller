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
import { setAuthService } from '../../src/middleware';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

// Mock the config module
jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    usersFilePath: './data/test-users.json',
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
    },
    influxdb: {
      host: 'localhost',
      port: 8086,
      database: 'testdb',
      measurement: 'Temp',
      username: undefined,
      password: undefined,
    },
  },
}));

// Mock InfluxDB service
const mockGetDeviceGroups = jest.fn();
const mockGetLatestReadings = jest.fn();
const mockGetTemperatureTimeSeries = jest.fn();
const mockGetHumidityTimeSeries = jest.fn();
const mockGetSummaryStats = jest.fn();
const mockGetBatteryStatus = jest.fn();

jest.mock('../../src/services/influx/influx.service', () => {
  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: mockGetDeviceGroups,
      getLatestReadings: mockGetLatestReadings,
      getTemperatureTimeSeries: mockGetTemperatureTimeSeries,
      getHumidityTimeSeries: mockGetHumidityTimeSeries,
      getSummaryStats: mockGetSummaryStats,
      getBatteryStatus: mockGetBatteryStatus,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    isValidWindowDuration: (d: string) => ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'].includes(d),
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

  beforeAll(() => {
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
      stockAccess: ['corn-watch-1', 'corn-watch-2'],
    });

    restrictedViewerToken = createToken({
      userId: 'usr_003',
      username: 'restricted',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });

    // Create app
    app = createApp();
    finaliseApp(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mock responses
    mockGetDeviceGroups.mockResolvedValue(['corn-watch-1', 'corn-watch-2']);

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

    mockGetTemperatureTimeSeries.mockResolvedValue([
      { time: '2026-01-15T00:00:00.000Z', device: '1.1', value: 10.5 },
      { time: '2026-01-15T01:00:00.000Z', device: '1.1', value: 10.3 },
    ]);

    mockGetHumidityTimeSeries.mockResolvedValue([
      { time: '2026-01-15T00:00:00.000Z', device: '1.1', value: 85 },
      { time: '2026-01-15T01:00:00.000Z', device: '1.1', value: 84 },
    ]);

    mockGetSummaryStats.mockResolvedValue([
      { device: '1.1', min: 9.5, max: 11.5, avg: 10.5, current: 10.5 },
      { device: '1.2', min: 9.8, max: 11.8, avg: 10.8, current: 10.8 },
    ]);

    mockGetBatteryStatus.mockResolvedValue([
      { device: '1.1', battery: 436 },
      { device: '1.2', battery: 328 }, // Critical level
    ]);
  });

  afterAll(() => {
    setAuthService(null);
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
      expect(response.body.stocks[0].id).toBe('corn-watch-1');
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
        .get('/api/v1/stocks/corn-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stockId', 'corn-watch-1');
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

    it('should return 403 for unauthorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-2/latest')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });

    it('should allow admin access to any stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-2/latest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
    });

    it('should return 404 when no readings found', async () => {
      mockGetLatestReadings.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/latest');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/stocks/:stockId/temperature', () => {
    it('should return temperature data with required parameters', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/temperature')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('stockId', 'corn-watch-1');
      expect(response.body.meta).toHaveProperty('period');
      expect(response.body.meta.period).toHaveProperty('start');
      expect(response.body.meta.period).toHaveProperty('end');
    });

    it('should filter by layer when specified', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/temperature')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
          layer: 'top',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(mockGetTemperatureTimeSeries).toHaveBeenCalledWith(
        'corn-watch-1',
        'top',
        '2026-01-15T00:00:00Z',
        '2026-01-16T00:00:00Z',
        '15m'
      );
    });

    it('should use custom window when specified', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/temperature')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
          window: '1h',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.meta.window).toBe('1h');
    });

    it('should return 400 for missing start parameter', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/temperature')
        .query({
          end: '2026-01-16T00:00:00Z',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing end parameter', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/temperature')
        .query({
          start: '2026-01-15T00:00:00Z',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(400);
    });

    it('should return 403 for unauthorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-2/temperature')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
        })
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/stocks/:stockId/humidity', () => {
    it('should return humidity data with required parameters', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/humidity')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('stockId', 'corn-watch-1');
    });

    it('should filter by device when specified', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/humidity')
        .query({
          start: '2026-01-15T00:00:00Z',
          end: '2026-01-16T00:00:00Z',
          device: '1.1',
        })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
    });

    it('should return 400 for missing time parameters', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/humidity')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/stocks/:stockId/summary', () => {
    it('should return summary with default period', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/summary')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stockId', 'corn-watch-1');
      expect(response.body).toHaveProperty('period', '24h');
      expect(response.body).toHaveProperty('summary');
      expect(response.body.summary).toHaveProperty('temperature');
      expect(response.body.summary).toHaveProperty('humidity');
      expect(response.body).toHaveProperty('deviceStatus');
    });

    it('should accept custom period', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/summary')
        .query({ period: '7d' })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.period).toBe('7d');
    });

    it('should accept layer filter', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/summary')
        .query({ layer: 'top' })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
    });

    it('should return 400 for invalid period', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/summary')
        .query({ period: '2h' })
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(400);
    });

    it('should return 403 for unauthorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-2/summary')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/stocks/:stockId/battery', () => {
    it('should return battery status for all devices', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/battery')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stockId', 'corn-watch-1');
      expect(response.body).toHaveProperty('devices');
      expect(response.body).toHaveProperty('alerts');
      expect(response.body.devices).toHaveLength(2);
      expect(response.body.devices[0]).toHaveProperty('device');
      expect(response.body.devices[0]).toHaveProperty('battery');
      expect(response.body.devices[0]).toHaveProperty('batteryStatus');
    });

    it('should include alerts for low/critical batteries', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/battery')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      // Device 1.2 has battery at 328 which is critical
      expect(response.body.alerts.length).toBeGreaterThan(0);
      expect(response.body.alerts[0]).toHaveProperty('device');
      expect(response.body.alerts[0]).toHaveProperty('message');
    });

    it('should return 403 for unauthorised stock', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-2/battery')
        .set('Authorization', `Bearer ${restrictedViewerToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/corn-watch-1/battery');

      expect(response.status).toBe(401);
    });
  });
});
