import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email'),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  createdAt: text('created_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull()
    .default(false),
});

/**
 * The tenant every hall and every user starts out in.
 *
 * Migration 0005 inserts the row and backfills both `stocks.tenant_id` and
 * `user_tenants` with it, so it exists on every database before any user does.
 */
export const DEFAULT_TENANT_ID = 'tnt_default';

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const userTenants = sqliteTable(
  'user_tenants',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.tenantId] }),
    tenantIdIdx: index('user_tenants_tenant_id_idx').on(table.tenantId),
  })
);

export const stocks = sqliteTable('stocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  deviceGroup: text('device_group').notNull(),
  /**
   * Leading segment of this stock's device ids ('1' for '1.1'…'1.5'). Kept as
   * documentation of the naming convention: nothing reads it since the device
   * rosters come from the measurements themselves.
   */
  devicePrefix: text('device_prefix').notNull(),
  hasHumidity: integer('has_humidity', { mode: 'boolean' }).notNull(),
  /** False for stocks that only have fan control and no grain thermometers. */
  hasGrainSensors: integer('has_grain_sensors', { mode: 'boolean' })
    .notNull()
    .default(true),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  fanControlEnabled: integer('fan_control_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  fanTopicPrefix: text('fan_topic_prefix'),
  fanSwitchId: integer('fan_switch_id').notNull().default(0),
  /**
   * Owning tenant. Deliberately without a foreign key: SQLite refuses
   * `ALTER TABLE … ADD COLUMN` carrying both `REFERENCES` and a non-null
   * default while `PRAGMA foreign_keys = ON`, and rebuilding `stocks` would
   * drag `fan_state` and `fan_events` along. A wrong value hides a hall from
   * its tenant rather than corrupting anything.
   */
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
});

export const fanState = sqliteTable('fan_state', {
  stockId: text('stock_id')
    .primaryKey()
    .references(() => stocks.id, { onDelete: 'cascade' }),
  desiredOn: integer('desired_on', { mode: 'boolean' }).notNull().default(false),
  since: text('since'),
  lastCommandAt: text('last_command_at'),
  updatedAt: text('updated_at').notNull(),
});

export const fanEvents = sqliteTable(
  'fan_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stockId: text('stock_id')
      .notNull()
      .references(() => stocks.id, { onDelete: 'cascade' }),
    ts: text('ts').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload'),
    source: text('source').notNull(),
  },
  (table) => ({
    stockTsIdx: index('fan_events_stock_ts_idx').on(table.stockId, table.ts),
  })
);

export type DbUser = typeof users.$inferSelect;
export type DbUserInsert = typeof users.$inferInsert;
export type DbStock = typeof stocks.$inferSelect;
export type DbStockInsert = typeof stocks.$inferInsert;
export type DbFanState = typeof fanState.$inferSelect;
export type DbFanEvent = typeof fanEvents.$inferSelect;
