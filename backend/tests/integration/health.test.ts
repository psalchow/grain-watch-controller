import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApp } from '../../src/app';
import { Express } from 'express';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';

describe('Health Check Endpoint', () => {
  let app: Express;

  beforeAll(() => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    app = createApp();
  });

  afterAll(() => {
    closeDb();
    resetServiceSingletonsForTests();
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should report the version from the package manifest', async () => {
      const response = await request(app).get('/health');

      const { version } = JSON.parse(
        readFileSync(join(__dirname, '../../package.json'), 'utf8')
      ) as { version: string };

      expect(response.body).toHaveProperty('version', version);
      expect(response.body.version).not.toBe('unknown');
    });

    it('should return valid ISO timestamp', async () => {
      const response = await request(app).get('/health');

      const timestamp = new Date(response.body.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });
  });
});
