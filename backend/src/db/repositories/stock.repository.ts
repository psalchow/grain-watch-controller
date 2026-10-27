import { eq } from 'drizzle-orm';
import type { Db } from '../types';
import { stocks } from '../schema';
import type { Stock, StockPatch } from '../types';
import type { DbStock } from '../schema';

export class StockRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Stock | null> {
    const row = this.db.select().from(stocks).where(eq(stocks.id, id)).get();
    return row ? this.toStock(row) : null;
  }

  async findAll(): Promise<Stock[]> {
    const rows = this.db.select().from(stocks).all();
    return rows.map((row) => this.toStock(row));
  }

  async create(stock: Stock): Promise<void> {
    this.db
      .insert(stocks)
      .values({
        id: stock.id,
        name: stock.name,
        description: stock.description ?? null,
        deviceGroup: stock.deviceGroup ?? null,
        outdoorDevice: stock.outdoorDevice ?? null,
        hasHumidity: stock.hasHumidity,
        hasGrainSensors: stock.hasGrainSensors,
        active: stock.active,
        createdAt: stock.createdAt,
        fanControlEnabled: stock.fanControlEnabled,
        fanTopicPrefix: stock.fanTopicPrefix ?? null,
        fanSwitchId: stock.fanSwitchId,
        tenantId: stock.tenantId,
      })
      .run();
  }

  /**
   * Applies the keys present in `patch`. A `null` clears a nullable column, an
   * absent key leaves it untouched. Answers false when no row matched.
   */
  async update(id: string, patch: StockPatch): Promise<boolean> {
    const set: Partial<typeof stocks.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.deviceGroup !== undefined) set.deviceGroup = patch.deviceGroup;
    if (patch.outdoorDevice !== undefined) set.outdoorDevice = patch.outdoorDevice;
    if (patch.hasHumidity !== undefined) set.hasHumidity = patch.hasHumidity;
    if (patch.hasGrainSensors !== undefined) set.hasGrainSensors = patch.hasGrainSensors;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.fanControlEnabled !== undefined) set.fanControlEnabled = patch.fanControlEnabled;
    if (patch.fanTopicPrefix !== undefined) set.fanTopicPrefix = patch.fanTopicPrefix;
    if (patch.fanSwitchId !== undefined) set.fanSwitchId = patch.fanSwitchId;

    // An empty patch has no SET clause to run; it still answers whether the row exists.
    if (Object.keys(set).length === 0) {
      return this.db.select({ id: stocks.id }).from(stocks).where(eq(stocks.id, id)).get() !== undefined;
    }
    const result = this.db.update(stocks).set(set).where(eq(stocks.id, id)).run();
    return result.changes > 0;
  }

  /** Answers false when no row matched. Dependent rows go with it by cascade. */
  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(stocks).where(eq(stocks.id, id)).run();
    return result.changes > 0;
  }

  private toStock(row: DbStock): Stock {
    const stock: Stock = {
      id: row.id,
      name: row.name,
      hasHumidity: row.hasHumidity,
      hasGrainSensors: row.hasGrainSensors,
      active: row.active,
      createdAt: row.createdAt,
      fanControlEnabled: row.fanControlEnabled,
      fanSwitchId: row.fanSwitchId,
      tenantId: row.tenantId,
    };
    if (row.deviceGroup !== null) stock.deviceGroup = row.deviceGroup;
    if (row.description !== null) {
      stock.description = row.description;
    }
    if (row.outdoorDevice !== null) {
      stock.outdoorDevice = row.outdoorDevice;
    }
    if (row.fanTopicPrefix !== null) {
      stock.fanTopicPrefix = row.fanTopicPrefix;
    }
    return stock;
  }
}
