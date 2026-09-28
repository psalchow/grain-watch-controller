import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type SqliteHandle = Database.Database;

export interface Stock {
  id: string;
  name: string;
  description?: string;
  deviceGroup: string;
  devicePrefix: string;
  hasHumidity: boolean;
  /** False for stocks with fan control only and no grain thermometers. */
  hasGrainSensors: boolean;
  active: boolean;
  createdAt: string;
  fanControlEnabled: boolean;
  fanTopicPrefix?: string;
  fanSwitchId: number;
  /** Id of the owning tenant; a hall belongs to exactly one. */
  tenantId: string;
}

export { drizzle, schema };
