/**
 * Route exports for the grainwatch-controller BFF.
 *
 * Provides a configured router with all API endpoints mounted
 * under the /api/v1 prefix.
 */

import { Router } from 'express';
import { createAuthRouter } from './auth.routes';
import { createStocksRouter } from './stocks.routes';
import { createAdminRouter } from './admin.routes';

/**
 * Creates the main API router with all route modules mounted.
 *
 * Route structure:
 * - /api/v1/auth/* - Authentication endpoints
 * - /api/v1/stocks/* - Stock data query endpoints
 * - /api/v1/admin/* - Admin user management endpoints
 *
 * @returns Configured Express router with all API routes
 */
export function createApiRouter(): Router {
  const router = Router();

  // Mount authentication routes
  router.use('/auth', createAuthRouter());

  // Mount stock data routes
  router.use('/stocks', createStocksRouter());

  // Mount admin routes
  router.use('/admin', createAdminRouter());

  return router;
}

// Re-export router factories for direct use if needed
export { createAuthRouter } from './auth.routes';
export { createStocksRouter } from './stocks.routes';
export { createAdminRouter } from './admin.routes';
