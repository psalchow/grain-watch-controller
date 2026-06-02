import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories/user.repository';
import type { User } from '../../../src/models';

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

  const sampleUser: User = {
    id: 'usr_001',
    username: 'alice',
    passwordHash: 'hash',
    role: 'admin',
    stockAccess: ['*'],
    createdAt: '2026-06-02T00:00:00.000Z',
    active: true,
  };

  it('returns null for unknown id', async () => {
    expect(await repo.findById('missing')).toBeNull();
  });

  it('returns null for unknown username', async () => {
    expect(await repo.findByUsername('ghost')).toBeNull();
  });

  it('inserts a user and hydrates stockAccess on read', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found).toEqual(sampleUser);
  });

  it('inserts a user with multiple stockAccess entries', async () => {
    const user: User = { ...sampleUser, id: 'usr_002', username: 'bob', stockAccess: ['grain-watch-1', 'grain-watch-2'] };
    await repo.insert(user);
    const found = await repo.findByUsername('bob');
    expect(found?.stockAccess.sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('persists optional email', async () => {
    const user: User = { ...sampleUser, id: 'usr_003', username: 'carol', email: 'carol@example.com' };
    await repo.insert(user);
    const found = await repo.findById('usr_003');
    expect(found?.email).toBe('carol@example.com');
  });

  it('omits email when not provided', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found?.email).toBeUndefined();
  });

  it('lists all users via findAll', async () => {
    await repo.insert(sampleUser);
    await repo.insert({ ...sampleUser, id: 'usr_002', username: 'bob' });
    const all = await repo.findAll();
    expect(all.map((u) => u.id).sort()).toEqual(['usr_001', 'usr_002']);
  });

  it('deletes a user and returns true', async () => {
    await repo.insert(sampleUser);
    expect(await repo.delete('usr_001')).toBe(true);
    expect(await repo.findById('usr_001')).toBeNull();
  });

  it('returns false when deleting an unknown user', async () => {
    expect(await repo.delete('nope')).toBe(false);
  });

  it('cascades stockAccess rows on delete', async () => {
    await repo.insert(sampleUser);
    await repo.delete('usr_001');
    const count = testDb.sqlite
      .prepare('SELECT COUNT(*) AS c FROM user_stock_access WHERE user_id = ?')
      .get('usr_001') as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('UserRepository.update', () => {
  let testDb: TestDb;
  let repo: UserRepository;

  beforeEach(async () => {
    testDb = createTestDb();
    repo = new UserRepository(testDb.db);
    await repo.insert({
      id: 'usr_001',
      username: 'alice',
      passwordHash: 'hash',
      role: 'admin',
      stockAccess: ['*'],
      createdAt: '2026-06-02T00:00:00.000Z',
      active: true,
    });
  });

  afterEach(() => testDb.close());

  it('updates scalar fields without touching stockAccess', async () => {
    await repo.update('usr_001', { username: 'alice2', active: false });
    const found = await repo.findById('usr_001');
    expect(found?.username).toBe('alice2');
    expect(found?.active).toBe(false);
    expect(found?.stockAccess).toEqual(['*']);
  });

  it('replaces stockAccess wholesale when provided', async () => {
    await repo.update('usr_001', { stockAccess: ['grain-watch-1'] });
    const found = await repo.findById('usr_001');
    expect(found?.stockAccess).toEqual(['grain-watch-1']);
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
