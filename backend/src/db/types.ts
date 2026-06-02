import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type SqliteHandle = Database.Database;

export interface Stock {
  id: string;
  name: string;
  description?: string;
  deviceCount: number;
  deviceGroup: string;
  devicePrefix: string;
  hasHumidity: boolean;
  active: boolean;
  createdAt: string;
}

export { drizzle, schema };
