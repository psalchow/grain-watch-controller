import { createTestDb, TestDb } from '../setup/db';
import { StockRepository } from '../../src/db/repositories';
import { insertStock } from '../setup/stocks';
import { StockService } from '../../src/services/stock';

describe('StockService', () => {
  let testDb: TestDb;
  let service: StockService;

  beforeEach(async () => {
    testDb = createTestDb();
    const repo = new StockRepository(testDb.db);
    await insertStock(testDb.db, { id: 'grain-watch-1' });
    await insertStock(testDb.db, { id: 'grain-watch-2', name: 'Halle 7', deviceGroup: 'corn-watch-2', outdoorDevice: 'corn-watch-2' });
    service = new StockService(repo);
  });

  afterEach(() => testDb.close());

  it('lists stocks', async () => {
    const list = await service.listStocks();
    expect(list.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('returns a single stock by id', async () => {
    const stock = await service.getStock('grain-watch-1');
    expect(stock?.name).toBe('Halle 8');
  });

  it('returns null for unknown id', async () => {
    expect(await service.getStock('nope')).toBeNull();
  });
});
