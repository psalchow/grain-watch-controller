import { createTestDb, TestDb } from '../../setup/db';
import { StockRepository } from '../../../src/db/repositories/stock.repository';
import type { Stock } from '../../../src/db/types';
import { FanStateRepository, FanEventsRepository } from '../../../src/db/repositories/fan.repository';
import { AutomationRepository } from '../../../src/db/repositories/automation.repository';
import {
  AUTOMATION_DEFAULTS,
  DEFAULT_TENANT_ID,
  fanEvents,
  fanState,
  stockAutomation,
} from '../../../src/db/schema';

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
    deviceGroup: 'corn-watch-1',
    hasHumidity: true,
    hasGrainSensors: true,
    active: true,
    createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: false,
    fanSwitchId: 0,
    tenantId: DEFAULT_TENANT_ID,
  };

  it('returns null when stock is missing', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('creates a stock and reads it back', async () => {
    await repo.create(sample);
    const found = await repo.findById('grain-watch-1');
    expect(found).toEqual(sample);
  });

  it('lists all stocks', async () => {
    const other: Stock = { ...sample, id: 'grain-watch-2', name: 'Halle 7', hasHumidity: false, active: false };
    await repo.create(sample);
    await repo.create(other);
    const all = await repo.findAll();
    expect(all.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  describe('outdoor device', () => {
    it('round-trips an outdoor device that differs from the device group', async () => {
      await repo.create({ ...sample, outdoorDevice: 'corn-watch-7' });
      const stock = await repo.findById('grain-watch-1');
      expect(stock?.deviceGroup).toBe('corn-watch-1');
      expect(stock?.outdoorDevice).toBe('corn-watch-7');
    });

    it('leaves the outdoor device undefined when none is configured', async () => {
      await repo.create(sample);
      const stock = await repo.findById('grain-watch-1');
      expect(stock?.outdoorDevice).toBeUndefined();
    });
  });

  describe('fan configuration', () => {
    it('round-trips fan config fields', async () => {
      const testDb = createTestDb();
      const repo = new StockRepository(testDb.db);
      await repo.create({
          id: 'grain-watch-9',
          name: 'Halle 9',
          deviceGroup: 'corn-watch-9',
          hasHumidity: false,
          hasGrainSensors: true,
          active: true,
          createdAt: '2026-06-02T00:00:00.000Z',
          fanControlEnabled: true,
          fanTopicPrefix: '/corn-watch/actors/corn-watch-9/fan-control',
          fanSwitchId: 0,
          tenantId: DEFAULT_TENANT_ID,
        });
      const stock = await repo.findById('grain-watch-9');
      expect(stock?.fanControlEnabled).toBe(true);
      expect(stock?.fanTopicPrefix).toBe('/corn-watch/actors/corn-watch-9/fan-control');
      expect(stock?.fanSwitchId).toBe(0);
    });

    it('defaults fan control to disabled', async () => {
      const testDb = createTestDb();
      const repo = new StockRepository(testDb.db);
      await repo.create({
          id: 'grain-watch-10',
          name: 'Halle 10',
          deviceGroup: 'corn-watch-10',
          hasHumidity: false,
          hasGrainSensors: true,
          active: true,
          createdAt: '2026-06-02T00:00:00.000Z',
          fanControlEnabled: false,
          fanSwitchId: 0,
          tenantId: DEFAULT_TENANT_ID,
        });
      const stock = await repo.findById('grain-watch-10');
      expect(stock?.fanControlEnabled).toBe(false);
      expect(stock?.fanTopicPrefix).toBeUndefined();
    });
  });

  describe('create, update and delete', () => {
    const full: Stock = {
      ...sample,
      outdoorDevice: 'corn-watch-7',
      fanControlEnabled: true,
      fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control',
      fanSwitchId: 2,
    };

    it('creates a stock and reads every field back', async () => {
      await repo.create(full);
      expect(await repo.findById(full.id)).toEqual(full);
    });

    it('updates only the keys present in the patch', async () => {
      await repo.create(full);
      expect(await repo.update(full.id, { name: 'Renamed' })).toBe(true);
      expect(await repo.findById(full.id)).toEqual({ ...full, name: 'Renamed' });
    });

    it('clears a nullable column on an explicit null and leaves the others', async () => {
      await repo.create(full);
      await repo.update(full.id, { description: null, outdoorDevice: null });
      const found = await repo.findById(full.id);
      expect(found?.description).toBeUndefined();
      expect(found?.outdoorDevice).toBeUndefined();
      expect(found?.deviceGroup).toBe('corn-watch-1');
      expect(found?.fanTopicPrefix).toBe(full.fanTopicPrefix);
    });

    it('leaves a nullable column alone when its key is absent', async () => {
      await repo.create(full);
      await repo.update(full.id, { active: false });
      const found = await repo.findById(full.id);
      expect(found?.description).toBe(full.description);
      expect(found?.active).toBe(false);
    });

    it('answers false when updating an unknown id', async () => {
      expect(await repo.update('nope', { name: 'x' })).toBe(false);
    });

    it('deletes a stock and answers true, false for an unknown id', async () => {
      await repo.create(sample);
      expect(await repo.delete(sample.id)).toBe(true);
      expect(await repo.findById(sample.id)).toBeNull();
      expect(await repo.delete(sample.id)).toBe(false);
    });

    it('removes fan_state, fan_events and stock_automation rows with the stock', async () => {
      await repo.create(sample);
      new FanStateRepository(testDb.db).upsert({
        stockId: sample.id,
        desiredOn: true,
        since: '2026-07-09T10:00:00.000Z',
        lastCommandAt: null,
        updatedAt: '2026-07-09T10:00:00.000Z',
      });
      new FanEventsRepository(testDb.db).insert({
        stockId: sample.id,
        ts: '2026-07-09T10:00:00.000Z',
        kind: 'command',
        payload: { action: 'on' },
        source: 'user',
      });
      new AutomationRepository(testDb.db).upsert(sample.id, { ...AUTOMATION_DEFAULTS, enabled: true });

      await repo.delete(sample.id);

      expect(testDb.db.select().from(fanState).all()).toEqual([]);
      expect(testDb.db.select().from(fanEvents).all()).toEqual([]);
      expect(testDb.db.select().from(stockAutomation).all()).toEqual([]);
    });
  });
});
