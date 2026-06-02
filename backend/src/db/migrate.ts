import path from 'path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './types';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
