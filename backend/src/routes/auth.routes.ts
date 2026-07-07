/**
 * Authentication routes for the grainwatch-controller BFF.
 *
 * Provides endpoints for user login and token refresh operations.
 * Login is public; token refresh requires authentication.
 */

import { Router } from 'express';
import { AuthController } from '../controllers';
import { validateBody, loginSchema, getAuthService } from '../middleware';

/**
 * Creates the authentication router with all auth-related endpoints.
 *
 * @returns Configured Express router for authentication endpoints
 */
export function createAuthRouter(): Router {
  const router = Router();
  const authService = getAuthService();
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
   * Exchange the refresh-token cookie for a new access token. No Authorization
   * header is required, so this works even after the access token has expired.
   *
   * Cookie:
   * - refresh_token: <current refresh token>
   *
   * Response (200):
   * - token: New JWT access token
   * - expiresIn: Token expiry duration
   *
   * Errors:
   * - 401: Missing, invalid, or expired refresh token
   * - 403: Account disabled
   */
  router.post(
    '/refresh',
    (req, res, next) => controller.refreshToken(req, res, next)
  );

  /**
   * POST /logout
   *
   * Clear the refresh-token cookie. Public endpoint that always returns 204,
   * so logout works regardless of access-token state.
   */
  router.post('/logout', (req, res) => controller.logout(req, res));

  return router;
}

