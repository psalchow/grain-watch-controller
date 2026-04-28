/**
 * User-related type definitions for the grainwatch-controller BFF service.
 *
 * Defines types for user authentication, authorisation, and profile management.
 */

/**
 * User role determining access level within the system.
 * - 'admin': Full access to all stocks and administrative functions
 * - 'viewer': Read-only access to assigned stocks
 */
export type UserRole = 'admin' | 'viewer';

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

  /**
   * Stock IDs the user can access.
   * Use ['*'] to grant access to all stocks (typically for admin users).
   */
  stockAccess: string[];

  /** Account creation timestamp (ISO 8601 format) */
  createdAt: string;

  /** Whether the account is enabled */
  active: boolean;
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

  /** Stock IDs the user can access */
  stockAccess: string[];
}

/**
 * Checks whether a user has access to a specific stock.
 *
 * @param user - User profile to check
 * @param stockId - Stock identifier to check access for
 * @returns true if the user has wildcard or explicit access
 */
export function hasStockAccess(user: UserProfile, stockId: string): boolean {
  return user.stockAccess.includes('*') || user.stockAccess.includes(stockId);
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

  /** Stock IDs the user can access */
  stockAccess: string[];

  /** Token issued at timestamp (Unix epoch seconds) */
  iat: number;

  /** Token expiry timestamp (Unix epoch seconds) */
  exp: number;
}
