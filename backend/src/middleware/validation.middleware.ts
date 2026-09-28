/**
 * Request validation middleware using Zod schemas.
 *
 * Provides middleware factories for validating request body, query parameters,
 * and route parameters. Also exports common validation schemas for reuse.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Creates middleware that validates the request body against a Zod schema.
 *
 * On validation success, the parsed (and potentially transformed) data
 * replaces req.body. On failure, returns a 400 response with validation errors.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * const createUserSchema = z.object({
 *   username: z.string().min(3),
 *   password: z.string().min(8),
 * });
 *
 * router.post('/users', validateBody(createUserSchema), createUserHandler);
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return function validateBodyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      res.status(400).json({
        statusCode: 400,
        message: 'Request body validation failed',
        error: 'VALIDATION_ERROR',
        details: { fields: errors },
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Creates middleware that validates query parameters against a Zod schema.
 *
 * On validation success, the parsed data replaces req.query. Note that
 * query parameters are always strings, so the schema should handle coercion.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * const stockQuerySchema = z.object({
 *   start: z.string().datetime().optional(),
 *   end: z.string().datetime().optional(),
 * });
 *
 * router.get('/temperature', validateQuery(stockQuerySchema), getTemperatureHandler);
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return function validateQueryMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      res.status(400).json({
        statusCode: 400,
        message: 'Query parameter validation failed',
        error: 'VALIDATION_ERROR',
        details: { fields: errors },
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    // Replace query with parsed values (handles type coercion)
    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Creates middleware that validates route parameters against a Zod schema.
 *
 * On validation success, the parsed data replaces req.params.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * const stockParamsSchema = z.object({
 *   stockId: z.string().regex(/^corn-watch-\d+$/),
 * });
 *
 * router.get('/:stockId', validateParams(stockParamsSchema), getStockHandler);
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return function validateParamsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      res.status(400).json({
        statusCode: 400,
        message: 'Route parameter validation failed',
        error: 'VALIDATION_ERROR',
        details: { fields: errors },
        timestamp: new Date().toISOString(),
        path: req.path,
      });
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}

/**
 * Formats Zod validation errors into a field-error map.
 *
 * @param error - ZodError from failed validation
 * @returns Object mapping field paths to arrays of error messages
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }

  return errors;
}

// =============================================================================
// Common Validation Schemas
// =============================================================================

/**
 * Login request body schema.
 */
export const loginSchema = z.object({
  /** Username for authentication (3-50 characters) */
  username: z
    .string({
      required_error: 'Username is required',
      invalid_type_error: 'Username must be a string',
    })
    .min(1, 'Username is required')
    .max(50, 'Username must be at most 50 characters'),

  /** Password for authentication (8-100 characters) */
  password: z
    .string({
      required_error: 'Password is required',
      invalid_type_error: 'Password must be a string',
    })
    .min(1, 'Password is required')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from loginSchema */
export type LoginRequest = z.infer<typeof loginSchema>;

/**
 * Self-service password change request body schema.
 */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password is required')
    .max(100, 'Password must be at most 100 characters'),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from changePasswordSchema */
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

/**
 * Admin password reset request body schema.
 */
export const resetPasswordSchema = z.object({
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from resetPasswordSchema */
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

/**
 * User role enum for validation.
 */
export const userRoleEnum = z.enum(['admin', 'viewer'], {
  errorMap: () => ({ message: 'Role must be one of: admin, viewer' }),
});

/** Type for valid user role values */
export type UserRole = z.infer<typeof userRoleEnum>;

/**
 * Tenant membership as it arrives in a request body.
 *
 * Capped at one entry: storage, claim, predicate and client type all carry a
 * list, but no interface offers a second choice and no feature has answered
 * what a multi-tenant user would mean. Lifting the cap is one line.
 */
export const tenantIdsSchema = z
  .array(z.string(), {
    required_error: 'Tenant list is required',
    invalid_type_error: 'Tenants must be an array of tenant ids',
  })
  .min(1, 'At least one tenant is required')
  .max(1, 'A user can belong to at most one tenant');

/**
 * User creation request body schema.
 */
export const createUserSchema = z.object({
  /** Username (3-50 alphanumeric characters and underscores) */
  username: z
    .string({
      required_error: 'Username is required',
      invalid_type_error: 'Username must be a string',
    })
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    ),

  /** Password (8-100 characters) */
  password: z
    .string({
      required_error: 'Password is required',
      invalid_type_error: 'Password must be a string',
    })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),

  /** Email address (optional) */
  email: z
    .string()
    .email('Invalid email address')
    .optional(),

  /** User role */
  role: userRoleEnum,

  /** Ids of the tenants the user belongs to */
  tenantIds: tenantIdsSchema,
});

/** Type inferred from createUserSchema */
export type CreateUserRequest = z.infer<typeof createUserSchema>;

/**
 * Stock ID route parameter schema.
 */
export const stockIdParamsSchema = z.object({
  /** Stock identifier */
  stockId: z
    .string({
      required_error: 'Stock ID is required',
      invalid_type_error: 'Stock ID must be a string',
    })
    .min(1, 'Stock ID is required'),
});

/** Type inferred from stockIdParamsSchema */
export type StockIdParams = z.infer<typeof stockIdParamsSchema>;

/**
 * User ID route parameter schema.
 */
export const userIdParamsSchema = z.object({
  /** User identifier */
  userId: z
    .string({
      required_error: 'User ID is required',
      invalid_type_error: 'User ID must be a string',
    })
    .min(1, 'User ID is required'),
});

/** Type inferred from userIdParamsSchema */
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

/**
 * Stock history endpoint query schema.
 */
export const historyQuerySchema = z.object({
  resolution: z.enum(['day', 'week', 'month', 'year'], {
    required_error: 'Resolution is required',
    invalid_type_error: 'Resolution must be one of: day, week, month, year',
  }),
});

/** Type inferred from historyQuerySchema */
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/**
 * Fan command request body schema.
 */
export const fanCommandSchema = z.object({
  action: z.enum(['on', 'off'], {
    required_error: 'Action is required',
    invalid_type_error: 'Action must be one of: on, off',
  }),
});

/** Type inferred from fanCommandSchema */
export type FanCommandRequest = z.infer<typeof fanCommandSchema>;
