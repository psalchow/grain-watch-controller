/**
 * Admin routes for the grainwatch-controller BFF.
 *
 * Provides endpoints for user management (listing, creation, permission
 * updates, status changes) and stock administration.
 *
 * All endpoints require authentication with admin role.
 */

import { Router } from 'express';
import { AdminController } from '../controllers';
import {
  authenticate,
  requireRole,
  validateBody,
  validateParams,
  createUserSchema,
  createStockSchema,
  updateStockSchema,
  stockIdParamsSchema,
  resetPasswordSchema,
  tenantIdsSchema,
  userIdParamsSchema,
  getAuthService,
} from '../middleware';
import { getTenantRepository, getStockService } from '../services';
import { z } from 'zod';

/**
 * Permission update request body schema.
 */
const updatePermissionsSchema = z.object({
  /** New role (optional) */
  role: z.enum(['admin', 'viewer']).optional(),
  /** New tenant membership (optional) */
  tenantIds: tenantIdsSchema.optional(),
}).refine(
  (data) => data.role !== undefined || data.tenantIds !== undefined,
  { message: 'At least one permission field (role or tenantIds) must be provided' }
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
  const authService = getAuthService();
  const userService = authService.getUserService();
  const controller = new AdminController(
    userService,
    getTenantRepository(),
    getStockService()
  );

  // Apply authentication and admin role check to all routes
  router.use(authenticate);
  router.use(requireRole('admin'));

  /**
   * GET /tenants
   *
   * List all tenants, so a tenant can be chosen when creating a user.
   *
   * Response (200):
   * - tenants: Array of { id, name }
   *
   * Errors:
   * - 401: Authentication required
   * - 403: Admin role required
   */
  router.get(
    '/tenants',
    (req, res, next) => controller.listTenants(req, res, next)
  );

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
   * - tenantIds: Array with exactly one tenant id
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
   * Update user permissions (role and/or tenant membership).
   *
   * Parameters:
   * - userId: User identifier
   *
   * Request body:
   * - role: 'admin' or 'viewer' (optional)
   * - tenantIds: Array with exactly one tenant id (optional)
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

  /**
   * POST /users/:userId/reset-password
   *
   * Reset a user's password to a temporary value and force a change on next
   * login.
   *
   * Response: 204 No Content
   * Errors: 400 validation, 401 unauthenticated, 403 admin required, 404 not found
   */
  router.post(
    '/users/:userId/reset-password',
    validateParams(userIdParamsSchema),
    validateBody(resetPasswordSchema),
    (req, res, next) => controller.resetPassword(req, res, next)
  );

  /**
   * GET /stocks
   *
   * List all stocks, active or not.
   *
   * Response (200):
   * - stocks: Array of stock objects
   *
   * Errors:
   * - 401: Authentication required
   * - 403: Admin role required
   */
  router.get(
    '/stocks',
    (req, res, next) => controller.listStocks(req, res, next)
  );

  /**
   * POST /stocks
   *
   * Create a stock; the id is generated.
   *
   * Request body:
   * - name: string (1-100 characters)
   * - description, deviceGroup, outdoorDevice, fanTopicPrefix: string or null
   * - hasHumidity, hasGrainSensors, active, fanControlEnabled: boolean
   * - fanSwitchId: integer 0-9
   *
   * Response (201):
   * - Created stock
   *
   * Errors:
   * - 400: Validation error, fan control without a prefix, or grain sensors
   *   without a device group
   * - 401: Authentication required
   * - 403: Admin role required
   */
  router.post(
    '/stocks',
    validateBody(createStockSchema),
    (req, res, next) => controller.createStock(req, res, next)
  );

  /**
   * PATCH /stocks/:stockId
   *
   * Update the fields present in the body; null clears an optional field.
   *
   * Response (200):
   * - Updated stock
   *
   * Errors:
   * - 400: Validation error, empty body, or an invariant broken by the result
   * - 401: Authentication required
   * - 403: Admin role required
   * - 404: Stock not found
   */
  router.patch(
    '/stocks/:stockId',
    validateParams(stockIdParamsSchema),
    validateBody(updateStockSchema),
    (req, res, next) => controller.updateStock(req, res, next)
  );

  /**
   * DELETE /stocks/:stockId
   *
   * Delete an inactive stock.
   *
   * Response: 204 No Content
   * Errors: 401 unauthenticated, 403 admin required, 404 not found,
   * 409 stock is active
   */
  router.delete(
    '/stocks/:stockId',
    validateParams(stockIdParamsSchema),
    (req, res, next) => controller.deleteStock(req, res, next)
  );

  return router;
}

