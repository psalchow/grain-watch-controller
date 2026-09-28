import { hasStockAccess, UserProfile } from '../../../src/models';

const profile = (tenantIds: string[]): UserProfile => ({
  id: 'usr_001',
  username: 'viewer',
  role: 'viewer',
  tenantIds,
});

describe('hasStockAccess', () => {
  it("reaches a hall of the user's own tenant", () => {
    expect(hasStockAccess(profile(['tnt_default']), { tenantId: 'tnt_default' })).toBe(
      true,
    );
  });

  it('does not reach a hall of another tenant', () => {
    expect(hasStockAccess(profile(['tnt_default']), { tenantId: 'tnt_other' })).toBe(
      false,
    );
  });

  // The membership table, the claim and this predicate are multi-valued from
  // the start even though the API caps creation at one tenant. This is the
  // test that keeps that preparation real rather than nominal.
  it('reaches halls of both tenants when the user belongs to two', () => {
    const user = profile(['tnt_default', 'tnt_other']);

    expect(hasStockAccess(user, { tenantId: 'tnt_default' })).toBe(true);
    expect(hasStockAccess(user, { tenantId: 'tnt_other' })).toBe(true);
    expect(hasStockAccess(user, { tenantId: 'tnt_third' })).toBe(false);
  });

  it('reaches nothing without a membership', () => {
    expect(hasStockAccess(profile([]), { tenantId: 'tnt_default' })).toBe(false);
  });
});
