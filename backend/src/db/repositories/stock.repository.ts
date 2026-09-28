import { eq } from 'drizzle-orm';
import type { Db } from '../types';
import { stocks } from '../schema';
import type { Stock } from '../types';

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

  async upsertMany(values: Stock[]): Promise<void> {
    if (values.length === 0) return;
    this.db
      .insert(stocks)
      .values(
        values.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          deviceGroup: s.deviceGroup,
          devicePrefix: s.devicePrefix,
          hasHumidity: s.hasHumidity,
          hasGrainSensors: s.hasGrainSensors,
          active: s.active,
          createdAt: s.createdAt,
          fanControlEnabled: s.fanControlEnabled,
          fanTopicPrefix: s.fanTopicPrefix ?? null,
          fanSwitchId: s.fanSwitchId,
          tenantId: s.tenantId,
        }))
      )
      .onConflictDoNothing({ target: stocks.id })
      .run();
  }

  private toStock(row: typeof stocks.$inferSelect): Stock {
    const stock: Stock = {
      id: row.id,
      name: row.name,
      deviceGroup: row.deviceGroup,
      devicePrefix: row.devicePrefix,
      hasHumidity: row.hasHumidity,
      hasGrainSensors: row.hasGrainSensors,
      active: row.active,
      createdAt: row.createdAt,
      fanControlEnabled: row.fanControlEnabled,
      fanSwitchId: row.fanSwitchId,
      tenantId: row.tenantId,
    };
    if (row.description !== null) {
      stock.description = row.description;
    }
    if (row.fanTopicPrefix !== null) {
      stock.fanTopicPrefix = row.fanTopicPrefix;
    }
    return stock;
  }
}
