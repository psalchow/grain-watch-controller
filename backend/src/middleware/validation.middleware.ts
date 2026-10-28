/**
 * Request validation middleware using Zod schemas.
 *
 * Provides middleware factories for validating request body, query parameters,
 * and route parameters. Also exports common validation schemas for reuse.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodType, ZodError } from 'zod';

/**
 * Builds the `error` parameter Zod 4 uses in place of `required_error` and
 * `invalid_type_error`.
 *
 * The two messages differ in what they tell the caller — one that a field is
 * missing, the other that it carries something unusable — so the single
 * callback has to tell those apart again, which it does by the input being
 * `undefined`. Returning `undefined` hands back to Zod's own wording, which is
 * what omitting either message meant in Zod 3.
 *
 * Only the issues that stand for "wrong input altogether" are answered:
 * `invalid_type` for every schema, plus `invalid_value`, which is the one an
 * enum raises for a missing, mistyped and unknown value alike. A failed `min`
 * or `regex` is left to the message given at the check itself.
 */
export function typeMessages(
  onMissing?: string,
  onWrongType?: string
): { error: (issue: { code: string; input?: unknown }) => string | undefined } {
  return {
    error: (issue: { code: string; input?: unknown }): string | undefined =>
      issue.code === 'invalid_type' || issue.code === 'invalid_value'
        ? issue.input === undefined
          ? onMissing
          : onWrongType
        : undefined,
  };
}

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
export function validateBody<T>(schema: ZodType<T>) {
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
export function validateQuery<T>(schema: ZodType<T>) {
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
export function validateParams<T>(schema: ZodType<T>) {
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
    .string(typeMessages('Username is required', 'Username must be a string'))
    .min(1, 'Username is required')
    .max(50, 'Username must be at most 50 characters'),

  /** Password for authentication (8-100 characters) */
  password: z
    .string(typeMessages('Password is required', 'Password must be a string'))
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
    .string(typeMessages('Current password is required'))
    .min(1, 'Current password is required')
    .max(100, 'Password must be at most 100 characters'),
  newPassword: z
    .string(typeMessages('New password is required'))
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
    .string(typeMessages('New password is required'))
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from resetPasswordSchema */
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

/**
 * User role enum for validation.
 */
export const userRoleEnum = z.enum(['admin', 'viewer'], {
  // A plain string covers every issue the enum can raise, which is what the
  // Zod 3 `errorMap` did: a missing role reads the same as an unknown one.
  error: 'Role must be one of: admin, viewer',
});

/** Type for valid user role values */
export type UserRole = z.infer<typeof userRoleEnum>;

/**
 * Tenant membership as it arrives in a request body.
 *
 * Capped at one entry: storage, claim, predicate and client type all carry a
 * list, but no interface offers a second choice and no feature has answered
 * what a multi-tenant user would mean. Lifting the cap is one line.
 *
 * The bounds sit in a `superRefine` rather than on `min`/`max` because Zod 4
 * keeps running checks after the type check has already failed: a string of
 * twelve characters would otherwise be reported both as "not an array" and as
 * over the cap.
 */
export const tenantIdsSchema = z
  .array(z.string(), typeMessages('Tenant list is required', 'Tenants must be an array of tenant ids'))
  .superRefine((tenantIds, ctx) => {
    if (tenantIds.length < 1) {
      ctx.addIssue({ code: 'custom', message: 'At least one tenant is required' });
    }
    if (tenantIds.length > 1) {
      ctx.addIssue({ code: 'custom', message: 'A user can belong to at most one tenant' });
    }
  });

/**
 * User creation request body schema.
 */
export const createUserSchema = z.object({
  /** Username (3-50 alphanumeric characters and underscores) */
  username: z
    .string(typeMessages('Username is required', 'Username must be a string'))
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    ),

  /** Password (8-100 characters) */
  password: z
    .string(typeMessages('Password is required', 'Password must be a string'))
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
 * The editable stock fields, carrying their bounds but no create defaults.
 *
 * Create and update layer on top of this: create adds the defaults, update
 * makes every field optional. Keeping the defaults out of the shared shape is
 * what lets an absent field in an update stay untouched — a default on the
 * shape would be filled in by `.partial()` as well, and an empty body would
 * arrive at the repository as a full set of values.
 *
 * The two stock invariants (fan control needs a prefix, grain sensors need a
 * device group) are enforced by StockService, not here.
 */
const stockFields = {
  /** Display name (1-100 characters) */
  name: z
    .string(typeMessages('Name is required', 'Name must be a string'))
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),

  /** Free text (at most 500 characters); an empty string is stored as null */
  description: z
    .string()
    .max(500, 'Description must be at most 500 characters')
    .nullable()
    .transform((value) => (value === '' ? null : value))
    .optional(),

  /** `device-group` tag selecting the grain thermometers */
  deviceGroup: z
    .string()
    .max(64, 'Device group must be at most 64 characters')
    .nullable()
    .optional(),

  /** `device` tag selecting the outdoor sensor */
  outdoorDevice: z
    .string()
    .max(64, 'Outdoor device must be at most 64 characters')
    .nullable()
    .optional(),

  hasHumidity: z.boolean(),
  hasGrainSensors: z.boolean(),
  active: z.boolean(),
  fanControlEnabled: z.boolean(),

  /** MQTT topic prefix of the fan controller: no wildcards, no trailing slash */
  fanTopicPrefix: z
    .string()
    .max(200, 'Fan topic prefix must be at most 200 characters')
    .refine((value) => !/[#+]/.test(value), 'Fan topic prefix must not contain # or +')
    .refine((value) => !value.endsWith('/'), 'Fan topic prefix must not end in /')
    .nullable()
    .optional(),

  /** Switch channel on the fan controller (0-9) */
  fanSwitchId: z
    .number(typeMessages(undefined, 'Fan switch id must be a number'))
    .int('Fan switch id must be an integer')
    .min(0, 'Fan switch id must be between 0 and 9')
    .max(9, 'Fan switch id must be between 0 and 9'),
};

/**
 * Stock creation request body schema.
 *
 * Only `name` is required. The defaults mirror the DDL column defaults in
 * `src/db/schema.ts` (`hasHumidity` has none there and is false in practice);
 * change one set and change the other.
 */
export const createStockSchema = z.object({
  ...stockFields,
  hasHumidity: stockFields.hasHumidity.default(false),
  hasGrainSensors: stockFields.hasGrainSensors.default(true),
  active: stockFields.active.default(true),
  fanControlEnabled: stockFields.fanControlEnabled.default(false),
  fanSwitchId: stockFields.fanSwitchId.default(0),
});

/** Type inferred from createStockSchema */
export type CreateStockRequest = z.infer<typeof createStockSchema>;

/**
 * Stock update request body schema: every editable field may appear alone.
 * An empty body is rejected. Built from the undefaulted shape, so an absent
 * field stays untouched instead of being filled with a create default.
 */
export const updateStockSchema = z.object(stockFields).partial().refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: 'At least one field must be provided' }
);

/** Type inferred from updateStockSchema */
export type UpdateStockRequest = z.infer<typeof updateStockSchema>;

/**
 * Stock ID route parameter schema.
 */
export const stockIdParamsSchema = z.object({
  /** Stock identifier */
  stockId: z
    .string(typeMessages('Stock ID is required', 'Stock ID must be a string'))
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
    .string(typeMessages('User ID is required', 'User ID must be a string'))
    .min(1, 'User ID is required'),
});

/** Type inferred from userIdParamsSchema */
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

/**
 * Stock history endpoint query schema.
 */
export const historyQuerySchema = z.object({
  resolution: z.enum(['day', 'week', 'month', 'year'], typeMessages('Resolution is required', 'Resolution must be one of: day, week, month, year')),
});

/** Type inferred from historyQuerySchema */
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/**
 * Fan command request body schema.
 */
export const fanCommandSchema = z.object({
  action: z.enum(['on', 'off'], typeMessages('Action is required', 'Action must be one of: on, off')),
});

/** Type inferred from fanCommandSchema */
export type FanCommandRequest = z.infer<typeof fanCommandSchema>;

/**
 * Automation configuration request body schema.
 *
 * The switch and the seven parameters arrive in one call: the form submits them
 * together, and re-enabling after a self-disable is then the same request
 * (design spec §7). Bounds per §3.1, including the two cross-field conditions.
 */
export const automationConfigSchema = z
  .object({
    enabled: z.boolean(typeMessages('enabled is required', 'enabled must be a boolean')),
    /** Upper bound only: the lower one is `deltaOffK`, checked across the fields below. */
    deltaOnK: z
      .number(typeMessages('deltaOnK is required', 'deltaOnK must be a number'))
      .max(20, 'deltaOnK must be at most 20'),
    deltaOffK: z
      .number(typeMessages('deltaOffK is required', 'deltaOffK must be a number'))
      .min(2, 'deltaOffK must be at least 2'),
    maxOutdoorHumidityPct: z
      .number(typeMessages('maxOutdoorHumidityPct is required', 'maxOutdoorHumidityPct must be a number'))
      .min(40, 'maxOutdoorHumidityPct must be at least 40')
      .max(100, 'maxOutdoorHumidityPct must be at most 100'),
    /** Null switches the target-temperature rule off altogether. */
    targetTempC: z
      .number(typeMessages(undefined, 'targetTempC must be a number or null'))
      .min(-10, 'targetTempC must be at least -10')
      .max(30, 'targetTempC must be at most 30')
      .nullable(),
    targetHysteresisK: z
      .number(typeMessages('targetHysteresisK is required', 'targetHysteresisK must be a number'))
      .min(0, 'targetHysteresisK must be at least 0')
      .max(5, 'targetHysteresisK must be at most 5'),
    minRunMinutes: z
      .number(typeMessages('minRunMinutes is required', 'minRunMinutes must be a number'))
      .int('minRunMinutes must be a whole number of minutes')
      .min(0, 'minRunMinutes must be at least 0')
      .max(240, 'minRunMinutes must be at most 240'),
    /**
     * Five, not zero: below the evaluation interval a pause cannot take effect
     * at all, and it is the only thing bounding the retry loop a broken monitor
     * path produces (design spec §3.1).
     */
    minPauseMinutes: z
      .number(typeMessages('minPauseMinutes is required', 'minPauseMinutes must be a number'))
      .int('minPauseMinutes must be a whole number of minutes')
      .min(5, 'minPauseMinutes must be at least 5')
      .max(240, 'minPauseMinutes must be at most 240'),
  })
  // Reported against `deltaOffK`, the field the form lets the user lower: the
  // switch-off threshold has to sit strictly below the switch-on one, or the
  // fan would start and stop on the same reading.
  .refine((c) => c.deltaOffK < c.deltaOnK, {
    message: 'deltaOffK must be below deltaOnK',
    path: ['deltaOffK'],
  });

/** Type inferred from automationConfigSchema */
export type AutomationConfigRequest = z.infer<typeof automationConfigSchema>;
