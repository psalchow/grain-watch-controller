import { describe, it, expect, beforeEach } from 'vitest';
import { authApi } from './auth';
import { apiClient } from './client';

/**
 * Builds an unsigned JWT-shaped string with the given payload.
 *
 * Encodes via TextEncoder rather than a bare `btoa(JSON.stringify(...))`: a
 * real token's payload is UTF-8, and a tenant name containing an umlaut needs
 * its multi-byte encoding preserved to exercise the decoder realistically.
 */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).replace(/=/g, '');
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('authApi.getCurrentUser (userFromToken)', () => {
  beforeEach(() => {
    apiClient.clearToken();
  });

  it('restores a user from a token carrying tenants', () => {
    const token = makeToken({
      userId: 'usr_001',
      username: 'peter',
      role: 'viewer',
      tenants: [{ id: 'tnt_default', name: 'Standard' }],
    });
    apiClient.setToken(token);

    expect(authApi.getCurrentUser()).toEqual({
      id: 'usr_001',
      username: 'peter',
      role: 'viewer',
      tenants: [{ id: 'tnt_default', name: 'Standard' }],
      mustChangePassword: false,
    });
  });

  it('returns null for a token carrying the retired stockAccess claim', () => {
    const token = makeToken({
      userId: 'usr_001',
      username: 'peter',
      role: 'viewer',
      stockAccess: ['grain-watch-1'],
    });
    apiClient.setToken(token);

    expect(authApi.getCurrentUser()).toBeNull();
  });

  it('keeps umlauts in a tenant name intact', () => {
    const token = makeToken({
      userId: 'usr_001',
      username: 'peter',
      role: 'viewer',
      tenants: [{ id: 'tnt_default', name: 'Müller Agrar' }],
    });
    apiClient.setToken(token);

    expect(authApi.getCurrentUser()?.tenants[0].name).toBe('Müller Agrar');
  });
});
