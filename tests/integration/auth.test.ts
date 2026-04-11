/**
 * Integration tests for authentication endpoints.
 *
 * Tests login and token refresh functionality via HTTP.
 */

import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

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

// Mock InfluxDB service to avoid actual database connections
jest.mock('../../src/services/influx/influx.service', () => {
  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: jest.fn().mockResolvedValue(['corn-watch-1', 'corn-watch-2']),
      getLatestReadings: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    isValidWindowDuration: jest.fn().mockReturnValue(true),
  };
});

describe('Auth Endpoints', () => {
  let app: Express;
  let userService: UserService;
  const testUsersPath = '/tmp/test-auth-users.json';

  beforeAll(async () => {
    // Create test user service with a clean file
    userService = new UserService(testUsersPath);

    // Clear any existing users and create test users
    userService.clearCache();
    await userService.saveUsers([]);

    // Create test admin user
    await userService.createUser({
      username: 'testadmin',
      password: 'testpassword123',
      role: 'admin',
      stockAccess: ['*'],
    });

    // Create test viewer user
    await userService.createUser({
      username: 'testviewer',
      password: 'viewerpassword123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });

    // Create disabled user
    const disabledProfile = await userService.createUser({
      username: 'disableduser',
      password: 'disabledpassword123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });
    await userService.updateUser(disabledProfile.id, { active: false });

    // Create auth service with our test user service
    const authService = new AuthService(userService);
    setAuthService(authService);

    // Create app
    app = createApp();
    finaliseApp(app);
  });

  afterAll(async () => {
    // Clean up test users file
    const fs = await import('fs').then((m) => m.promises);
    try {
      await fs.unlink(testUsersPath);
    } catch {
      // Ignore if file doesn't exist
    }
    setAuthService(null);
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testadmin',
          password: 'testpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresIn');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.username).toBe('testadmin');
      expect(response.body.user.role).toBe('admin');
      expect(response.body.user.stockAccess).toEqual(['*']);

      // Verify token is valid JWT
      const decoded = jwt.verify(
        response.body.token,
        'test-secret-key-for-testing-only-must-be-long-enough'
      );
      expect(decoded).toHaveProperty('userId');
      expect(decoded).toHaveProperty('username', 'testadmin');
    });

    it('should login viewer successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testviewer',
          password: 'viewerpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('viewer');
      expect(response.body.user.stockAccess).toEqual(['corn-watch-1']);
    });

    it('should return 401 for invalid username', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent',
          password: 'testpassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testadmin',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 for disabled account', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'disableduser',
          password: 'disabledpassword123',
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 400 for missing username', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          password: 'testpassword123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testadmin',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty request body', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let validToken: string;

    beforeAll(async () => {
      // Get a valid token for testing
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testadmin',
          password: 'testpassword123',
        });
      validToken = loginResponse.body.token;
    });

    it('should refresh token successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresIn');

      // Verify new token is valid
      const decoded = jwt.verify(
        response.body.token,
        'test-secret-key-for-testing-only-must-be-long-enough'
      );
      expect(decoded).toHaveProperty('userId');
      expect(decoded).toHaveProperty('username', 'testadmin');
      expect(decoded).toHaveProperty('role', 'admin');

      // Note: Token may be identical to validToken if generated within the same second
      // (JWT iat is in seconds, not milliseconds)
    });

    it('should return 401 for missing Authorization header', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh');

      expect(response.status).toBe(401);
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should return 401 for expired token', async () => {
      // Create an expired token
      const expiredToken = jwt.sign(
        {
          userId: 'usr_001',
          username: 'testadmin',
          role: 'admin',
          stockAccess: ['*'],
        },
        'test-secret-key-for-testing-only-must-be-long-enough',
        { expiresIn: '-1s' }
      );

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
    });

    it('should return 401 for token with wrong secret', async () => {
      const wrongSecretToken = jwt.sign(
        {
          userId: 'usr_001',
          username: 'testadmin',
          role: 'admin',
          stockAccess: ['*'],
        },
        'wrong-secret-key',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${wrongSecretToken}`);

      expect(response.status).toBe(401);
    });

    it('should return 401 for malformed Authorization header', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Authorization', 'InvalidFormat');

      expect(response.status).toBe(401);
    });
  });
});
