import type { StockRepository } from './repositories';
import type { Stock } from './types';

const SEED_TIMESTAMP = '2026-06-02T00:00:00.000Z';

export const SEED_STOCKS: Stock[] = [
  {
    id: 'grain-watch-1',
    name: 'Halle 8',
    description: 'Lagerhalle 8',
    deviceCount: 5,
    deviceGroup: 'corn-watch-1',
    devicePrefix: '1',
    hasHumidity: true,
    active: true,
    createdAt: SEED_TIMESTAMP,
    fanControlEnabled: true,
    fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control',
    fanSwitchId: 0,
  },
  {
    id: 'grain-watch-2',
    name: 'Halle 7',
    description: 'Lagerhalle 7 - inaktiv',
    deviceCount: 5,
    deviceGroup: 'corn-watch-2',
    devicePrefix: '2',
    hasHumidity: false,
    active: false,
    createdAt: SEED_TIMESTAMP,
    fanControlEnabled: false,
    fanSwitchId: 0,
  },
];

export async function seedStocks(repo: StockRepository): Promise<void> {
  await repo.upsertMany(SEED_STOCKS);
}
