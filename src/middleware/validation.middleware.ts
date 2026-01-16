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
 * Temperature layer enum for validation.
 */
export const layerEnum = z.enum(['bottom', 'mid', 'top'], {
  errorMap: () => ({ message: 'Layer must be one of: bottom, mid, top' }),
});

/** Type for valid temperature layer values */
export type Layer = z.infer<typeof layerEnum>;

/**
 * ISO 8601 datetime string validator.
 */
const isoDateTimeString = z.string().refine(
  (value) => {
    const date = new Date(value);
    return !isNaN(date.getTime());
  },
  { message: 'Must be a valid ISO 8601 datetime string' }
);

/**
 * Stock query parameters schema for time-series data retrieval.
 */
export const stockQuerySchema = z.object({
  /** Start of time range (ISO 8601 datetime) */
  start: isoDateTimeString.optional(),

  /** End of time range (ISO 8601 datetime) */
  end: isoDateTimeString.optional(),

  /** Temperature layer filter */
  layer: layerEnum.optional(),

  /** Device ID filter */
  device: z.string().optional(),

  /** Aggregation window (e.g., '1h', '15m', '1d') */
  window: z
    .string()
    .regex(
      /^\d+[smhd]$/,
      'Window must be a valid duration (e.g., "15m", "1h", "1d")'
    )
    .optional(),
}).refine(
  (data) => {
    // If both start and end are provided, start must be before end
    if (data.start && data.end) {
      return new Date(data.start) < new Date(data.end);
    }
    return true;
  },
  {
    message: 'Start date must be before end date',
    path: ['start'],
  }
);

/** Type inferred from stockQuerySchema */
export type StockQueryParams = z.infer<typeof stockQuerySchema>;

/**
 * User role enum for validation.
 */
export const userRoleEnum = z.enum(['admin', 'viewer'], {
  errorMap: () => ({ message: 'Role must be one of: admin, viewer' }),
});

/** Type for valid user role values */
export type UserRole = z.infer<typeof userRoleEnum>;

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

  /** List of stock IDs the user can access */
  stockAccess: z
    .array(z.string(), {
      required_error: 'Stock access list is required',
      invalid_type_error: 'Stock access must be an array of strings',
    })
    .min(1, 'At least one stock access entry is required'),
});

/** Type inferred from createUserSchema */
export type CreateUserRequest = z.infer<typeof createUserSchema>;

/**
 * User update request body schema.
 *
 * All fields are optional to allow partial updates.
 */
export const updateUserSchema = z.object({
  /** New username (optional) */
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    )
    .optional(),

  /** New password (optional) */
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters')
    .optional(),

  /** New email address (optional) */
  email: z
    .string()
    .email('Invalid email address')
    .optional(),

  /** New role (optional) */
  role: userRoleEnum.optional(),

  /** New stock access list (optional) */
  stockAccess: z
    .array(z.string())
    .min(1, 'At least one stock access entry is required')
    .optional(),

  /** Account active status (optional) */
  active: z.boolean().optional(),
}).refine(
  (data) => {
    // At least one field must be provided for an update
    return Object.keys(data).length > 0;
  },
  { message: 'At least one field must be provided for update' }
);

/** Type inferred from updateUserSchema */
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

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
