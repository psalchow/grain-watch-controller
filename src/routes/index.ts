/**
 * Route exports for the grainwatch-controller BFF.
 *
 * Provides a configured router with all API endpoints mounted
 * under the /api/v1 prefix.
 */

import { Router } from 'express';
import { authRouter } from './auth.routes';
import { stocksRouter } from './stocks.routes';
import { adminRouter } from './admin.routes';

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
  router.use('/auth', authRouter);

  // Mount stock data routes
  router.use('/stocks', stocksRouter);

  // Mount admin routes
  router.use('/admin', adminRouter);

  return router;
}

/**
 * Pre-configured API router instance.
 *
 * Mount this router under /api/v1 in the main application:
 *
 * @example
 * import { apiRouter } from './routes';
 * app.use('/api/v1', apiRouter);
 */
export const apiRouter = createApiRouter();

// Re-export individual routers for direct use if needed
export { authRouter, createAuthRouter } from './auth.routes';
export { stocksRouter, createStocksRouter } from './stocks.routes';
export { adminRouter, createAdminRouter } from './admin.routes';
