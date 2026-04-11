/**
 * Centralised error handling middleware for the grainwatch-controller BFF.
 *
 * Provides standardised error responses across the API, mapping different
 * error types to appropriate HTTP status codes and response formats.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AuthenticationError } from '../services/auth';
import { UserServiceError } from '../services/auth/user.service';
import { ErrorResponse } from '../models';

/**
 * Custom validation error for request validation failures.
 */
export class ValidationError extends Error {
  /** Field-level validation errors */
  public readonly errors: Record<string, string[]>;

  /**
   * Creates a new ValidationError.
   *
   * @param message - Error message
   * @param errors - Object mapping field names to error messages
   */
  constructor(message: string, errors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * HTTP error with status code for custom error responses.
 */
export class HttpError extends Error {
  /** HTTP status code */
  public readonly statusCode: number;

  /** Error code for client-side handling */
  public readonly errorCode: string;

  /**
   * Creates a new HttpError.
   *
   * @param statusCode - HTTP status code
   * @param message - Error message
   * @param errorCode - Error code string (defaults to 'HTTP_ERROR')
   */
  constructor(statusCode: number, message: string, errorCode = 'HTTP_ERROR') {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends HttpError {
  /**
   * Creates a new NotFoundError.
   *
   * @param message - Error message (defaults to 'Resource not found')
   */
  constructor(message = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Determines whether to include error details in the response.
 *
 * @returns True if running in development mode
 */
function isDevelopment(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

/**
 * Converts a ZodError to a field-error map.
 *
 * @param error - Zod validation error
 * @returns Object mapping field paths to error messages
 */
function formatZodError(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }

  return errors;
}

/**
 * Maps error types to HTTP status codes.
 *
 * @param error - Error instance
 * @returns Appropriate HTTP status code
 */
function getStatusCode(error: Error): number {
  if (error instanceof HttpError) {
    return error.statusCode;
  }

  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof ZodError) {
    return 400;
  }

  if (error instanceof AuthenticationError) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
      case 'INVALID_TOKEN':
      case 'TOKEN_EXPIRED':
        return 401;
      case 'ACCOUNT_DISABLED':
        return 403;
      default:
        return 401;
    }
  }

  if (error instanceof UserServiceError) {
    switch (error.code) {
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

  return 500;
}

/**
 * Gets the error code string from an error.
 *
 * @param error - Error instance
 * @returns Error code string
 */
function getErrorCode(error: Error): string {
  if (error instanceof HttpError) {
    return error.errorCode;
  }

  if (error instanceof ValidationError) {
    return 'VALIDATION_ERROR';
  }

  if (error instanceof ZodError) {
    return 'VALIDATION_ERROR';
  }

  if (error instanceof AuthenticationError) {
    return error.code;
  }

  if (error instanceof UserServiceError) {
    return error.code;
  }

  return 'INTERNAL_ERROR';
}

/**
 * Gets additional details for an error (development mode only).
 *
 * @param error - Error instance
 * @returns Error details object or undefined
 */
function getErrorDetails(error: Error): unknown {
  if (!isDevelopment()) {
    return undefined;
  }

  if (error instanceof ValidationError) {
    return { fields: error.errors };
  }

  if (error instanceof ZodError) {
    return { fields: formatZodError(error) };
  }

  // Include stack trace in development for unexpected errors
  if (
    !(error instanceof HttpError) &&
    !(error instanceof AuthenticationError) &&
    !(error instanceof UserServiceError)
  ) {
    return { stack: error.stack };
  }

  return undefined;
}

/**
 * Logs error information (development mode includes more detail).
 *
 * @param error - Error instance
 * @param req - Express request object
 */
function logError(error: Error, req: Request): void {
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    error: error.name,
    message: error.message,
  };

  if (isDevelopment()) {
    console.error('Request error:', {
      ...logData,
      stack: error.stack,
    });
  } else {
    // Production: log without stack trace for most errors
    // Only log unexpected errors (status 500)
    const statusCode = getStatusCode(error);
    if (statusCode >= 500) {
      console.error('Server error:', logData);
    }
  }
}

/**
 * Centralised error handling middleware.
 *
 * Catches all errors passed via next(error) and returns a standardised
 * JSON error response. Handles different error types appropriately:
 *
 * - ValidationError / ZodError: 400 Bad Request with field errors
 * - AuthenticationError: 401/403 based on error code
 * - UserServiceError: 400/404/500 based on error code
 * - HttpError: Uses the error's status code
 * - Other errors: 500 Internal Server Error
 *
 * In development mode, additional error details and stack traces are included.
 * In production mode, stack traces are never exposed.
 *
 * @param error - Error object
 * @param req - Express request object
 * @param res - Express response object
 * @param _next - Express next function (unused but required for signature)
 *
 * @example
 * // Add as the last middleware in the chain
 * app.use(errorHandler);
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
   
  _next: NextFunction
): void {
  logError(error, req);

  const statusCode = getStatusCode(error);
  const errorCode = getErrorCode(error);
  const details = getErrorDetails(error);

  // Prepare the base response
  const response: ErrorResponse = {
    statusCode,
    message: error.message,
    error: errorCode,
    timestamp: new Date().toISOString(),
    path: req.path,
  };

  // Add details if available (development mode)
  if (details !== undefined) {
    response.details = details;
  }

  // Hide internal error messages in production for 500 errors
  if (!isDevelopment() && statusCode >= 500) {
    response.message = 'An internal server error occurred';
  }

  res.status(statusCode).json(response);
}

/**
 * Middleware to handle 404 Not Found for unmatched routes.
 *
 * Should be added after all route handlers but before the error handler.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param _next - Express next function
 *
 * @example
 * // Add before error handler
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 */
export function notFoundHandler(
  req: Request,
  res: Response,
   
  _next: NextFunction
): void {
  const response: ErrorResponse = {
    statusCode: 404,
    message: `Cannot ${req.method} ${req.path}`,
    error: 'NOT_FOUND',
    timestamp: new Date().toISOString(),
    path: req.path,
  };

  res.status(404).json(response);
}
