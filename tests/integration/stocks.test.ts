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
jest.mock('../../src/services/influx/influx.service', () => {
  const mockGetDeviceGroups = jest.fn();
  const mockGetLatestReadings = jest.fn();

  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: mockGetDeviceGroups,
      getLatestReadings: mockGetLatestReadings,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    __mockGetDeviceGroups: mockGetDeviceGroups,
    __mockGetLatestReadings: mockGetLatestReadings,
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

  // Get mock functions from the mocked module
  const mockedInflux = jest.requireMock('../../src/services/influx/influx.service');
  const mockGetDeviceGroups = mockedInflux.__mockGetDeviceGroups;
  const mockGetLatestReadings = mockedInflux.__mockGetLatestReadings;

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

});
