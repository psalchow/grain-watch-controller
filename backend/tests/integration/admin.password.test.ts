import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { UserRepository } from '../../src/db/repositories';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    jwt: { secret: 'test-secret-key-for-testing-only-must-be-long-enough', expiresIn: '24h' },
    influxdb: { url: 'http://localhost:8086', token: 'test-token', org: 'test-org', bucket: 'testdb', measurement: 'Temp' },
  },
}));

jest.mock('../../src/services/influx/influx.service', () => ({
  InfluxDBService: jest.fn().mockImplementation(() => ({
    getDeviceGroups: jest.fn().mockResolvedValue(['corn-watch-1']),
    getLatestReadings: jest.fn().mockResolvedValue([]),
    testConnection: jest.fn().mockResolvedValue(true),
  })),
  isValidWindowDuration: jest.fn().mockReturnValue(true),
}));

function createToken(payload: { userId: string; username: string; role: 'admin' | 'viewer'; tenants: { id: string; name: string }[] }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('Admin password management', () => {
  let app: Express;
  let userService: UserService;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(() => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    userService = new UserService(new UserRepository(getDb()));
    setAuthService(new AuthService(userService));
    app = createApp();
    finaliseApp(app);
  });

  afterAll(() => {
    setAuthService(null);
    closeDb();
  });

  beforeEach(async () => {
    for (const u of await userService.listFullUsers()) await userService.deleteUser(u.id);
    const admin = await userService.createUser({ username: 'testadmin', password: 'adminpassword123', role: 'admin', tenantIds: ['tnt_default'] });
    const viewer = await userService.createUser({ username: 'testviewer', password: 'viewerpassword123', role: 'viewer', tenantIds: ['tnt_default'] });
    adminToken = createToken({ userId: admin.id, username: 'testadmin', role: 'admin', tenants: [{ id: 'tnt_default', name: 'Standard' }] });
    viewerToken = createToken({ userId: viewer.id, username: 'testviewer', role: 'viewer', tenants: [{ id: 'tnt_default', name: 'Standard' }] });
  });

  it('admin resets a password (204) and forces a change', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'resetpass123456' });

    expect(res.status).toBe(204);
    const updated = await userService.findUserByUsername('testviewer');
    expect(updated?.mustChangePassword).toBe(true);
    const matches = await new AuthService(userService).comparePasswords('resetpass123456', updated!.passwordHash);
    expect(matches).toBe(true);
  });

  it('rejects a reset for a non-admin caller (403)', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ newPassword: 'resetpass123456' });
    expect(res.status).toBe(403);
  });

  it('rejects a too-short reset password (400)', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users/usr_999/reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'resetpass123456' });
    expect(res.status).toBe(404);
  });

  it('admin-created users must change their password', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'freshuser', password: 'temppass123456', role: 'viewer', tenantIds: ['tnt_default'] });

    expect(res.status).toBe(201);
    const created = await userService.findUserByUsername('freshuser');
    expect(created?.mustChangePassword).toBe(true);
  });
});
