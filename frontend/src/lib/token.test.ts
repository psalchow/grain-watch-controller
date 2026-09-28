import { describe, it, expect } from 'vitest';
import { decodeJwtPayload, isTokenValid } from './token';

/**
 * Builds an unsigned JWT-shaped string with the given payload.
 *
 * Encodes via TextEncoder rather than a bare `btoa(JSON.stringify(...))`: a
 * real token's payload is UTF-8, and a name containing an umlaut needs its
 * multi-byte encoding preserved to exercise `decodeJwtPayload` realistically
 * (a naive helper built directly from the JS string round-trips by
 * coincidence and would not catch a regression to `atob`-only decoding).
 */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).replace(/=/g, '');
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('isTokenValid', () => {
  it('returns false for null', () => {
    expect(isTokenValid(null)).toBe(false);
  });

  it('returns false for a malformed token', () => {
    expect(isTokenValid('not-a-jwt')).toBe(false);
  });

  it('returns false for a token without an exp claim', () => {
    expect(isTokenValid(makeToken({ userId: 'u1' }))).toBe(false);
  });

  it('returns true for a token expiring in the future', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenValid(makeToken({ exp }))).toBe(true);
  });

  it('returns false for an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    expect(isTokenValid(makeToken({ exp }))).toBe(false);
  });

  it('treats a token expiring within the skew window as invalid', () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    // 30s skew → a token with 10s left is considered already invalid
    expect(isTokenValid(makeToken({ exp }), 30)).toBe(false);
  });
});

describe('decodeJwtPayload', () => {
  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });

  it('decodes a UTF-8 payload without mangling an umlaut', () => {
    const payload = decodeJwtPayload(makeToken({ name: 'Müller' }));
    expect(payload?.name).toBe('Müller');
  });
});
