/**
 * Migration tests for data steps that existing installations depend on.
 *
 * Schema shape is covered implicitly by every other database test — these
 * cases cover what a fresh database cannot show: rows that predate a column.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import type { SqliteHandle } from '../../src/db/types';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

interface Journal {
  entries: Array<{ tag: string }>;
}

/**
 * Builds a migrations folder holding everything up to and including `lastTag`,
 * so a database can be brought to an earlier state and then migrated forward.
 */
function migrationsUpTo(lastTag: string): string {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const cutoff = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cutoff === -1) throw new Error(`Unknown migration tag: ${lastTag}`);
  const entries = journal.entries.slice(0, cutoff + 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grainwatch-migrations-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      path.join(dir, `${entry.tag}.sql`),
    );
  }
  return dir;
}

describe('0007_outdoor_device', () => {
  let sqlite: SqliteHandle;

  afterEach(() => sqlite.close());

  it('backfills the outdoor device from the device group for existing stocks', () => {
    const created = createDb({ path: ':memory:' });
    sqlite = created.sqlite;
    runMigrations(created.db, migrationsUpTo('0006_stock_automation'));

    sqlite
      .prepare(
        `INSERT INTO stocks (
           id, name, device_group, device_prefix, has_humidity,
           has_grain_sensors, active, created_at, fan_control_enabled,
           fan_switch_id, tenant_id
         ) VALUES (?, ?, ?, ?, 1, 1, 1, ?, 1, 0, 'tnt_default')`,
      )
      .run(
        'grain-watch-1',
        'Halle 8',
        'corn-watch-1',
        '1',
        '2026-06-02T00:00:00.000Z',
      );

    runMigrations(created.db);

    const row = sqlite
      .prepare('SELECT outdoor_device FROM stocks WHERE id = ?')
      .get('grain-watch-1') as { outdoor_device: string | null };
    expect(row.outdoor_device).toBe('corn-watch-1');
  });
});

describe('0008_stock_admin', () => {
  let sqlite: SqliteHandle;

  afterEach(() => sqlite.close());

  it('drops device_prefix, makes device_group nullable and keeps existing values', () => {
    const created = createDb({ path: ':memory:' });
    sqlite = created.sqlite;
    runMigrations(created.db, migrationsUpTo('0007_outdoor_device'));

    sqlite
      .prepare(
        `INSERT INTO stocks (
           id, name, device_group, device_prefix, has_humidity,
           has_grain_sensors, active, created_at, fan_control_enabled,
           fan_switch_id, tenant_id
         ) VALUES (?, ?, ?, ?, 1, 1, 1, ?, 1, 0, 'tnt_default')`,
      )
      .run(
        'grain-watch-1',
        'Halle 8',
        'corn-watch-1',
        '1',
        '2026-06-02T00:00:00.000Z',
      );

    runMigrations(created.db);

    const columns = sqlite.prepare('PRAGMA table_info(stocks)').all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(columns.find((c) => c.name === 'device_prefix')).toBeUndefined();
    const deviceGroup = columns.find((c) => c.name === 'device_group');
    expect(deviceGroup).toBeDefined();
    expect(deviceGroup?.notnull).toBe(0);

    const row = sqlite
      .prepare('SELECT device_group FROM stocks WHERE id = ?')
      .get('grain-watch-1') as { device_group: string | null };
    expect(row.device_group).toBe('corn-watch-1');
  });
});

describe('0009_drop_keepalive_events', () => {
  let sqlite: SqliteHandle;

  afterEach(() => sqlite.close());

  it('removes keep-alive command rows and keeps every other event', () => {
    const created = createDb({ path: ':memory:' });
    sqlite = created.sqlite;
    runMigrations(created.db, migrationsUpTo('0008_stock_admin'));

    sqlite
      .prepare(
        `INSERT INTO stocks (
           id, name, device_group, has_humidity, has_grain_sensors, active,
           created_at, fan_control_enabled, fan_switch_id, tenant_id
         ) VALUES ('grain-watch-1', 'Halle 8', 'corn-watch-1', 1, 1, 1, ?, 1, 0, 'tnt_default')`,
      )
      .run('2026-06-02T00:00:00.000Z');
    const insertEvent = sqlite.prepare(
      `INSERT INTO fan_events (stock_id, ts, kind, payload, source)
       VALUES ('grain-watch-1', '2026-11-01T10:00:00.000Z', ?, ?, ?)`,
    );
    insertEvent.run('command', '{"action":"on"}', 'auto');
    insertEvent.run('command', '{"action":"on","keepAlive":true}', 'backend');
    insertEvent.run('success', '{"type":"success"}', 'shelly');

    runMigrations(created.db);

    const rows = sqlite
      .prepare('SELECT kind, payload FROM fan_events ORDER BY id')
      .all() as Array<{ kind: string; payload: string }>;
    expect(rows).toEqual([
      { kind: 'command', payload: '{"action":"on"}' },
      { kind: 'success', payload: '{"type":"success"}' },
    ]);
  });
});
