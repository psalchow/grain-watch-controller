/**
 * Authentication routes for the grainwatch-controller BFF.
 *
 * Provides endpoints for user login and token refresh operations.
 * Login is public; token refresh requires authentication.
 */

import { Router } from 'express';
import { AuthController } from '../controllers';
import { authService } from '../services';
import { validateBody, loginSchema, authenticate } from '../middleware';

/**
 * Creates the authentication router with all auth-related endpoints.
 *
 * @returns Configured Express router for authentication endpoints
 */
export function createAuthRouter(): Router {
  const router = Router();
  const controller = new AuthController(authService);

  /**
   * POST /login
   *
   * Authenticate user and receive JWT token.
   *
   * Request body:
   * - username: string (required)
   * - password: string (required)
   *
   * Response (200):
   * - token: JWT access token
   * - expiresIn: Token expiry duration
   * - user: User profile information
   *
   * Errors:
   * - 400: Validation error (missing/invalid fields)
   * - 401: Invalid credentials
   * - 403: Account disabled
   */
  router.post(
    '/login',
    validateBody(loginSchema),
    (req, res, next) => controller.login(req, res, next)
  );

  /**
   * POST /refresh
   *
   * Refresh JWT token for an authenticated user.
   *
   * Headers:
   * - Authorization: Bearer <current-token>
   *
   * Response (200):
   * - token: New JWT access token
   * - expiresIn: Token expiry duration
   *
   * Errors:
   * - 401: Invalid or expired token
   * - 403: Account disabled
   */
  router.post(
    '/refresh',
    authenticate,
    (req, res, next) => controller.refreshToken(req, res, next)
  );

  return router;
}

/**
 * Pre-configured authentication router instance.
 */
export const authRouter = createAuthRouter();
