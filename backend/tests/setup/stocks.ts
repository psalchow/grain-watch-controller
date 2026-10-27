import { StockRepository } from '../../src/db/repositories/stock.repository';
import { DEFAULT_TENANT_ID } from '../../src/db/schema';
import type { Db, Stock } from '../../src/db/types';

export function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    id: 'stk_test_1',
    name: 'Halle 8',
    deviceGroup: 'corn-watch-1',
    outdoorDevice: 'corn-watch-1',
    hasHumidity: true,
    hasGrainSensors: true,
    active: true,
    createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: false,
    fanSwitchId: 0,
    tenantId: DEFAULT_TENANT_ID,
    ...overrides,
  };
}

export async function insertStock(db: Db, overrides: Partial<Stock> = {}): Promise<Stock> {
  const stock = makeStock(overrides);
  await new StockRepository(db).create(stock);
  return stock;
}
