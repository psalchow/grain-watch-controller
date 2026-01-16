/**
 * Middleware exports for the grainwatch-controller BFF service.
 *
 * This module re-exports all middleware from a single entry point.
 */

// Authentication middleware
export {
  authenticate,
  requireRole,
  requireStockAccess,
  setAuthService,
} from './auth.middleware';

// Error handling middleware
export {
  errorHandler,
  notFoundHandler,
  ValidationError,
  HttpError,
  NotFoundError,
} from './error.middleware';

// Validation middleware
export {
  validateBody,
  validateQuery,
  validateParams,
  // Common schemas
  loginSchema,
  stockQuerySchema,
  createUserSchema,
  updateUserSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  layerEnum,
  userRoleEnum,
} from './validation.middleware';

// Re-export types from validation middleware
export type {
  LoginRequest,
  StockQueryParams,
  CreateUserRequest,
  UpdateUserRequest,
  StockIdParams,
  UserIdParams,
  Layer,
  UserRole,
} from './validation.middleware';
