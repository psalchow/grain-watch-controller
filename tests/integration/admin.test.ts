/**
 * Integration tests for admin endpoints.
 *
 * Tests user management functionality including listing,
 * creation, permission updates, and status changes.
 */

import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { UserService, AuthService } from '../../src/services/auth';
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
  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: jest.fn().mockResolvedValue(['corn-watch-1', 'corn-watch-2']),
      getLatestReadings: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    isValidWindowDuration: jest.fn().mockReturnValue(true),
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

describe('Admin Endpoints', () => {
  let app: Express;
  let userService: UserService;
  let adminToken: string;
  let viewerToken: string;
  const testUsersPath = '/tmp/test-admin-users.json';

  beforeAll(async () => {
    // Create test user service with a clean file
    userService = new UserService(testUsersPath);

    // Clear any existing users
    await userService.saveUsers([]);

    // Create auth service with our test user service
    const authService = new AuthService(userService);
    setAuthService(authService);

    // Create app
    app = createApp();
    finaliseApp(app);
  });

  beforeEach(async () => {
    // Reset users before each test
    userService.clearCache();
    await userService.saveUsers([]);

    // Create admin user
    const admin = await userService.createUser({
      username: 'testadmin',
      password: 'adminpassword123',
      email: 'admin@test.com',
      role: 'admin',
      stockAccess: ['*'],
    });

    // Create viewer user
    await userService.createUser({
      username: 'testviewer',
      password: 'viewerpassword123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });

    // Create tokens
    adminToken = createToken({
      userId: admin.id,
      username: 'testadmin',
      role: 'admin',
      stockAccess: ['*'],
    });

    viewerToken = createToken({
      userId: 'usr_002',
      username: 'testviewer',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });
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

  describe('GET /api/v1/admin/users', () => {
    it('should list all users for admin', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('users');
      expect(response.body.users).toHaveLength(2);
      expect(response.body.users[0]).toHaveProperty('id');
      expect(response.body.users[0]).toHaveProperty('username');
      expect(response.body.users[0]).toHaveProperty('role');
      expect(response.body.users[0]).toHaveProperty('stockAccess');
      expect(response.body.users[0]).toHaveProperty('active');
      expect(response.body.users[0]).toHaveProperty('createdAt');
      // Password hash should not be included
      expect(response.body.users[0]).not.toHaveProperty('passwordHash');
    });

    it('should return 403 for non-admin user', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('should create a new user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'newuser',
          password: 'newuserpass123',
          email: 'newuser@test.com',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.username).toBe('newuser');
      expect(response.body.email).toBe('newuser@test.com');
      expect(response.body.role).toBe('viewer');
      expect(response.body.stockAccess).toEqual(['corn-watch-1']);
      expect(response.body.active).toBe(true);
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('should create user without email', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'noemailuser',
          password: 'noemailpass123',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(201);
      expect(response.body.username).toBe('noemailuser');
      expect(response.body).not.toHaveProperty('email');
    });

    it('should create admin user', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'newadmin',
          password: 'newadminpass123',
          role: 'admin',
          stockAccess: ['*'],
        });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('admin');
      expect(response.body.stockAccess).toEqual(['*']);
    });

    it('should return 400 for duplicate username', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'testadmin',
          password: 'somepassword123',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('USERNAME_EXISTS');
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'shortpass',
          password: 'short',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'incomplete',
        });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'invalidrole',
          password: 'validpassword123',
          role: 'superuser',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty stockAccess', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'noaccess',
          password: 'validpassword123',
          role: 'viewer',
          stockAccess: [],
        });

      expect(response.status).toBe(400);
    });

    it('should return 403 for non-admin user', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          username: 'newuser',
          password: 'newuserpass123',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        });

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/v1/admin/users/:userId/permissions', () => {
    it('should update user role', async () => {
      // Get existing user ID
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .put(`/api/v1/admin/users/${viewer?.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'admin',
        });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('admin');
      expect(response.body).toHaveProperty('updatedAt');
    });

    it('should update user stockAccess', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .put(`/api/v1/admin/users/${viewer?.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          stockAccess: ['corn-watch-1', 'corn-watch-2'],
        });

      expect(response.status).toBe(200);
      expect(response.body.stockAccess).toEqual(['corn-watch-1', 'corn-watch-2']);
    });

    it('should update both role and stockAccess', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .put(`/api/v1/admin/users/${viewer?.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'admin',
          stockAccess: ['*'],
        });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('admin');
      expect(response.body.stockAccess).toEqual(['*']);
    });

    it('should return 400 when no fields provided', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .put(`/api/v1/admin/users/${viewer?.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .put('/api/v1/admin/users/usr_999/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'admin',
        });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid role', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .put(`/api/v1/admin/users/${viewer?.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'superuser',
        });

      expect(response.status).toBe(400);
    });

    it('should return 403 for non-admin user', async () => {
      const response = await request(app)
        .put('/api/v1/admin/users/usr_001/permissions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          role: 'admin',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/admin/users/:userId', () => {
    it('should deactivate user', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .patch(`/api/v1/admin/users/${viewer?.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          active: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);
      expect(response.body).toHaveProperty('updatedAt');
    });

    it('should activate user', async () => {
      // First deactivate the user
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');
      await userService.updateUser(viewer!.id, { active: false });

      const response = await request(app)
        .patch(`/api/v1/admin/users/${viewer?.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          active: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(true);
    });

    it('should return 400 when active is not provided', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .patch(`/api/v1/admin/users/${viewer?.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 400 for non-boolean active value', async () => {
      const users = await userService.getAllUsers();
      const viewer = users.find((u) => u.username === 'testviewer');

      const response = await request(app)
        .patch(`/api/v1/admin/users/${viewer?.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          active: 'yes',
        });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/users/usr_999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          active: false,
        });

      expect(response.status).toBe(404);
    });

    it('should prevent self-deactivation', async () => {
      const users = await userService.getAllUsers();
      const admin = users.find((u) => u.username === 'testadmin');

      // Create token with actual admin user ID
      const selfToken = createToken({
        userId: admin!.id,
        username: 'testadmin',
        role: 'admin',
        stockAccess: ['*'],
      });

      const response = await request(app)
        .patch(`/api/v1/admin/users/${admin?.id}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .send({
          active: false,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('own account');
    });

    it('should return 403 for non-admin user', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/users/usr_001')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          active: false,
        });

      expect(response.status).toBe(403);
    });
  });
});
