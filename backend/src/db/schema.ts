import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email'),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  createdAt: text('created_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const userStockAccess = sqliteTable(
  'user_stock_access',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stockId: text('stock_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.stockId] }),
    stockIdIdx: index('user_stock_access_stock_id_idx').on(table.stockId),
  })
);

export const stocks = sqliteTable('stocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  deviceCount: integer('device_count').notNull(),
  deviceGroup: text('device_group').notNull(),
  devicePrefix: text('device_prefix').notNull(),
  hasHumidity: integer('has_humidity', { mode: 'boolean' }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  fanControlEnabled: integer('fan_control_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  fanTopicPrefix: text('fan_topic_prefix'),
  fanSwitchId: integer('fan_switch_id').notNull().default(0),
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
