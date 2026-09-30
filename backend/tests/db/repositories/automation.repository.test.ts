import { eq } from 'drizzle-orm';
import { createTestDb } from '../../setup/db';
import { StockRepository } from '../../../src/db/repositories';
import { AutomationRepository } from '../../../src/db/repositories/automation.repository';
import { AUTOMATION_DEFAULTS, DEFAULT_TENANT_ID, stocks, stockAutomation } from '../../../src/db/schema';
import type { AutomationConfig } from '../../../src/db/schema';

async function seedStock(db: ReturnType<typeof createTestDb>, id = 'grain-watch-1'): Promise<void> {
  await new StockRepository(db.db).upsertMany([
    {
      id, name: 'Halle 8', deviceGroup: 'corn-watch-1',
      devicePrefix: '1', hasHumidity: true, hasGrainSensors: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
      fanControlEnabled: true, fanTopicPrefix: '/p', fanSwitchId: 0,
      tenantId: DEFAULT_TENANT_ID,
    },
  ]);
}

const configA: AutomationConfig = {
  enabled: true,
  deltaOnK: 12,
  deltaOffK: 3,
  maxOutdoorHumidityPct: 85,
  targetTempC: null,
  targetHysteresisK: 1.5,
  minRunMinutes: 45,
  minPauseMinutes: 20,
};

const configB: AutomationConfig = {
  enabled: false,
  deltaOnK: 9,
  deltaOffK: 4,
  maxOutdoorHumidityPct: 70,
  targetTempC: 14,
  targetHysteresisK: 2,
  minRunMinutes: 60,
  minPauseMinutes: 15,
};

describe('AutomationRepository', () => {
  it('returns the defaults for an unknown stock without writing a row', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new AutomationRepository(db.db);

    expect(repo.get('grain-watch-1')).toEqual(AUTOMATION_DEFAULTS);

    const rows = db.db.select().from(stockAutomation).all();
    expect(rows).toHaveLength(0);
  });

  it('round-trips every field, including a null targetTempC', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new AutomationRepository(db.db);

    repo.upsert('grain-watch-1', configA);

    expect(repo.get('grain-watch-1')).toEqual(configA);
  });

  it('overwrites rather than duplicating on a second upsert', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new AutomationRepository(db.db);

    repo.upsert('grain-watch-1', configA);
    repo.upsert('grain-watch-1', configB);

    expect(repo.get('grain-watch-1')).toEqual(configB);
    const rows = db.db.select().from(stockAutomation).all();
    expect(rows).toHaveLength(1);
  });

  it('getMany fills gaps with defaults and returns stored values for the rest', async () => {
    const db = createTestDb();
    await seedStock(db, 'grain-watch-1');
    await seedStock(db, 'grain-watch-2');
    const repo = new AutomationRepository(db.db);

    repo.upsert('grain-watch-1', configA);

    const result = repo.getMany(['grain-watch-1', 'grain-watch-2']);

    expect(result.get('grain-watch-1')).toEqual(configA);
    expect(result.get('grain-watch-2')).toEqual(AUTOMATION_DEFAULTS);
  });

  it('removes the row when the stock is deleted (cascade)', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new AutomationRepository(db.db);
    repo.upsert('grain-watch-1', configA);

    db.db.delete(stocks).where(eq(stocks.id, 'grain-watch-1')).run();

    const rows = db.db.select().from(stockAutomation).all();
    expect(rows).toHaveLength(0);
  });
});
