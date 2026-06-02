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
});

export type DbUser = typeof users.$inferSelect;
export type DbUserInsert = typeof users.$inferInsert;
export type DbStock = typeof stocks.$inferSelect;
export type DbStockInsert = typeof stocks.$inferInsert;
