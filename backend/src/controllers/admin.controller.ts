/**
 * Admin controller for user management operations.
 *
 * Provides request handlers for administrative endpoints including
 * user listing, creation, permission updates, and status changes.
 * All handlers require admin role authentication.
 */

import { Request, Response, NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { UserService, UserServiceError, CreateUserData, UpdateUserData } from '../services';
import { TenantRepository } from '../db/repositories';
import { CreateUserRequest } from '../middleware';

/**
 * Controller class for admin-related endpoints.
 *
 * Handles user management operations for administrators.
 */
export class AdminController {
  private readonly userService: UserService;
  private readonly tenantRepository: TenantRepository;

  /**
   * Creates a new AdminController instance.
   *
   * @param userService - UserService instance for user management operations
   * @param tenantRepository - Read-only tenant access, for listing and for
   *   rejecting a membership that names a tenant which does not exist
   */
  constructor(userService: UserService, tenantRepository: TenantRepository) {
    this.userService = userService;
    this.tenantRepository = tenantRepository;
  }

  /**
   * Lists all tenants.
   *
   * GET /api/v1/admin/tenants
   *
   * Exists so an administrator can pick a tenant when creating a user.
   * Tenants themselves are created with SQL, like hall configuration.
   *
   * @example
   * Response (200):
   * { "tenants": [{ "id": "tnt_default", "name": "Standard" }] }
   */
  async listTenants(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tenants = await this.tenantRepository.findAll();
      res.status(200).json({ tenants });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists all users in the system.
   *
   * GET /api/v1/admin/users
   *
   * Returns all users with their profiles (excluding password hashes).
   *
   * @param _req - Express request with authenticated admin user
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
   *       "tenants": [{ "id": "tnt_default", "name": "Standard" }],
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
      const fullUsers = await this.userService.listFullUsers();

      const enrichedUsers = fullUsers.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        tenants: user.tenants,
        active: user.active,
        createdAt: user.createdAt,
      }));

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
   *   "tenantIds": ["tnt_default"]
   * }
   *
   * Response (201):
   * {
   *   "id": "usr_004",
   *   "username": "farmer3",
   *   "email": "farmer3@example.com",
   *   "role": "viewer",
   *   "tenants": [{ "id": "tnt_default", "name": "Standard" }],
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
      const { username, password, email, role, tenantIds } = req.body;

      if (await this.rejectUnknownTenant(tenantIds, res)) return;

      const createData: CreateUserData = {
        username,
        password,
        role,
        tenantIds,
        mustChangePassword: true,
      };

      // Only add email if provided
      if (email !== undefined) {
        createData.email = email;
      }

      const userProfile = await this.userService.createUser(createData);

      // Get full user data for the response: it carries the tenant names the
      // profile deliberately leaves out, alongside active and createdAt.
      const fullUser = await this.userService.findUserById(userProfile.id);

      res.status(201).json({
        id: userProfile.id,
        username: userProfile.username,
        email: userProfile.email,
        role: userProfile.role,
        tenants: fullUser?.tenants ?? [],
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
   * Updates user permissions (role and tenant membership).
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
   *   "tenantIds": ["tnt_default"]
   * }
   *
   * Response (200):
   * {
   *   "id": "usr_004",
   *   "username": "farmer3",
   *   "role": "admin",
   *   "tenants": [{ "id": "tnt_default", "name": "Standard" }],
   *   "updatedAt": "2026-01-16T10:05:00Z"
   * }
   */
  async updateUserPermissions(
    req: Request<ParamsDictionary, unknown, { role?: string; tenantIds?: string[] }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { role, tenantIds } = req.body;

      // Validate that at least one field is provided
      if (role === undefined && tenantIds === undefined) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'At least one permission field must be provided',
            details: 'Provide either role or tenantIds (or both) to update',
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

      if (tenantIds !== undefined && (await this.rejectUnknownTenant(tenantIds, res)))
        return;

      const updateData: UpdateUserData = {};

      if (role !== undefined) {
        updateData.role = role as 'admin' | 'viewer';
      }

      if (tenantIds !== undefined) {
        updateData.tenantIds = tenantIds;
      }

      const updatedProfile = await this.userService.updateUser(userId, updateData);
      // Re-read for the tenant names, so this route answers the same shape as
      // the list and create routes.
      const fullUser = await this.userService.findUserById(userId);

      res.status(200).json({
        id: updatedProfile.id,
        username: updatedProfile.username,
        role: updatedProfile.role,
        tenants: fullUser?.tenants ?? [],
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
    req: Request<ParamsDictionary, unknown, { active?: boolean }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { active } = req.body;

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
   * Resets a user's password and forces a change on their next login.
   *
   * POST /api/v1/admin/users/:userId/reset-password
   *
   * @param req - Express request with userId param and validated body
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async resetPassword(
    req: Request<ParamsDictionary, unknown, { newPassword: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { newPassword } = req.body;

      await this.userService.updateUser(userId, {
        password: newPassword,
        mustChangePassword: true,
      });

      res.status(204).send();
    } catch (error) {
      if (error instanceof UserServiceError) {
        const statusCode = this.getUserErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: { code: error.code, message: error.message, details: this.getUserErrorDetails(error.code) },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Answers 400 when a membership names a tenant that does not exist.
   *
   * `user_tenants.tenant_id` has a foreign key, so an unknown id would fail as
   * a database error deep in the insert; this turns it into the client error
   * it is.
   *
   * @returns true when a response has been sent and the caller must stop
   */
  private async rejectUnknownTenant(
    tenantIds: string[],
    res: Response
  ): Promise<boolean> {
    for (const tenantId of tenantIds) {
      if ((await this.tenantRepository.findById(tenantId)) === null) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: `Unknown tenant: ${tenantId}`,
            details: 'Every tenant id must name an existing tenant',
          },
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Maps user service error codes to HTTP status codes.
   *
   * @param code - UserServiceError code
   * @returns Appropriate HTTP status code
   */
  private getUserErrorStatusCode(
    code: 'USER_NOT_FOUND' | 'USERNAME_EXISTS' | 'INVALID_INPUT' | 'DB_ERROR'
  ): number {
    switch (code) {
      case 'USER_NOT_FOUND':
        return 404;
      case 'USERNAME_EXISTS':
      case 'INVALID_INPUT':
        return 400;
      case 'DB_ERROR':
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
    code: 'USER_NOT_FOUND' | 'USERNAME_EXISTS' | 'INVALID_INPUT' | 'DB_ERROR'
  ): string {
    switch (code) {
      case 'USER_NOT_FOUND':
        return 'The specified user does not exist';
      case 'USERNAME_EXISTS':
        return 'A user with this username already exists';
      case 'INVALID_INPUT':
        return 'The provided input data is invalid';
      case 'DB_ERROR':
        return 'An error occurred while accessing user data';
      default:
        return 'An unexpected error occurred';
    }
  }
}
