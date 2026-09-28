import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories';
import { UserService } from '../../../src/services/auth';

describe('mustChangePassword persistence', () => {
  let testDb: TestDb;
  let service: UserService;

  beforeEach(() => {
    testDb = createTestDb();
    service = new UserService(new UserRepository(testDb.db));
  });

  afterEach(() => testDb.close());

  it('defaults mustChangePassword to false when not provided', async () => {
    const profile = await service.createUser({
      username: 'u1',
      password: 'password123',
      role: 'viewer',
      tenantIds: ['tnt_default'],
    });
    const user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(false);
  });

  it('persists mustChangePassword=true and can clear it', async () => {
    const profile = await service.createUser({
      username: 'u2',
      password: 'password123',
      role: 'viewer',
      tenantIds: ['tnt_default'],
      mustChangePassword: true,
    });
    let user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(true);

    await service.updateUser(profile.id, { mustChangePassword: false });
    user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(false);
  });
});
