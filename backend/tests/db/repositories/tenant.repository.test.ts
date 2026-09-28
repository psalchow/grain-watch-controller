import { createTestDb, TestDb } from '../../setup/db';
import { TenantRepository } from '../../../src/db/repositories';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';

describe('TenantRepository', () => {
  let testDb: TestDb;
  let repo: TenantRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new TenantRepository(testDb.db);
  });

  afterEach(() => testDb.close());

  it('lists the default tenant the migration inserts', async () => {
    expect(await repo.findAll()).toEqual([
      { id: DEFAULT_TENANT_ID, name: 'Standard' },
    ]);
  });

  it('lists every tenant', async () => {
    testDb.sqlite
      .prepare('INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
      .run('tnt_other', 'Zweiter Betrieb', '2026-06-02T00:00:00.000Z');

    const all = await repo.findAll();

    expect(all.map((t) => t.id).sort()).toEqual([DEFAULT_TENANT_ID, 'tnt_other']);
  });

  it('finds a tenant by id', async () => {
    expect(await repo.findById(DEFAULT_TENANT_ID)).toEqual({
      id: DEFAULT_TENANT_ID,
      name: 'Standard',
    });
  });

  it('returns null for an unknown id', async () => {
    expect(await repo.findById('tnt_missing')).toBeNull();
  });
});
