import { createTestDb, TestDb } from '../setup/db';
import { StockRepository } from '../../src/db/repositories';
import { insertStock } from '../setup/stocks';
import { StockService, StockServiceError } from '../../src/services/stock';
import type { CreateStockInput } from '../../src/services/stock/stock.service';
import { setFanManager } from '../../src/services/fan';
import type { FanControlManager } from '../../src/services/fan';

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

describe('StockService administration', () => {
  let testDb: TestDb;
  let repo: StockRepository;
  let service: StockService;
  let retire: jest.Mock;
  let reconcile: jest.Mock;

  const input = (over: Partial<CreateStockInput> = {}): CreateStockInput => ({
    name: 'Halle 1',
    deviceGroup: 'corn-watch-1',
    hasHumidity: true,
    hasGrainSensors: true,
    active: true,
    fanControlEnabled: false,
    fanSwitchId: 0,
    ...over,
  });

  beforeEach(() => {
    testDb = createTestDb();
    repo = new StockRepository(testDb.db);
    service = new StockService(repo);
    retire = jest.fn();
    reconcile = jest.fn().mockResolvedValue(undefined);
    // Only the two methods the service calls exist on the stub, hence the cast.
    setFanManager({ retireController: retire, reconcile } as unknown as FanControlManager);
  });

  afterEach(() => {
    setFanManager(null);
    testDb.close();
  });

  const code = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
    } catch (e) {
      return e instanceof StockServiceError ? e.code : 'other';
    }
    return undefined;
  };

  it('generates stk_001 on an empty database and stk_002 next', async () => {
    expect((await service.createStock(input())).id).toBe('stk_001');
    expect((await service.createStock(input())).id).toBe('stk_002');
  });

  it('ignores ids that do not match the pattern', async () => {
    await insertStock(testDb.db, { id: 'grain-watch-1' });
    expect((await service.createStock(input())).id).toBe('stk_001');
  });

  it('sets createdAt as ISO string and the default tenant', async () => {
    const stock = await service.createStock(input());
    expect(new Date(stock.createdAt).toISOString()).toBe(stock.createdAt);
    expect(stock.tenantId).toBe('tnt_default');
    expect(await repo.findById(stock.id)).toEqual(stock);
  });

  it('rejects fan control without a topic prefix', async () => {
    expect(await code(service.createStock(input({ fanControlEnabled: true })))).toBe('invalid');
    expect(await code(service.createStock(input({ fanControlEnabled: true, fanTopicPrefix: ' ' })))).toBe('invalid');
  });

  it('rejects grain thermometers without a device group', async () => {
    const { deviceGroup: _omit, ...rest } = input();
    expect(await code(service.createStock(rest))).toBe('invalid');
  });

  it('maps a primary-key collision to conflict', async () => {
    await insertStock(testDb.db, { id: 'stk_001' });
    // A scan that misses the existing row simulates a concurrent writer.
    jest.spyOn(repo, 'findAll').mockResolvedValue([]);
    expect(await code(service.createStock(input()))).toBe('conflict');
  });

  it('rejects an update whose merged result breaks an invariant, even via the untouched field', async () => {
    const a = await insertStock(testDb.db, { id: 'stk_001', fanControlEnabled: true, fanTopicPrefix: 'shellies/x' });
    expect(await code(service.updateStock(a.id, { fanTopicPrefix: null }))).toBe('invalid');
    const b = await insertStock(testDb.db, { id: 'stk_002', hasGrainSensors: false, deviceGroup: undefined as never });
    expect(await code(service.updateStock(b.id, { hasGrainSensors: true }))).toBe('invalid');
    expect(await code(service.updateStock(a.id, { deviceGroup: null }))).toBe('invalid');
  });

  it('applies a valid update and returns the merged stock', async () => {
    const a = await insertStock(testDb.db, { id: 'stk_001', description: 'x' });
    const updated = await service.updateStock(a.id, { name: 'Neu', description: null });
    expect(updated.name).toBe('Neu');
    expect(updated.description).toBeUndefined();
    expect(await repo.findById(a.id)).toEqual(updated);
  });

  it('raises not_found when updating or deleting an unknown id', async () => {
    expect(await code(service.updateStock('nope', { name: 'x' }))).toBe('not_found');
    expect(await code(service.deleteStock('nope'))).toBe('not_found');
  });

  it('refuses to delete an active stock', async () => {
    await insertStock(testDb.db, { id: 'stk_001', active: true });
    expect(await code(service.deleteStock('stk_001'))).toBe('conflict');
    expect(retire).not.toHaveBeenCalled();
    expect(await repo.findById('stk_001')).not.toBeNull();
  });

  it('retires the controller before the row disappears', async () => {
    const order: string[] = [];
    await insertStock(testDb.db, { id: 'stk_001', active: false });
    retire.mockImplementation(() => order.push('retire'));
    const realDelete = repo.delete.bind(repo);
    jest.spyOn(repo, 'delete').mockImplementation(async (id) => {
      order.push('delete');
      return realDelete(id);
    });
    await service.deleteStock('stk_001');
    expect(order).toEqual(['retire', 'delete']);
    expect(retire).toHaveBeenCalledWith('stk_001');
    expect(await repo.findById('stk_001')).toBeNull();
  });

  it('triggers reconcile after create and update', async () => {
    const s = await service.createStock(input());
    expect(reconcile).toHaveBeenCalledTimes(1);
    await service.updateStock(s.id, { name: 'Neu' });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('works without a fan manager', async () => {
    setFanManager(null);
    const s = await service.createStock(input({ active: false }));
    await service.deleteStock(s.id);
  });
});
