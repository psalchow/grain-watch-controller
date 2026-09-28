/**
 * User-related type definitions for the grainwatch-controller BFF service.
 *
 * Defines types for user authentication, authorisation, and profile management.
 */

/**
 * User role determining access level within the system.
 * - 'admin': Full access to all stocks and administrative functions
 * - 'viewer': Read-only access to the stocks of their tenants
 */
export type UserRole = 'admin' | 'viewer';

/**
 * A tenant as it travels with a user: the id authorises, the name is display
 * data so the client can label a session without a second request.
 */
export interface TenantRef {
  /** Unique tenant identifier (e.g. 'tnt_default') */
  id: string;

  /** Display name, free text */
  name: string;
}

/**
 * Complete user entity as stored in the user database.
 * Contains sensitive information (passwordHash) - never expose directly via API.
 */
export interface User {
  /** Unique user identifier (e.g., 'usr_001') */
  id: string;

  /** Login username (unique) */
  username: string;

  /** Bcrypt hash of the user's password */
  passwordHash: string;

  /** User email address (optional) */
  email?: string;

  /** User role determining access level */
  role: UserRole;

  /** Tenants the user belongs to, with their display names */
  tenants: TenantRef[];

  /** Account creation timestamp (ISO 8601 format) */
  createdAt: string;

  /** Whether the account is enabled */
  active: boolean;

  /** Whether the user must change their password on next login */
  mustChangePassword?: boolean;
}

/**
 * Sanitised user profile for API responses.
 * Excludes sensitive information such as password hash.
 */
export interface UserProfile {
  /** Unique user identifier */
  id: string;

  /** Login username */
  username: string;

  /** User email address (optional) */
  email?: string;

  /** User role */
  role: UserRole;

  /**
   * Ids of the tenants the user belongs to.
   *
   * Ids only: this profile feeds `req.user` and the access predicate, neither
   * of which has any use for a display name. Responses that need names project
   * them from the full {@link User} instead.
   */
  tenantIds: string[];

  /** Whether the user must change their password on next login */
  mustChangePassword?: boolean;
}

/**
 * Checks whether a user reaches a specific stock.
 *
 * Tenant membership only — the administrator bypass lives at the call sites,
 * because an administrator is not a member of every tenant, they simply skip
 * the filter.
 *
 * @param user - User profile to check
 * @param stock - The stock to check access for
 * @returns true if the stock belongs to one of the user's tenants
 */
export function hasStockAccess(
  user: UserProfile,
  stock: { tenantId: string }
): boolean {
  return user.tenantIds.includes(stock.tenantId);
}

/**
 * JWT token payload structure.
 * Contains claims embedded in the authentication token.
 */
export interface JWTPayload {
  /** User identifier */
  userId: string;

  /** Username for display purposes */
  username: string;

  /** User role for authorisation checks */
  role: UserRole;

  /** Tenants the user belongs to; the ids authorise, the names are display data */
  tenants: TenantRef[];

  /** Whether the user must change their password on next login */
  mustChangePassword?: boolean;

  /** Token issued at timestamp (Unix epoch seconds) */
  iat: number;

  /** Token expiry timestamp (Unix epoch seconds) */
  exp: number;
}
