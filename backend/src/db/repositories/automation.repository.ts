import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../types';
import { stockAutomation, AUTOMATION_DEFAULTS } from '../schema';
import type { AutomationConfig } from '../schema';

export type { AutomationConfig };

function toConfig(row: typeof stockAutomation.$inferSelect): AutomationConfig {
  return {
    enabled: row.enabled,
    deltaOnK: row.deltaOnK,
    deltaOffK: row.deltaOffK,
    maxOutdoorHumidityPct: row.maxOutdoorHumidityPct,
    targetTempC: row.targetTempC,
    targetHysteresisK: row.targetHysteresisK,
    minRunMinutes: row.minRunMinutes,
    minPauseMinutes: row.minPauseMinutes,
  };
}

export class AutomationRepository {
  constructor(private readonly db: Db) {}

  get(stockId: string): AutomationConfig {
    const row = this.db
      .select()
      .from(stockAutomation)
      .where(eq(stockAutomation.stockId, stockId))
      .get();
    return row ? toConfig(row) : AUTOMATION_DEFAULTS;
  }

  upsert(stockId: string, config: AutomationConfig): void {
    const updatedAt = new Date().toISOString();
    this.db
      .insert(stockAutomation)
      .values({
        stockId,
        enabled: config.enabled,
        deltaOnK: config.deltaOnK,
        deltaOffK: config.deltaOffK,
        maxOutdoorHumidityPct: config.maxOutdoorHumidityPct,
        targetTempC: config.targetTempC,
        targetHysteresisK: config.targetHysteresisK,
        minRunMinutes: config.minRunMinutes,
        minPauseMinutes: config.minPauseMinutes,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: stockAutomation.stockId,
        set: {
          enabled: config.enabled,
          deltaOnK: config.deltaOnK,
          deltaOffK: config.deltaOffK,
          maxOutdoorHumidityPct: config.maxOutdoorHumidityPct,
          targetTempC: config.targetTempC,
          targetHysteresisK: config.targetHysteresisK,
          minRunMinutes: config.minRunMinutes,
          minPauseMinutes: config.minPauseMinutes,
          updatedAt,
        },
      })
      .run();
  }

  getMany(stockIds: string[]): Map<string, AutomationConfig> {
    const result = new Map<string, AutomationConfig>();
    for (const stockId of stockIds) {
      result.set(stockId, AUTOMATION_DEFAULTS);
    }
    if (stockIds.length === 0) {
      return result;
    }
    const rows = this.db
      .select()
      .from(stockAutomation)
      .where(inArray(stockAutomation.stockId, stockIds))
      .all();
    for (const row of rows) {
      result.set(row.stockId, toConfig(row));
    }
    return result;
  }
}
