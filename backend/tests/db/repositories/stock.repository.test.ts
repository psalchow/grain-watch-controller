import { createTestDb, TestDb } from '../../setup/db';
import { StockRepository } from '../../../src/db/repositories/stock.repository';
import type { Stock } from '../../../src/db/types';

describe('StockRepository', () => {
  let testDb: TestDb;
  let repo: StockRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new StockRepository(testDb.db);
  });

  afterEach(() => testDb.close());

  const sample: Stock = {
    id: 'grain-watch-1',
    name: 'Halle 8',
    description: 'Lagerhalle 8',
    deviceCount: 5,
    deviceGroup: 'corn-watch-1',
    devicePrefix: '1',
    hasHumidity: true,
    active: true,
    createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: false,
    fanSwitchId: 0,
  };

  it('returns null when stock is missing', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('upserts a stock and reads it back', async () => {
    await repo.upsertMany([sample]);
    const found = await repo.findById('grain-watch-1');
    expect(found).toEqual(sample);
  });

  it('lists all stocks', async () => {
    const other: Stock = { ...sample, id: 'grain-watch-2', name: 'Halle 7', hasHumidity: false, active: false };
    await repo.upsertMany([sample, other]);
    const all = await repo.findAll();
    expect(all.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('is idempotent on repeated upsertMany calls', async () => {
    await repo.upsertMany([sample]);
    await repo.upsertMany([sample]);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
  });

  it('does not overwrite existing rows on conflict', async () => {
    await repo.upsertMany([sample]);
    await repo.upsertMany([{ ...sample, name: 'Renamed' }]);
    const found = await repo.findById('grain-watch-1');
    expect(found?.name).toBe('Halle 8');
  });

  describe('fan configuration', () => {
    it('round-trips fan config fields', async () => {
      const testDb = createTestDb();
      const repo = new StockRepository(testDb.db);
      await repo.upsertMany([
        {
          id: 'grain-watch-9',
          name: 'Halle 9',
          deviceCount: 5,
          deviceGroup: 'corn-watch-9',
          devicePrefix: '9',
          hasHumidity: false,
          active: true,
          createdAt: '2026-06-02T00:00:00.000Z',
          fanControlEnabled: true,
          fanTopicPrefix: '/corn-watch/actors/corn-watch-9/fan-control',
          fanSwitchId: 0,
        },
      ]);
      const stock = await repo.findById('grain-watch-9');
      expect(stock?.fanControlEnabled).toBe(true);
      expect(stock?.fanTopicPrefix).toBe('/corn-watch/actors/corn-watch-9/fan-control');
      expect(stock?.fanSwitchId).toBe(0);
    });

    it('defaults fan control to disabled', async () => {
      const testDb = createTestDb();
      const repo = new StockRepository(testDb.db);
      await repo.upsertMany([
        {
          id: 'grain-watch-10',
          name: 'Halle 10',
          deviceCount: 5,
          deviceGroup: 'corn-watch-10',
          devicePrefix: '10',
          hasHumidity: false,
          active: true,
          createdAt: '2026-06-02T00:00:00.000Z',
          fanControlEnabled: false,
          fanSwitchId: 0,
        },
      ]);
      const stock = await repo.findById('grain-watch-10');
      expect(stock?.fanControlEnabled).toBe(false);
      expect(stock?.fanTopicPrefix).toBeUndefined();
    });
  });
});
