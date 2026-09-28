import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories/user.repository';
import type { UserInsert } from '../../../src/db/repositories/user.repository';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';

/** A second tenant, so membership can be tested as more than a constant. */
const OTHER_TENANT_ID = 'tnt_other';

function addOtherTenant(testDb: TestDb): void {
  testDb.sqlite
    .prepare('INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
    .run(OTHER_TENANT_ID, 'Zweiter Betrieb', '2026-06-02T00:00:00.000Z');
}

describe('UserRepository', () => {
  let testDb: TestDb;
  let repo: UserRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new UserRepository(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  const sampleUser: UserInsert = {
    id: 'usr_001',
    username: 'alice',
    passwordHash: 'hash',
    role: 'admin',
    tenantIds: [DEFAULT_TENANT_ID],
    createdAt: '2026-06-02T00:00:00.000Z',
    active: true,
    mustChangePassword: false,
  };

  it('returns null for unknown id', async () => {
    expect(await repo.findById('missing')).toBeNull();
  });

  it('returns null for unknown username', async () => {
    expect(await repo.findByUsername('ghost')).toBeNull();
  });

  it('inserts a user and hydrates its memberships with names on read', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found).toEqual({
      id: 'usr_001',
      username: 'alice',
      passwordHash: 'hash',
      role: 'admin',
      tenants: [{ id: DEFAULT_TENANT_ID, name: 'Standard' }],
      createdAt: '2026-06-02T00:00:00.000Z',
      active: true,
      mustChangePassword: false,
    });
  });

  it('inserts a user belonging to two tenants', async () => {
    addOtherTenant(testDb);
    await repo.insert({
      ...sampleUser,
      id: 'usr_002',
      username: 'bob',
      tenantIds: [DEFAULT_TENANT_ID, OTHER_TENANT_ID],
    });
    const found = await repo.findByUsername('bob');
    expect(found?.tenants.map((t) => t.id).sort()).toEqual([
      DEFAULT_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    expect(found?.tenants.map((t) => t.name).sort()).toEqual([
      'Standard',
      'Zweiter Betrieb',
    ]);
  });

  it('persists optional email', async () => {
    const user: UserInsert = { ...sampleUser, id: 'usr_003', username: 'carol', email: 'carol@example.com' };
    await repo.insert(user);
    const found = await repo.findById('usr_003');
    expect(found?.email).toBe('carol@example.com');
  });

  it('omits email when not provided', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found?.email).toBeUndefined();
  });

  it('lists all users via findAll, each with its memberships', async () => {
    addOtherTenant(testDb);
    await repo.insert(sampleUser);
    await repo.insert({
      ...sampleUser,
      id: 'usr_002',
      username: 'bob',
      tenantIds: [OTHER_TENANT_ID],
    });
    const all = await repo.findAll();
    expect(all.map((u) => u.id).sort()).toEqual(['usr_001', 'usr_002']);
    expect(
      Object.fromEntries(all.map((u) => [u.id, u.tenants.map((t) => t.name)])),
    ).toEqual({
      usr_001: ['Standard'],
      usr_002: ['Zweiter Betrieb'],
    });
  });

  it('deletes a user and returns true', async () => {
    await repo.insert(sampleUser);
    expect(await repo.delete('usr_001')).toBe(true);
    expect(await repo.findById('usr_001')).toBeNull();
  });

  it('returns false when deleting an unknown user', async () => {
    expect(await repo.delete('nope')).toBe(false);
  });

  it('cascades membership rows on delete', async () => {
    await repo.insert(sampleUser);
    await repo.delete('usr_001');
    const count = testDb.sqlite
      .prepare('SELECT COUNT(*) AS c FROM user_tenants WHERE user_id = ?')
      .get('usr_001') as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('UserRepository.update', () => {
  let testDb: TestDb;
  let repo: UserRepository;

  beforeEach(async () => {
    testDb = createTestDb();
    addOtherTenant(testDb);
    repo = new UserRepository(testDb.db);
    await repo.insert({
      id: 'usr_001',
      username: 'alice',
      passwordHash: 'hash',
      role: 'admin',
      tenantIds: [DEFAULT_TENANT_ID],
      createdAt: '2026-06-02T00:00:00.000Z',
      active: true,
    });
  });

  afterEach(() => testDb.close());

  it('updates scalar fields without touching membership', async () => {
    await repo.update('usr_001', { username: 'alice2', active: false });
    const found = await repo.findById('usr_001');
    expect(found?.username).toBe('alice2');
    expect(found?.active).toBe(false);
    expect(found?.tenants).toEqual([{ id: DEFAULT_TENANT_ID, name: 'Standard' }]);
  });

  it('replaces membership wholesale when provided', async () => {
    await repo.update('usr_001', { tenantIds: [OTHER_TENANT_ID] });
    const found = await repo.findById('usr_001');
    expect(found?.tenants).toEqual([
      { id: OTHER_TENANT_ID, name: 'Zweiter Betrieb' },
    ]);
  });

  it('clears email when set to null', async () => {
    await repo.update('usr_001', { email: 'alice@example.com' });
    await repo.update('usr_001', { email: null });
    const found = await repo.findById('usr_001');
    expect(found?.email).toBeUndefined();
  });

  it('throws when user does not exist', async () => {
    await expect(repo.update('missing', { active: false })).rejects.toThrow('User not found');
  });
});
