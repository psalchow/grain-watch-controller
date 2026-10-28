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
  createStockSchema,
  updateStockSchema,
  tenantIdsSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  userRoleEnum,
  historyQuerySchema,
  fanCommandSchema,
  automationConfigSchema,
  typeMessages,
} from './validation.middleware';

export type {
  LoginRequest,
  ChangePasswordRequest,
  ResetPasswordRequest,
  CreateUserRequest,
  CreateStockRequest,
  UpdateStockRequest,
  StockIdParams,
  UserIdParams,
  UserRole,
  HistoryQuery,
  FanCommandRequest,
  AutomationConfigRequest,
} from './validation.middleware';
