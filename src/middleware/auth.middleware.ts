/**
 * Authentication and authorisation middleware for the grainwatch-controller BFF.
 *
 * Provides Express middleware functions for JWT token verification,
 * role-based access control, and stock-level permissions.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthenticationError } from '../services/auth';
import { UserRole, UserProfile } from '../models';

// Import the Express type augmentation to ensure the Request.user property is recognised
import '../types/express.d.ts';

/**
 * Shared AuthService instance for middleware.
 * Can be overridden for testing purposes via setAuthService.
 */
let authServiceInstance: AuthService | null = null;

/**
 * Gets the AuthService instance, creating one if necessary.
 *
 * @returns AuthService instance
 */
function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}

/**
 * Sets a custom AuthService instance (primarily for testing).
 *
 * @param service - AuthService instance to use, or null to reset
 */
export function setAuthService(service: AuthService | null): void {
  authServiceInstance = service;
}

/**
 * Authentication middleware that verifies JWT tokens.
 *
 * Extracts the Bearer token from the Authorization header, validates it,
 * and attaches the decoded user profile to the request object.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * // Apply to all routes requiring authentication
 * app.use('/api', authenticate);
 *
 * // Apply to specific route
 * router.get('/profile', authenticate, (req, res) => {
 *   res.json(req.user);
 * });
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authService = getAuthService();
  const authHeader = req.headers.authorization;

  try {
    const decoded = authService.validateAuthHeader(authHeader);

    // Attach user profile to request
    const userProfile: UserProfile = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      stockAccess: decoded.stockAccess,
    };

    req.user = userProfile;
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      const statusCode = getAuthErrorStatusCode(error.code);
      res.status(statusCode).json({
        statusCode,
        message: error.message,
        error: error.code,
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    // Unexpected error - pass to error handler
    next(error);
  }
}

/**
 * Factory function that creates role-checking middleware.
 *
 * Ensures the authenticated user has the specified role. Must be used
 * after the `authenticate` middleware.
 *
 * @param role - Required role for access
 * @returns Express middleware function
 *
 * @example
 * // Require admin role for route
 * router.post('/users', authenticate, requireRole('admin'), createUserHandler);
 */
export function requireRole(role: UserRole) {
  return function requireRoleMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        statusCode: 401,
        message: 'Authentication required',
        error: 'UNAUTHENTICATED',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    if (user.role !== role) {
      res.status(403).json({
        statusCode: 403,
        message: `Access denied. Required role: ${role}`,
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware that ensures the user can access the stock in req.params.stockId.
 *
 * Checks if the user has access to the specific stock based on their
 * stockAccess list. Wildcards ('*') grant access to all stocks.
 * Must be used after the `authenticate` middleware.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * // Ensure user can access the requested stock
 * router.get('/stocks/:stockId/temperature',
 *   authenticate,
 *   requireStockAccess,
 *   getTemperatureHandler
 * );
 */
export function requireStockAccess(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({
      statusCode: 401,
      message: 'Authentication required',
      error: 'UNAUTHENTICATED',
      timestamp: new Date().toISOString(),
      path: req.path,
    });
    return;
  }

  const stockId = req.params['stockId'];

  if (!stockId || typeof stockId !== 'string') {
    res.status(400).json({
      statusCode: 400,
      message: 'Stock ID is required in route parameters',
      error: 'INVALID_REQUEST',
      timestamp: new Date().toISOString(),
      path: req.path,
    });
    return;
  }

  // Check if user has wildcard access (can access all stocks)
  if (user.stockAccess.includes('*')) {
    next();
    return;
  }

  // Check if user has explicit access to this stock
  if (!user.stockAccess.includes(stockId)) {
    res.status(403).json({
      statusCode: 403,
      message: `Access denied to stock: ${stockId}`,
      error: 'FORBIDDEN',
      timestamp: new Date().toISOString(),
      path: req.path,
    });
    return;
  }

  next();
}

/**
 * Maps authentication error codes to HTTP status codes.
 *
 * @param code - Authentication error code
 * @returns Appropriate HTTP status code
 */
function getAuthErrorStatusCode(
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
