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
  changePasswordSchema,
  resetPasswordSchema,
  createUserSchema,
  tenantIdsSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  userRoleEnum,
  historyQuerySchema,
  fanCommandSchema,
} from './validation.middleware';

export type {
  LoginRequest,
  ChangePasswordRequest,
  ResetPasswordRequest,
  CreateUserRequest,
  StockIdParams,
  UserIdParams,
  UserRole,
  HistoryQuery,
  FanCommandRequest,
} from './validation.middleware';
