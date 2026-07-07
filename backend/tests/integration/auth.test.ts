/**
 * Integration tests for authentication endpoints.
 *
 * Tests login and token refresh functionality via HTTP.
 */

import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { UserRepository } from '../../src/db/repositories';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

// Mock the config module
jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
      refreshSecret: 'test-refresh-secret-for-testing-only-must-be-long',
      refreshExpiresIn: '30d',
    },
    cookie: {
      secure: false,
      sameSite: 'lax',
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

  beforeAll(async () => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    userService = new UserService(new UserRepository(getDb()));

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

  afterAll(() => {
    setAuthService(null);
    closeDb();
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

    it('should set an httpOnly refresh_token cookie on login', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testadmin',
          password: 'testpassword123',
        });

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      const refreshCookie = cookies.find((c) =>
        c.startsWith('refresh_token=')
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie!.toLowerCase()).toContain('httponly');
      expect(refreshCookie).not.toContain('refresh_token=;');
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
    /** Extracts the refresh_token cookie value from a login response. */
    async function loginAndGetRefreshCookie(): Promise<string> {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testadmin', password: 'testpassword123' });
      const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
      const cookie = cookies.find((c) => c.startsWith('refresh_token='))!;
      return cookie.split(';')[0]!;
    }

    it('should refresh the access token using only the refresh cookie', async () => {
      const refreshCookie = await loginAndGetRefreshCookie();

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresIn');

      const decoded = jwt.verify(
        response.body.token,
        'test-secret-key-for-testing-only-must-be-long-enough'
      );
      expect(decoded).toHaveProperty('username', 'testadmin');
      expect(decoded).toHaveProperty('role', 'admin');
    });

    it('should rotate the refresh cookie on refresh', async () => {
      const refreshCookie = await loginAndGetRefreshCookie();

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const rotated = cookies.find((c) => c.startsWith('refresh_token='));
      expect(rotated).toBeDefined();
      expect(rotated!.toLowerCase()).toContain('httponly');
    });

    it('should refresh even when no access token is present', async () => {
      // No Authorization header at all — only the refresh cookie.
      const refreshCookie = await loginAndGetRefreshCookie();

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);

      expect(response.status).toBe(200);
    });

    it('should return 401 when the refresh cookie is missing', async () => {
      const response = await request(app).post('/api/v1/auth/refresh');

      expect(response.status).toBe(401);
    });

    it('should return 401 for an invalid refresh cookie', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'refresh_token=invalid-token');

      expect(response.status).toBe(401);
    });

    it('should return 401 for an expired refresh cookie', async () => {
      const expired = jwt.sign(
        { userId: 'usr_001', type: 'refresh' },
        'test-refresh-secret-for-testing-only-must-be-long',
        { expiresIn: '-1s' }
      );

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${expired}`);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should clear the refresh cookie and return 204', async () => {
      const response = await request(app).post('/api/v1/auth/logout');

      expect(response.status).toBe(204);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      const cleared = cookies.find((c) => c.startsWith('refresh_token='));
      expect(cleared).toBeDefined();
      // Cleared cookie has an empty value.
      expect(cleared).toMatch(/^refresh_token=;/);
    });

    it('should succeed without any valid access token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer expired-or-invalid');

      expect(response.status).toBe(204);
    });
  });
});
