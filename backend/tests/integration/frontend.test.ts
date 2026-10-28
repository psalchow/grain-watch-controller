/**
 * The static PWA and its SPA fallback.
 *
 * This path only runs in the production image, where a frontend build sits
 * beside the compiled backend, so nothing else in the suite exercises it. It
 * is also the part most exposed to a routing change: Express 5 rejects the
 * bare `'*'` pattern at registration time, which would take the container down
 * at boot rather than failing a request, and its `/*splat` replacement does
 * not match `/` — the PWA's own start URL.
 */
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFullApp } from '../../src/app';
import { Express } from 'express';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';

const INDEX_HTML = '<!doctype html><title>Grainwatch</title><div id="root"></div>';
const ASSET_JS = 'console.log("bundle")';

describe('Static frontend', () => {
  let app: Express;
  let distPath: string;
  let previousDistPath: string | undefined;

  beforeAll(() => {
    distPath = mkdtempSync(join(tmpdir(), 'grainwatch-dist-'));
    writeFileSync(join(distPath, 'index.html'), INDEX_HTML);
    mkdirSync(join(distPath, 'assets'));
    writeFileSync(join(distPath, 'assets', 'index-abc123.js'), ASSET_JS);

    previousDistPath = process.env['FRONTEND_DIST_PATH'];
    process.env['FRONTEND_DIST_PATH'] = distPath;

    initDb({ path: ':memory:' });
    runMigrations(getDb());
    app = createFullApp();
  });

  afterAll(() => {
    if (previousDistPath === undefined) {
      delete process.env['FRONTEND_DIST_PATH'];
    } else {
      process.env['FRONTEND_DIST_PATH'] = previousDistPath;
    }
    rmSync(distPath, { recursive: true, force: true });
    closeDb();
    resetServiceSingletonsForTests();
  });

  it('serves index.html at the start URL', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toBe(INDEX_HTML);
  });

  it('serves index.html for a client-side route, so a deep link reloads', async () => {
    const response = await request(app).get('/stocks/grain-watch-1');

    expect(response.status).toBe(200);
    expect(response.text).toBe(INDEX_HTML);
  });

  it('serves a built asset as itself rather than the fallback', async () => {
    const response = await request(app).get('/assets/index-abc123.js');

    expect(response.status).toBe(200);
    expect(response.text).toBe(ASSET_JS);
  });

  it('leaves an unknown API route to the 404 handler instead of masking it', async () => {
    const response = await request(app).get('/api/v1/nothing-here');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.text).not.toBe(INDEX_HTML);
  });

  it('leaves the health probe alone', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
  });
});
