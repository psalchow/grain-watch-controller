export {
  authenticate,
  requireRole,
  requireStockAccess,
  setAuthService,
  getAuthService,
} from './auth.middleware';

export {
  errorHandler,
  notFoundHandler,
  ValidationError,
  HttpError,
  NotFoundError,
} from './error.middleware';

export {
  validateBody,
  validateQuery,
  validateParams,
  loginSchema,
  createUserSchema,
  updateUserSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  userRoleEnum,
} from './validation.middleware';

export type {
  LoginRequest,
  CreateUserRequest,
  UpdateUserRequest,
  StockIdParams,
  UserIdParams,
  UserRole,
} from './validation.middleware';
