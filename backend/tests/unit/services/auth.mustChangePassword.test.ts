import { AuthService } from '../../../src/services/auth';
import type { User } from '../../../src/models';

jest.mock('../../../src/config', () => ({
  config: {
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '15m',
      refreshSecret: 'test-refresh-secret-key-must-also-be-long-enough',
      refreshExpiresIn: '30d',
    },
  },
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_001',
    username: 'admin',
    passwordHash: 'hash',
    role: 'admin',
    tenants: [{ id: 'tnt_default', name: 'Standard' }],
    createdAt: '2026-01-01T00:00:00Z',
    active: true,
    ...overrides,
  };
}

describe('AuthService JWT mustChangePassword claim', () => {
  const auth = new AuthService();

  it('encodes and decodes mustChangePassword=true', () => {
    const token = auth.generateToken(makeUser({ mustChangePassword: true }));
    expect(auth.verifyToken(token).mustChangePassword).toBe(true);
  });

  it('defaults to false when the user flag is absent', () => {
    const token = auth.generateToken(makeUser());
    expect(auth.verifyToken(token).mustChangePassword).toBe(false);
  });
});
