import { eq } from 'drizzle-orm';
import type { Db } from '../types';
import { tenants } from '../schema';
import type { TenantRef } from '../../models';

/**
 * Read-only access to the tenant table.
 *
 * Tenants are created, renamed and removed with SQL on the NAS, exactly like
 * hall configuration, so there is nothing to write here. `created_at` is not
 * projected because nothing reads it.
 */
export class TenantRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<TenantRef[]> {
    return this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .all();
  }

  async findById(id: string): Promise<TenantRef | null> {
    const row = this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, id))
      .get();
    return row ?? null;
  }
}
