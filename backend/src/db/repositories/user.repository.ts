import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../types';
import { users, userTenants, tenants } from '../schema';
import type { TenantRef, User } from '../../models';

/**
 * A user as it is written.
 *
 * Membership goes in as ids — the caller picks a tenant, it does not know or
 * care about its display name — and comes back out as {@link TenantRef}s,
 * joined to `tenants` on read.
 */
export interface UserInsert extends Omit<User, 'tenants'> {
  /** Ids of the tenants the user belongs to */
  tenantIds: string[];
}

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

  async count(): Promise<number> {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(users).get();
    return row?.count ?? 0;
  }

  async findAll(): Promise<User[]> {
    const rows = this.db.select().from(users).all();
    if (rows.length === 0) return [];
    const memberships = this.db
      .select({
        userId: userTenants.userId,
        id: tenants.id,
        name: tenants.name,
      })
      .from(userTenants)
      .innerJoin(tenants, eq(tenants.id, userTenants.tenantId))
      .where(inArray(userTenants.userId, rows.map((r) => r.id)))
      .all();
    const grouped = new Map<string, TenantRef[]>();
    for (const entry of memberships) {
      const list = grouped.get(entry.userId) ?? [];
      list.push({ id: entry.id, name: entry.name });
      grouped.set(entry.userId, list);
    }
    return rows.map((row) => this.toUser(row, grouped.get(row.id) ?? []));
  }

  async insert(user: UserInsert): Promise<void> {
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
          mustChangePassword: user.mustChangePassword ?? false,
        })
        .run();
      if (user.tenantIds.length > 0) {
        tx.insert(userTenants)
          .values(user.tenantIds.map((tenantId) => ({ userId: user.id, tenantId })))
          .run();
      }
    });
  }

  async update(
    id: string,
    patch: {
      username?: string;
      passwordHash?: string;
      email?: string | null;
      role?: 'admin' | 'viewer';
      active?: boolean;
      mustChangePassword?: boolean;
      tenantIds?: string[];
    }
  ): Promise<void> {
    this.db.transaction((tx) => {
      const existing = tx.select().from(users).where(eq(users.id, id)).get();
      if (!existing) {
        throw new Error('User not found');
      }

      const scalarUpdates: Record<string, unknown> = {};
      if (patch.username !== undefined) scalarUpdates['username'] = patch.username;
      if (patch.passwordHash !== undefined) scalarUpdates['passwordHash'] = patch.passwordHash;
      if (patch.email !== undefined) scalarUpdates['email'] = patch.email;
      if (patch.role !== undefined) scalarUpdates['role'] = patch.role;
      if (patch.active !== undefined) scalarUpdates['active'] = patch.active;
      if (patch.mustChangePassword !== undefined)
        scalarUpdates['mustChangePassword'] = patch.mustChangePassword;

      if (Object.keys(scalarUpdates).length > 0) {
        tx.update(users).set(scalarUpdates).where(eq(users.id, id)).run();
      }

      if (patch.tenantIds !== undefined) {
        tx.delete(userTenants).where(eq(userTenants.userId, id)).run();
        if (patch.tenantIds.length > 0) {
          tx.insert(userTenants)
            .values(patch.tenantIds.map((tenantId) => ({ userId: id, tenantId })))
            .run();
        }
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(users).where(eq(users.id, id)).run();
    return result.changes > 0;
  }

  private hydrate(row: typeof users.$inferSelect): User {
    const memberships = this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(userTenants)
      .innerJoin(tenants, eq(tenants.id, userTenants.tenantId))
      .where(eq(userTenants.userId, row.id))
      .all();
    return this.toUser(row, memberships);
  }

  private toUser(row: typeof users.$inferSelect, userTenantRefs: TenantRef[]): User {
    const user: User = {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role,
      tenants: userTenantRefs,
      createdAt: row.createdAt,
      active: row.active,
      mustChangePassword: row.mustChangePassword,
    };
    if (row.email !== null) {
      user.email = row.email;
    }
    return user;
  }
}
