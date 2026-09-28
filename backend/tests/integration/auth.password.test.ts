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

describe('POST /api/v1/auth/change-password', () => {
  let app: Express;
  let userService: UserService;
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
    const viewer = await userService.createUser({
      username: 'testviewer',
      password: 'viewerpassword123',
      role: 'viewer',
      tenantIds: ['tnt_default'],
      mustChangePassword: true,
    });
    viewerToken = createToken({ userId: viewer.id, username: 'testviewer', role: 'viewer', tenants: [{ id: 'tnt_default', name: 'Standard' }] });
  });

  it('changes the password with a correct current password and clears the flag', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'viewerpassword123', newPassword: 'brandnewpass123' });

    expect(res.status).toBe(204);
    const updated = await userService.findUserByUsername('testviewer');
    expect(updated?.mustChangePassword).toBe(false);
    const matches = await new AuthService(userService).comparePasswords('brandnewpass123', updated!.passwordHash);
    expect(matches).toBe(true);
  });

  it('rejects a wrong current password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'brandnewpass123' });
    expect(res.status).toBe(401);
  });

  it('rejects a too-short new password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'viewerpassword123', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'viewerpassword123', newPassword: 'brandnewpass123' });
    expect(res.status).toBe(401);
  });
});
