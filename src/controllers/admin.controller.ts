/**
 * Admin controller for user management operations.
 *
 * Provides request handlers for administrative endpoints including
 * user listing, creation, permission updates, and status changes.
 * All handlers require admin role authentication.
 */

import { Request, Response, NextFunction } from 'express';
import { UserService, UserServiceError, CreateUserData, UpdateUserData } from '../services/auth';
import { CreateUserRequest } from '../middleware';

/**
 * Controller class for admin-related endpoints.
 *
 * Handles user management operations for administrators.
 */
export class AdminController {
  private readonly userService: UserService;

  /**
   * Creates a new AdminController instance.
   *
   * @param userService - UserService instance for user management operations
   */
  constructor(userService: UserService) {
    this.userService = userService;
  }

  /**
   * Lists all users in the system.
   *
   * GET /api/v1/admin/users
   *
   * Returns all users with their profiles (excluding password hashes).
   *
   * @param req - Express request with authenticated admin user
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @example
   * Response (200):
   * {
   *   "users": [
   *     {
   *       "id": "usr_001",
   *       "username": "admin",
   *       "email": "admin@example.com",
   *       "role": "admin",
   *       "stockAccess": ["*"],
   *       "active": true,
   *       "createdAt": "2024-08-15T10:00:00Z"
   *     }
   *   ]
   * }
   */
  async listUsers(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const users = await this.userService.getAllUsers();

      // Get full user data to include createdAt and active status
      const fullUsers = await this.userService.loadUsers();

      const enrichedUsers = users.map((profile) => {
        const fullUser = fullUsers.find((u) => u.id === profile.id);
        return {
          id: profile.id,
          username: profile.username,
          email: profile.email,
          role: profile.role,
          stockAccess: profile.stockAccess,
          active: fullUser?.active ?? true,
          createdAt: fullUser?.createdAt ?? new Date().toISOString(),
        };
      });

      res.status(200).json({
        users: enrichedUsers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Creates a new user.
   *
   * POST /api/v1/admin/users
   *
   * @param req - Express request with validated CreateUserRequest body
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @example
   * Request body:
   * {
   *   "username": "farmer3",
   *   "password": "secure123",
   *   "email": "farmer3@example.com",
   *   "role": "viewer",
   *   "stockAccess": ["corn-watch-1"]
   * }
   *
   * Response (201):
   * {
   *   "id": "usr_004",
   *   "username": "farmer3",
   *   "email": "farmer3@example.com",
   *   "role": "viewer",
   *   "stockAccess": ["corn-watch-1"],
   *   "active": true,
   *   "createdAt": "2026-01-16T10:00:00Z"
   * }
   */
  async createUser(
    req: Request<object, unknown, CreateUserRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { username, password, email, role, stockAccess } = req.body;

      const createData: CreateUserData = {
        username,
        password,
        role,
        stockAccess,
      };

      // Only add email if provided
      if (email !== undefined) {
        createData.email = email;
      }

      const userProfile = await this.userService.createUser(createData);

      // Get full user data for response
      const fullUser = await this.userService.findUserById(userProfile.id);

      res.status(201).json({
        id: userProfile.id,
        username: userProfile.username,
        email: userProfile.email,
        role: userProfile.role,
        stockAccess: userProfile.stockAccess,
        active: fullUser?.active ?? true,
        createdAt: fullUser?.createdAt ?? new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        const statusCode = this.getUserErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            details: this.getUserErrorDetails(error.code),
          },
        });
        return;
      }

      next(error);
    }
  }

  /**
   * Updates user permissions (role and stock access).
   *
   * PUT /api/v1/admin/users/:userId/permissions
   *
   * @param req - Express request with userId parameter and permission updates
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @example
   * Request body:
   * {
   *   "role": "admin",
   *   "stockAccess": ["*"]
   * }
   *
   * Response (200):
   * {
   *   "id": "usr_004",
   *   "username": "farmer3",
   *   "role": "admin",
   *   "stockAccess": ["*"],
   *   "updatedAt": "2026-01-16T10:05:00Z"
   * }
   */
  async updateUserPermissions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { role, stockAccess } = req.body as { role?: string; stockAccess?: string[] };

      // Validate that at least one field is provided
      if (role === undefined && stockAccess === undefined) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'At least one permission field must be provided',
            details: 'Provide either role or stockAccess (or both) to update',
          },
        });
        return;
      }

      // Validate role if provided
      if (role !== undefined && role !== 'admin' && role !== 'viewer') {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid role',
            details: "Role must be either 'admin' or 'viewer'",
          },
        });
        return;
      }

      const updateData: UpdateUserData = {};

      if (role !== undefined) {
        updateData.role = role as 'admin' | 'viewer';
      }

      if (stockAccess !== undefined) {
        updateData.stockAccess = stockAccess;
      }

      const updatedProfile = await this.userService.updateUser(userId, updateData);

      res.status(200).json({
        id: updatedProfile.id,
        username: updatedProfile.username,
        role: updatedProfile.role,
        stockAccess: updatedProfile.stockAccess,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        const statusCode = this.getUserErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            details: this.getUserErrorDetails(error.code),
          },
        });
        return;
      }

      next(error);
    }
  }

  /**
   * Updates user status (activate/deactivate).
   *
   * PATCH /api/v1/admin/users/:userId
   *
   * @param req - Express request with userId parameter and status update
   * @param res - Express response object
   * @param next - Express next function for error handling
   *
   * @example
   * Request body:
   * {
   *   "active": false
   * }
   *
   * Response (200):
   * {
   *   "id": "usr_004",
   *   "username": "farmer3",
   *   "active": false,
   *   "updatedAt": "2026-01-16T10:10:00Z"
   * }
   */
  async updateUserStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { active } = req.body as { active?: boolean };

      // Validate that active is provided
      if (active === undefined) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Active status is required',
            details: 'Provide the active field to update user status',
          },
        });
        return;
      }

      // Validate that active is a boolean
      if (typeof active !== 'boolean') {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid active value',
            details: 'Active must be a boolean (true or false)',
          },
        });
        return;
      }

      // Prevent self-deactivation
      const currentUser = req.user;
      if (currentUser && currentUser.id === userId && !active) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Cannot deactivate your own account',
            details: 'You cannot deactivate the account you are currently using',
          },
        });
        return;
      }

      const updateData: UpdateUserData = { active };

      const updatedProfile = await this.userService.updateUser(userId, updateData);
      const fullUser = await this.userService.findUserById(userId);

      res.status(200).json({
        id: updatedProfile.id,
        username: updatedProfile.username,
        active: fullUser?.active ?? active,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        const statusCode = this.getUserErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            details: this.getUserErrorDetails(error.code),
          },
        });
        return;
      }

      next(error);
    }
  }

  /**
   * Maps user service error codes to HTTP status codes.
   *
   * @param code - UserServiceError code
   * @returns Appropriate HTTP status code
   */
  private getUserErrorStatusCode(
    code: 'USER_NOT_FOUND' | 'USERNAME_EXISTS' | 'INVALID_INPUT' | 'FILE_ERROR'
  ): number {
    switch (code) {
      case 'USER_NOT_FOUND':
        return 404;
      case 'USERNAME_EXISTS':
      case 'INVALID_INPUT':
        return 400;
      case 'FILE_ERROR':
        return 500;
      default:
        return 500;
    }
  }

  /**
   * Gets user-friendly error details based on error code.
   *
   * @param code - UserServiceError code
   * @returns Descriptive error details string
   */
  private getUserErrorDetails(
    code: 'USER_NOT_FOUND' | 'USERNAME_EXISTS' | 'INVALID_INPUT' | 'FILE_ERROR'
  ): string {
    switch (code) {
      case 'USER_NOT_FOUND':
        return 'The specified user does not exist';
      case 'USERNAME_EXISTS':
        return 'A user with this username already exists';
      case 'INVALID_INPUT':
        return 'The provided input data is invalid';
      case 'FILE_ERROR':
        return 'An error occurred while accessing user data';
      default:
        return 'An unexpected error occurred';
    }
  }
}
