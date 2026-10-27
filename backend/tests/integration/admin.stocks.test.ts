/**
 * Integration tests for the admin stock endpoints.
 *
 * The two stock invariants are tested in the service; here they are only
 * asserted as the HTTP outcome.
 */

import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb, getSqliteHandle } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { UserRepository } from '../../src/db/repositories';
import { DEFAULT_TENANT_ID } from '../../src/db/schema';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';
const DEFAULT_TENANT = { id: DEFAULT_TENANT_ID, name: 'Standard' };

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
    },
  },
}));

jest.mock('../../src/services/influx/influx.service', () => {
  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: jest.fn().mockResolvedValue([]),
      getLatestReadings: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    isValidWindowDuration: jest.fn().mockReturnValue(true),
  };
});

function createToken(userId: string, username: string, role: 'admin' | 'viewer'): string {
  return jwt.sign({ userId, username, role, tenants: [DEFAULT_TENANT] }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

describe('Admin Stock Endpoints', () => {
  let app: Express;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    const userService = new UserService(new UserRepository(getDb()));
    setAuthService(new AuthService(userService));
    app = createApp();
    finaliseApp(app);

    const admin = await userService.createUser({
      username: 'testadmin',
      password: 'adminpassword123',
      role: 'admin',
      tenantIds: [DEFAULT_TENANT_ID],
    });
    const viewer = await userService.createUser({
      username: 'testviewer',
      password: 'viewerpassword123',
      role: 'viewer',
      tenantIds: [DEFAULT_TENANT_ID],
    });
    adminToken = createToken(admin.id, 'testadmin', 'admin');
    viewerToken = createToken(viewer.id, 'testviewer', 'viewer');
  });

  afterAll(() => {
    setAuthService(null);
    closeDb();
  });

  beforeEach(() => {
    getSqliteHandle().prepare('DELETE FROM stocks').run();
  });

  const asAdmin = (req: request.Test): request.Test =>
    req.set('Authorization', `Bearer ${adminToken}`);

  const createStock = (body: object = {}) =>
    asAdmin(request(app).post('/api/v1/admin/stocks')).send({
      name: 'Halle 3',
      deviceGroup: 'corn-watch-3',
      ...body,
    });

  describe('as admin', () => {
    it('lists stocks', async () => {
      await createStock();

      const response = await asAdmin(request(app).get('/api/v1/admin/stocks'));

      expect(response.status).toBe(200);
      expect(response.body.stocks).toHaveLength(1);
      expect(response.body.stocks[0].name).toBe('Halle 3');
    });

    it('creates a stock with a generated id and the schema defaults', async () => {
      const response = await createStock();

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: 'stk_001',
        name: 'Halle 3',
        deviceGroup: 'corn-watch-3',
        hasGrainSensors: true,
        hasHumidity: false,
        active: true,
        fanControlEnabled: false,
        fanSwitchId: 0,
      });
    });

    it('stores an empty description as absent', async () => {
      const response = await createStock({ description: '' });

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('description');
    });

    it('patches a single field', async () => {
      await createStock();

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({
        name: 'Halle 3 (neu)',
      });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Halle 3 (neu)');
      expect(response.body.deviceGroup).toBe('corn-watch-3');
    });

    it('stores an empty description in a patch as absent', async () => {
      await createStock({ description: 'Lagerhalle 3' });

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({
        description: '',
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('description');
      const list = await asAdmin(request(app).get('/api/v1/admin/stocks'));
      expect(list.body.stocks[0]).not.toHaveProperty('description');
    });

    it('answers 400 for a patch with a switch id above 9', async () => {
      await createStock();

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({
        fanSwitchId: 10,
      });

      expect(response.status).toBe(400);
    });

    it('leaves fields absent from the patch untouched, not reset to create defaults', async () => {
      await createStock({ active: false, hasHumidity: true, fanSwitchId: 3 });

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({
        name: 'Renamed',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ active: false, hasHumidity: true, fanSwitchId: 3 });
      const list = await asAdmin(request(app).get('/api/v1/admin/stocks'));
      expect(list.body.stocks[0]).toMatchObject({
        name: 'Renamed',
        active: false,
        hasHumidity: true,
        fanSwitchId: 3,
      });
    });

    it('clears an optional field when the patch sets it to null', async () => {
      await createStock({ outdoorDevice: 'outdoor-1' });

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({
        outdoorDevice: null,
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('outdoorDevice');
      const list = await asAdmin(request(app).get('/api/v1/admin/stocks'));
      expect(list.body.stocks[0]).not.toHaveProperty('outdoorDevice');
    });

    it('deletes an inactive stock', async () => {
      await createStock({ active: false });

      const response = await asAdmin(request(app).delete('/api/v1/admin/stocks/stk_001'));

      expect(response.status).toBe(204);
      const list = await asAdmin(request(app).get('/api/v1/admin/stocks'));
      expect(list.body.stocks).toHaveLength(0);
    });

    it('refuses to delete an active stock with 409', async () => {
      await createStock();

      const response = await asAdmin(request(app).delete('/api/v1/admin/stocks/stk_001'));

      expect(response.status).toBe(409);
      expect(response.body.error).toHaveProperty('message');
    });

    it('answers 404 when patching an unknown id', async () => {
      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_999')).send({
        name: 'x',
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 when deleting an unknown id', async () => {
      const response = await asAdmin(request(app).delete('/api/v1/admin/stocks/stk_999'));

      expect(response.status).toBe(404);
    });

    it('answers 400 for fan control without a prefix', async () => {
      const response = await createStock({ fanControlEnabled: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('message');
    });

    it('answers 400 for grain sensors without a device group', async () => {
      const response = await asAdmin(request(app).post('/api/v1/admin/stocks')).send({
        name: 'Halle 4',
        hasGrainSensors: true,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('message');
    });

    it('answers 400 for a prefix containing a wildcard', async () => {
      const response = await createStock({ fanTopicPrefix: 'fans/#' });

      expect(response.status).toBe(400);
    });

    it('answers 400 for a prefix ending in a slash', async () => {
      const response = await createStock({ fanTopicPrefix: 'fans/one/' });

      expect(response.status).toBe(400);
    });

    it('answers 400 for an empty patch body', async () => {
      await createStock();

      const response = await asAdmin(request(app).patch('/api/v1/admin/stocks/stk_001')).send({});

      expect(response.status).toBe(400);
    });
  });

  describe('access control', () => {
    const calls: [string, string][] = [
      ['get', '/api/v1/admin/stocks'],
      ['post', '/api/v1/admin/stocks'],
      ['patch', '/api/v1/admin/stocks/stk_001'],
      ['delete', '/api/v1/admin/stocks/stk_001'],
    ];

    it.each(calls)('%s %s answers 403 for a viewer', async (method, path) => {
      const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'x' });

      expect(response.status).toBe(403);
    });

    it.each(calls)('%s %s answers 401 without a token', async (method, path) => {
      const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path).send({ name: 'x' });

      expect(response.status).toBe(401);
    });
  });
});
