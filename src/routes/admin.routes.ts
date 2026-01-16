/**
 * Admin routes for the grainwatch-controller BFF.
 *
 * Provides endpoints for user management including listing,
 * creation, permission updates, and status changes.
 *
 * All endpoints require authentication with admin role.
 */

import { Router } from 'express';
import { AdminController } from '../controllers';
import { userService } from '../services';
import {
  authenticate,
  requireRole,
  validateBody,
  validateParams,
  createUserSchema,
  userIdParamsSchema,
} from '../middleware';
import { z } from 'zod';

/**
 * Permission update request body schema.
 */
const updatePermissionsSchema = z.object({
  /** New role (optional) */
  role: z.enum(['admin', 'viewer']).optional(),
  /** New stock access list (optional) */
  stockAccess: z
    .array(z.string())
    .min(1, 'At least one stock access entry is required')
    .optional(),
}).refine(
  (data) => data.role !== undefined || data.stockAccess !== undefined,
  { message: 'At least one permission field (role or stockAccess) must be provided' }
);

/**
 * Status update request body schema.
 */
const updateStatusSchema = z.object({
  /** Active status (required) */
  active: z.boolean({
    required_error: 'Active status is required',
    invalid_type_error: 'Active must be a boolean',
  }),
});

/**
 * Creates the admin router with all admin-related endpoints.
 *
 * @returns Configured Express router for admin endpoints
 */
export function createAdminRouter(): Router {
  const router = Router();
  const controller = new AdminController(userService);

  // Apply authentication and admin role check to all routes
  router.use(authenticate);
  router.use(requireRole('admin'));

  /**
   * GET /users
   *
   * List all users in the system.
   *
   * Response (200):
   * - users: Array of user objects with profiles and metadata
   *
   * Errors:
   * - 401: Authentication required
   * - 403: Admin role required
   */
  router.get(
    '/users',
    (req, res, next) => controller.listUsers(req, res, next)
  );

  /**
   * POST /users
   *
   * Create a new user.
   *
   * Request body:
   * - username: string (3-50 alphanumeric characters)
   * - password: string (8-100 characters)
   * - email: string (optional, valid email format)
   * - role: 'admin' or 'viewer'
   * - stockAccess: Array of stock IDs
   *
   * Response (201):
   * - Created user object
   *
   * Errors:
   * - 400: Validation error or username already exists
   * - 401: Authentication required
   * - 403: Admin role required
   */
  router.post(
    '/users',
    validateBody(createUserSchema),
    (req, res, next) => controller.createUser(req, res, next)
  );

  /**
   * PUT /users/:userId/permissions
   *
   * Update user permissions (role and/or stock access).
   *
   * Parameters:
   * - userId: User identifier
   *
   * Request body:
   * - role: 'admin' or 'viewer' (optional)
   * - stockAccess: Array of stock IDs (optional)
   *
   * Response (200):
   * - Updated user permissions
   *
   * Errors:
   * - 400: Validation error or no fields provided
   * - 401: Authentication required
   * - 403: Admin role required
   * - 404: User not found
   */
  router.put(
    '/users/:userId/permissions',
    validateParams(userIdParamsSchema),
    validateBody(updatePermissionsSchema),
    (req, res, next) => controller.updateUserPermissions(req, res, next)
  );

  /**
   * PATCH /users/:userId
   *
   * Update user status (activate/deactivate).
   *
   * Parameters:
   * - userId: User identifier
   *
   * Request body:
   * - active: boolean
   *
   * Response (200):
   * - Updated user status
   *
   * Errors:
   * - 400: Validation error or cannot deactivate own account
   * - 401: Authentication required
   * - 403: Admin role required
   * - 404: User not found
   */
  router.patch(
    '/users/:userId',
    validateParams(userIdParamsSchema),
    validateBody(updateStatusSchema),
    (req, res, next) => controller.updateUserStatus(req, res, next)
  );

  return router;
}

/**
 * Pre-configured admin router instance.
 */
export const adminRouter = createAdminRouter();
