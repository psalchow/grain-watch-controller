import { describe, it, expect } from 'vitest';
import { shouldForcePasswordChange, isAdmin } from './access';
import { User } from '../types/api';

const base: User = { id: 'usr_001', username: 'a', role: 'viewer', tenants: [{ id: 'tnt_default', name: 'Standard' }] };

describe('access helpers', () => {
  it('forces a change when the flag is set and not already on /account', () => {
    expect(shouldForcePasswordChange({ ...base, mustChangePassword: true }, '/')).toBe(true);
  });

  it('does not force a change when already on /account', () => {
    expect(shouldForcePasswordChange({ ...base, mustChangePassword: true }, '/account')).toBe(false);
  });

  it('does not force a change without the flag', () => {
    expect(shouldForcePasswordChange(base, '/')).toBe(false);
  });

  it('does not force a change for a null user', () => {
    expect(shouldForcePasswordChange(null, '/')).toBe(false);
  });

  it('detects admins', () => {
    expect(isAdmin({ ...base, role: 'admin' })).toBe(true);
    expect(isAdmin(base)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});
