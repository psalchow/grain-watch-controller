import { createTestDb, TestDb } from '../setup/db';
import { StockRepository } from '../../src/db/repositories';
import { seedStocks, SEED_STOCKS } from '../../src/db/seed';

describe('seedStocks', () => {
  let testDb: TestDb;
  let repo: StockRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new StockRepository(testDb.db);
  });

  afterEach(() => testDb.close());

  it('inserts the canonical stock metadata', async () => {
    await seedStocks(repo);
    const all = await repo.findAll();
    expect(all.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('matches the canonical metadata exactly', async () => {
    await seedStocks(repo);
    const watch1 = await repo.findById('grain-watch-1');
    expect(watch1).toMatchObject({
      id: 'grain-watch-1',
      name: 'Halle 8',
      description: 'Lagerhalle 8',
      deviceCount: 5,
      deviceGroup: 'corn-watch-1',
      devicePrefix: '1',
      hasHumidity: true,
      active: true,
    });
    const watch2 = await repo.findById('grain-watch-2');
    expect(watch2).toMatchObject({
      id: 'grain-watch-2',
      name: 'Halle 7',
      description: 'Lagerhalle 7 - inaktiv',
      deviceCount: 5,
      deviceGroup: 'corn-watch-2',
      devicePrefix: '2',
      hasHumidity: false,
      active: false,
    });
  });

  it('is idempotent when called twice', async () => {
    await seedStocks(repo);
    await seedStocks(repo);
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('exports the canonical seed data as SEED_STOCKS', () => {
    expect(SEED_STOCKS.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });
});
