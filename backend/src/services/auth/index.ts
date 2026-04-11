/**
 * Authentication service exports.
 *
 * Provides access to user management and JWT authentication services.
 */

export {
  UserService,
  UserServiceError,
  CreateUserData,
  UpdateUserData,
} from './user.service';

export {
  AuthService,
  AuthenticationError,
  LoginResult,
  DecodedToken,
} from './auth.service';
