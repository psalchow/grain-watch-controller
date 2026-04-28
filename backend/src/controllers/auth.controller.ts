/**
 * Authentication controller for handling login and token refresh operations.
 *
 * Provides request handlers for JWT-based authentication endpoints.
 * All handlers are thin and delegate business logic to the AuthService.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthenticationError } from '../services/auth';
import { LoginRequest } from '../middleware';

/**
 * Controller class for authentication-related endpoints.
 *
 * Handles user login and token refresh operations, returning
 * standardised API responses as defined in the API design document.
 */
export class AuthController {
  private readonly authService: AuthService;

  /**
   * Creates a new AuthController instance.
   *
   * @param authService - AuthService instance for authentication operations
   */
  constructor(authService: AuthService) {
    this.authService = authService;
  }

  /**
   * Handles user login requests.
   *
   * POST /api/v1/auth/login
   *
   * Validates credentials and returns a JWT token upon successful authentication.
   * The request body is validated by middleware before reaching this handler.
   *
   * @param req - Express request with validated LoginRequest body
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @returns JSON response with token details and user profile on success
   *
   * @example
   * Request body:
   * {
   *   "username": "admin",
   *   "password": "secret123"
   * }
   *
   * Response (200):
   * {
   *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   *   "expiresIn": "24h",
   *   "user": {
   *     "id": "usr_001",
   *     "username": "admin",
   *     "role": "admin",
   *     "stockAccess": ["*"]
   *   }
   * }
   */
  async login(
    req: Request<object, unknown, LoginRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { username, password } = req.body;

      const loginResult = await this.authService.login(username, password);

      // Decode the token to get user details for the response
      const decoded = this.authService.verifyToken(loginResult.accessToken);

      res.status(200).json({
        token: loginResult.accessToken,
        expiresIn: `${loginResult.expiresIn}s`,
        user: {
          id: decoded.userId,
          username: decoded.username,
          role: decoded.role,
          stockAccess: decoded.stockAccess,
        },
      });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        const statusCode = this.getAuthErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: {
            code: this.mapErrorCode(error.code),
            message: error.message,
            details: this.getErrorDetails(error.code),
          },
        });
        return;
      }

      next(error);
    }
  }

  /**
   * Handles token refresh requests.
   *
   * POST /api/v1/auth/refresh
   *
   * Generates a new JWT token for an authenticated user, extending their session.
   * Requires a valid authentication token in the Authorization header.
   *
   * @param req - Express request with authenticated user attached
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @returns JSON response with new token details on success
   *
   * @example
   * Headers:
   * Authorization: Bearer <current-token>
   *
   * Response (200):
   * {
   *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   *   "expiresIn": "24h"
   * }
   */
  async refreshToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;

      const refreshResult = await this.authService.refreshToken(user.id);

      res.status(200).json({
        token: refreshResult.accessToken,
        expiresIn: `${refreshResult.expiresIn}s`,
      });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        const statusCode = this.getAuthErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: {
            code: this.mapErrorCode(error.code),
            message: error.message,
            details: this.getErrorDetails(error.code),
          },
        });
        return;
      }

      next(error);
    }
  }

  /**
   * Maps authentication error codes to HTTP status codes.
   *
   * @param code - Authentication error code from AuthenticationError
   * @returns Appropriate HTTP status code
   */
  private getAuthErrorStatusCode(
    code: 'INVALID_CREDENTIALS' | 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'ACCOUNT_DISABLED'
  ): number {
    switch (code) {
      case 'INVALID_CREDENTIALS':
      case 'INVALID_TOKEN':
      case 'TOKEN_EXPIRED':
        return 401;
      case 'ACCOUNT_DISABLED':
        return 403;
      default:
        return 401;
    }
  }

  /**
   * Maps internal error codes to API error codes.
   *
   * @param code - Internal authentication error code
   * @returns API error code string
   */
  private mapErrorCode(
    code: 'INVALID_CREDENTIALS' | 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'ACCOUNT_DISABLED'
  ): string {
    switch (code) {
      case 'INVALID_CREDENTIALS':
      case 'INVALID_TOKEN':
      case 'TOKEN_EXPIRED':
        return 'UNAUTHORIZED';
      case 'ACCOUNT_DISABLED':
        return 'FORBIDDEN';
      default:
        return 'UNAUTHORIZED';
    }
  }

  /**
   * Gets user-friendly error details based on error code.
   *
   * @param code - Authentication error code
   * @returns Descriptive error details string
   */
  private getErrorDetails(
    code: 'INVALID_CREDENTIALS' | 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'ACCOUNT_DISABLED'
  ): string {
    switch (code) {
      case 'INVALID_CREDENTIALS':
        return 'Username or password is incorrect';
      case 'INVALID_TOKEN':
        return 'The provided token is invalid or malformed';
      case 'TOKEN_EXPIRED':
        return 'The token has expired. Please log in again';
      case 'ACCOUNT_DISABLED':
        return 'This account has been disabled. Contact an administrator';
      default:
        return 'Authentication failed';
    }
  }
}
