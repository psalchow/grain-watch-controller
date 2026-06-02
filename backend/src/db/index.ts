import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { Db, SqliteHandle } from './types';

let sqlite: SqliteHandle | null = null;
let db: Db | null = null;

export interface CreateDbOptions {
  /** File path or `:memory:`. Required. */
  path: string;
}

/**
 * Opens a SQLite connection with sensible defaults.
 *
 * - WAL journal mode for durability + concurrency
 * - Foreign keys enabled
 * - Returns both the raw handle (for migrations) and a Drizzle wrapper
 */
export function createDb(opts: CreateDbOptions): { db: Db; sqlite: SqliteHandle } {
  const handle = new Database(opts.path);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  const wrapped = drizzle(handle, { schema, casing: 'snake_case' });
  return { db: wrapped, sqlite: handle };
}

/**
 * Initialises the singleton DB used by the application services.
 * Safe to call once during boot. Subsequent calls throw.
 */
export function initDb(opts: CreateDbOptions): Db {
  if (db !== null) {
    throw new Error('DB already initialised');
  }
  const created = createDb(opts);
  db = created.db;
  sqlite = created.sqlite;
  return db;
}

export function getDb(): Db {
  if (db === null) {
    throw new Error('DB not initialised; call initDb() first');
  }
  return db;
}

export function getSqliteHandle(): SqliteHandle {
  if (sqlite === null) {
    throw new Error('DB not initialised; call initDb() first');
  }
  return sqlite;
}

export function closeDb(): void {
  if (sqlite !== null) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
