/**
 * Helpers for inspecting JWT access tokens on the client.
 *
 * These do NOT verify the signature (that is the server's job) — they only
 * read the expiry claim so the UI can avoid sending tokens it already knows
 * are expired.
 */

/**
 * Decodes the payload of a JWT without verifying its signature.
 *
 * @param token - JWT string
 * @returns The decoded payload object, or null if the token is malformed
 */
export function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Restore base64 padding stripped in base64url encoding
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Checks whether an access token is present and not (about to be) expired.
 *
 * @param token - JWT access token, or null
 * @param skewSeconds - Treat the token as invalid this many seconds before its
 *   real expiry, to avoid using a token that will expire mid-request
 * @returns true if the token is valid for at least `skewSeconds` more seconds
 */
export function isTokenValid(token: string | null, skewSeconds = 0): boolean {
  if (!token) {
    return false;
  }

  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return false;
  }

  return payload.exp * 1000 > Date.now() + skewSeconds * 1000;
}
