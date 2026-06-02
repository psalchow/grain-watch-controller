import { createDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import type { Db, SqliteHandle } from '../../src/db/types';

export interface TestDb {
  db: Db;
  sqlite: SqliteHandle;
  close: () => void;
}

export function createTestDb(): TestDb {
  const { db, sqlite } = createDb({ path: ':memory:' });
  runMigrations(db);
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
