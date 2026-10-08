import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

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

/** Per-stock automation parameters, `stock_automation` (design spec §3.1). */
export interface AutomationConfig {
  enabled: boolean;
  deltaOnK: number;
  deltaOffK: number;
  maxOutdoorHumidityPct: number;
  targetTempC: number | null;
  targetHysteresisK: number;
  minRunMinutes: number;
  minPauseMinutes: number;
}

/**
 * Defaults for `stock_automation`, and the fallback `AutomationRepository.get`
 * returns while no row exists yet (docs/superpowers/specs/2026-09-29-fan-automation-core-design.md §3.1).
 *
 * The single source for both the DDL defaults below and the read fallback, so
 * the two cannot drift apart.
 */
export const AUTOMATION_DEFAULTS: AutomationConfig = {
  enabled: false,
  deltaOnK: 10,
  deltaOffK: 2,
  maxOutdoorHumidityPct: 80,
  targetTempC: 12,
  targetHysteresisK: 1,
  minRunMinutes: 30,
  minPauseMinutes: 30,
};

export const stockAutomation = sqliteTable('stock_automation', {
  stockId: text('stock_id')
    .primaryKey()
    .references(() => stocks.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(AUTOMATION_DEFAULTS.enabled),
  deltaOnK: real('delta_on_k').notNull().default(AUTOMATION_DEFAULTS.deltaOnK),
  deltaOffK: real('delta_off_k').notNull().default(AUTOMATION_DEFAULTS.deltaOffK),
  maxOutdoorHumidityPct: real('max_outdoor_humidity_pct')
    .notNull()
    .default(AUTOMATION_DEFAULTS.maxOutdoorHumidityPct),
  targetTempC: real('target_temp_c').default(AUTOMATION_DEFAULTS.targetTempC as number),
  targetHysteresisK: real('target_hysteresis_k').notNull().default(AUTOMATION_DEFAULTS.targetHysteresisK),
  minRunMinutes: integer('min_run_minutes').notNull().default(AUTOMATION_DEFAULTS.minRunMinutes),
  minPauseMinutes: integer('min_pause_minutes').notNull().default(AUTOMATION_DEFAULTS.minPauseMinutes),
  updatedAt: text('updated_at').notNull(),
});

export type DbUser = typeof users.$inferSelect;
export type DbStock = typeof stocks.$inferSelect;
export type DbFanState = typeof fanState.$inferSelect;
export type DbStockAutomation = typeof stockAutomation.$inferSelect;
