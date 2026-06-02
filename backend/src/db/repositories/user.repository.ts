import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../types';
import { users, userStockAccess } from '../schema';
import type { User } from '../../models';

export class UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? this.hydrate(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.username, username)).get();
    return row ? this.hydrate(row) : null;
  }

  async findAll(): Promise<User[]> {
    const rows = this.db.select().from(users).all();
    if (rows.length === 0) return [];
    const access = this.db
      .select()
      .from(userStockAccess)
      .where(inArray(userStockAccess.userId, rows.map((r) => r.id)))
      .all();
    const grouped = new Map<string, string[]>();
    for (const entry of access) {
      const list = grouped.get(entry.userId) ?? [];
      list.push(entry.stockId);
      grouped.set(entry.userId, list);
    }
    return rows.map((row) => this.toUser(row, grouped.get(row.id) ?? []));
  }

  async insert(user: User): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(users)
        .values({
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          email: user.email ?? null,
          role: user.role,
          createdAt: user.createdAt,
          active: user.active,
        })
        .run();
      if (user.stockAccess.length > 0) {
        tx.insert(userStockAccess)
          .values(user.stockAccess.map((stockId) => ({ userId: user.id, stockId })))
          .run();
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(users).where(eq(users.id, id)).run();
    return result.changes > 0;
  }

  private hydrate(row: typeof users.$inferSelect): User {
    const access = this.db
      .select({ stockId: userStockAccess.stockId })
      .from(userStockAccess)
      .where(eq(userStockAccess.userId, row.id))
      .all();
    return this.toUser(row, access.map((a) => a.stockId));
  }

  private toUser(row: typeof users.$inferSelect, stockAccess: string[]): User {
    const user: User = {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role,
      stockAccess,
      createdAt: row.createdAt,
      active: row.active,
    };
    if (row.email !== null) {
      user.email = row.email;
    }
    return user;
  }
}
