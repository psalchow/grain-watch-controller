import { createTestDb } from '../../setup/db';
import { insertStock } from '../../setup/stocks';
import { FanStateRepository, FanEventsRepository } from '../../../src/db/repositories/fan.repository';

async function seedStock(db: ReturnType<typeof createTestDb>): Promise<void> {
  await insertStock(db.db, { id: 'grain-watch-1', fanControlEnabled: true, fanTopicPrefix: '/p' });
}

describe('FanStateRepository', () => {
  it('upserts and reads desired state', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new FanStateRepository(db.db);
    expect(repo.get('grain-watch-1')).toBeNull();
    repo.upsert({ stockId: 'grain-watch-1', desiredOn: true, since: '2026-07-09T10:00:00.000Z', lastCommandAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-09T10:00:00.000Z' });
    expect(repo.get('grain-watch-1')?.desiredOn).toBe(true);
    repo.upsert({ stockId: 'grain-watch-1', desiredOn: false, since: null, lastCommandAt: '2026-07-09T11:00:00.000Z', updatedAt: '2026-07-09T11:00:00.000Z' });
    expect(repo.get('grain-watch-1')?.desiredOn).toBe(false);
  });
});

describe('FanEventsRepository', () => {
  it('inserts, lists newest first, and prunes by cutoff', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new FanEventsRepository(db.db);
    repo.insert({ stockId: 'grain-watch-1', ts: '2026-01-01T00:00:00.000Z', kind: 'command', payload: { action: 'on' }, source: 'user' });
    repo.insert({ stockId: 'grain-watch-1', ts: '2026-07-09T00:00:00.000Z', kind: 'success', payload: { switchState: true }, source: 'shelly' });

    const recent = repo.listRecent('grain-watch-1', 50);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.kind).toBe('success');
    expect(recent[0]?.payload).toEqual({ switchState: true });

    const deleted = repo.deleteOlderThan('2026-06-01T00:00:00.000Z');
    expect(deleted).toBe(1);
    expect(repo.listRecent('grain-watch-1', 50)).toHaveLength(1);
  });
});
