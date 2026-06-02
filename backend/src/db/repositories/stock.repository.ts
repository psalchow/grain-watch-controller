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
          deviceCount: s.deviceCount,
          deviceGroup: s.deviceGroup,
          devicePrefix: s.devicePrefix,
          hasHumidity: s.hasHumidity,
          active: s.active,
          createdAt: s.createdAt,
        }))
      )
      .onConflictDoNothing({ target: stocks.id })
      .run();
  }

  private toStock(row: typeof stocks.$inferSelect): Stock {
    const stock: Stock = {
      id: row.id,
      name: row.name,
      deviceCount: row.deviceCount,
      deviceGroup: row.deviceGroup,
      devicePrefix: row.devicePrefix,
      hasHumidity: row.hasHumidity,
      active: row.active,
      createdAt: row.createdAt,
    };
    if (row.description !== null) {
      stock.description = row.description;
    }
    return stock;
  }
}
