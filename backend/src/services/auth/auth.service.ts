/**
 * Authentication service for JWT-based user authentication.
 *
 * Handles JWT token generation and verification, password hashing,
 * and user login operations.
 */

import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { config } from '../../config';
import { User, JWTPayload, UserRole } from '../../models';
import { UserService } from './user.service';

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_CREDENTIALS'
      | 'INVALID_TOKEN'
      | 'TOKEN_EXPIRED'
      | 'ACCOUNT_DISABLED'
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Result of a successful login operation.
 */
export interface LoginResult {
  /** JWT access token */
  accessToken: string;

  /** JWT refresh token (delivered to the client via httpOnly cookie) */
  refreshToken: string;

  /** Token type (always 'Bearer') */
  tokenType: 'Bearer';

  /** Access token expiry time in seconds */
  expiresIn: number;

  /** Refresh token expiry time in seconds */
  refreshExpiresIn: number;
}

/**
 * Decoded JWT payload (without standard claims).
 */
export interface DecodedToken {
  /** User identifier */
  userId: string;

  /** Username for display purposes */
  username: string;

  /** User role for authorisation checks */
  role: UserRole;

  /** Stock IDs the user can access */
  stockAccess: string[];
}

/** Salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Parses expiry string to seconds.
 *
 * @param expiresIn - Expiry string (e.g., '24h', '7d', '30m')
 * @returns Expiry time in seconds
 */
function parseExpiryToSeconds(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhdw])$/);
  if (!match) {
    // Default to 24 hours if format is unrecognised
    return 86400;
  }

  const value = parseInt(match[1] as string, 10);
  const unit = match[2] as string;

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    return 86400;
  }

  return value * multiplier;
}

/**
 * Service for JWT-based authentication operations.
 *
 * Provides methods for token generation, verification, and user login.
 */
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly jwtRefreshSecret: string;
  private readonly jwtRefreshExpiresIn: string;
  private readonly userService: UserService | null;

  /**
   * Creates a new AuthService instance.
   *
   * @param userService - Optional UserService instance. When omitted, the
   *   service relies on callers mocking auth methods (used in tests).
   *   Operations that require user lookups will throw if the service is
   *   missing.
   */
  constructor(userService?: UserService) {
    this.jwtSecret = config.jwt.secret;
    this.jwtExpiresIn = config.jwt.expiresIn;
    this.jwtRefreshSecret = config.jwt.refreshSecret;
    this.jwtRefreshExpiresIn = config.jwt.refreshExpiresIn;
    this.userService = userService ?? null;
  }

  private requireUserService(): UserService {
    if (!this.userService) {
      throw new Error('AuthService: no UserService configured');
    }
    return this.userService;
  }

  /**
   * Gets the UserService instance used by this AuthService.
   *
   * @returns UserService instance
   */
  getUserService(): UserService {
    return this.requireUserService();
  }

  /**
   * Generates a JWT token for a user.
   *
   * The token includes user ID, username, role, and stock access claims.
   *
   * @param user - User to generate token for
   * @returns JWT access token string
   */
  generateToken(user: User): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      stockAccess: user.stockAccess,
    };

    // Convert expiry to seconds for type compatibility
    const expiresInSeconds = parseExpiryToSeconds(this.jwtExpiresIn);

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Generates a long-lived refresh token for a user.
   *
   * The refresh token carries only the user id and a `type` claim, and is
   * signed with a dedicated refresh secret so it cannot be used as an access
   * token (and vice versa).
   *
   * @param user - User to generate the refresh token for
   * @returns JWT refresh token string
   */
  generateRefreshToken(user: User): string {
    const expiresInSeconds = parseExpiryToSeconds(this.jwtRefreshExpiresIn);

    return jwt.sign(
      { userId: user.id, type: 'refresh' },
      this.jwtRefreshSecret,
      { expiresIn: expiresInSeconds }
    );
  }

  /**
   * Verifies a refresh token and extracts its user id.
   *
   * @param token - Refresh token to verify
   * @returns Object containing the user id encoded in the token
   * @throws AuthenticationError if the token is invalid, expired, or not a
   *   refresh token
   */
  verifyRefreshToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, this.jwtRefreshSecret) as jwt.JwtPayload;

      if (decoded.type !== 'refresh' || typeof decoded.userId !== 'string') {
        throw new AuthenticationError(
          'Invalid refresh token',
          'INVALID_TOKEN'
        );
      }

      return { userId: decoded.userId };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError(
          'Refresh token has expired',
          'TOKEN_EXPIRED'
        );
      }

      throw new AuthenticationError(
        'Invalid refresh token',
        'INVALID_TOKEN'
      );
    }
  }

  /**
   * Verifies and decodes a JWT token.
   *
   * @param token - JWT token to verify
   * @returns Decoded token payload
   * @throws AuthenticationError if token is invalid or expired
   */
  verifyToken(token: string): DecodedToken {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;

      // Validate required claims are present
      if (
        typeof decoded.userId !== 'string' ||
        typeof decoded.username !== 'string' ||
        typeof decoded.role !== 'string' ||
        !Array.isArray(decoded.stockAccess)
      ) {
        throw new AuthenticationError(
          'Invalid token payload structure',
          'INVALID_TOKEN'
        );
      }

      return {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role as UserRole,
        stockAccess: decoded.stockAccess as string[],
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
      }

      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError(
          `Invalid token: ${error.message}`,
          'INVALID_TOKEN'
        );
      }

      throw new AuthenticationError(
        'Token verification failed',
        'INVALID_TOKEN'
      );
    }
  }

  /**
   * Authenticates a user with username and password.
   *
   * @param username - User's username
   * @param password - User's plain text password
   * @returns Login result with JWT token
   * @throws AuthenticationError if credentials are invalid or account is disabled
   */
  async login(username: string, password: string): Promise<LoginResult> {
    // Find user by username
    const user = await this.requireUserService().findUserByUsername(username);

    if (!user) {
      throw new AuthenticationError(
        'Invalid username or password',
        'INVALID_CREDENTIALS'
      );
    }

    // Check if account is active
    if (!user.active) {
      throw new AuthenticationError(
        'Account has been disabled',
        'ACCOUNT_DISABLED'
      );
    }

    // Verify password
    const isValid = await this.comparePasswords(password, user.passwordHash);

    if (!isValid) {
      throw new AuthenticationError(
        'Invalid username or password',
        'INVALID_CREDENTIALS'
      );
    }

    // Generate tokens
    return this.issueTokens(user);
  }

  /**
   * Generates a fresh access and refresh token pair for a user.
   *
   * @param user - User to issue tokens for
   * @returns Login result with access and refresh tokens
   */
  private issueTokens(user: User): LoginResult {
    return {
      accessToken: this.generateToken(user),
      refreshToken: this.generateRefreshToken(user),
      tokenType: 'Bearer',
      expiresIn: parseExpiryToSeconds(this.jwtExpiresIn),
      refreshExpiresIn: parseExpiryToSeconds(this.jwtRefreshExpiresIn),
    };
  }

  /**
   * Hashes a plain text password using bcrypt.
   *
   * @param password - Plain text password
   * @returns Hashed password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Compares a plain text password with a bcrypt hash.
   *
   * @param plaintext - Plain text password
   * @param hash - Bcrypt password hash
   * @returns True if password matches
   */
  async comparePasswords(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  /**
   * Extracts the bearer token from an Authorization header.
   *
   * @param authHeader - Authorization header value (e.g., 'Bearer xyz...')
   * @returns Token string or null if format is invalid
   */
  extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1] ?? null;
  }

  /**
   * Validates and decodes a token from an Authorization header.
   *
   * @param authHeader - Authorization header value
   * @returns Decoded token payload
   * @throws AuthenticationError if header format is invalid or token is invalid
   */
  validateAuthHeader(authHeader: string | undefined): DecodedToken {
    const token = this.extractBearerToken(authHeader);

    if (!token) {
      throw new AuthenticationError(
        'Missing or invalid Authorization header',
        'INVALID_TOKEN'
      );
    }

    return this.verifyToken(token);
  }

  /**
   * Exchanges a valid refresh token for a fresh access/refresh token pair.
   *
   * The user is re-loaded from the store so that role, stock access, and
   * account status changes take effect on refresh. A new refresh token is
   * issued (rotation). Note: being stateless, the previous refresh token
   * remains cryptographically valid until it expires.
   *
   * @param refreshToken - Refresh token presented by the client
   * @returns New login result with fresh access and refresh tokens
   * @throws AuthenticationError if the refresh token is invalid/expired, the
   *   user no longer exists, or the account is disabled
   */
  async refreshAccessToken(refreshToken: string): Promise<LoginResult> {
    const { userId } = this.verifyRefreshToken(refreshToken);

    const user = await this.requireUserService().findUserById(userId);

    if (!user) {
      throw new AuthenticationError(
        'User not found',
        'INVALID_CREDENTIALS'
      );
    }

    if (!user.active) {
      throw new AuthenticationError(
        'Account has been disabled',
        'ACCOUNT_DISABLED'
      );
    }

    return this.issueTokens(user);
  }
}
