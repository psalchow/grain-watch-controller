/**
 * Unit tests for error handling middleware.
 *
 * Tests centralised error handling, error type mapping,
 * and response formatting in different environments.
 */

import { Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import {
  errorHandler,
  notFoundHandler,
  ValidationError,
  HttpError,
  NotFoundError,
} from '../../../src/middleware/error.middleware';
import { AuthenticationError } from '../../../src/services/auth';
import { UserServiceError } from '../../../src/services/auth/user.service';

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
    usersFilePath: './data/users.json',
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      expiresIn: '24h',
    },
  },
}));

/**
 * Mock request type for testing that allows mutable properties.
 */
interface MockRequest {
  method: string;
  path: string;
}

describe('Error Handling Middleware', () => {
  let mockRequest: MockRequest;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      method: 'GET',
      path: '/test',
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    nextFunction = jest.fn();

    // Mock console.error to prevent test output noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete process.env['NODE_ENV'];
  });

  describe('errorHandler', () => {
    describe('ValidationError handling', () => {
      it('should return 400 for ValidationError', () => {
        const error = new ValidationError('Validation failed', {
          username: ['Username is required'],
        });

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 400,
            message: 'Validation failed',
            error: 'VALIDATION_ERROR',
          })
        );
      });

      it('should include field errors in development', () => {
        process.env['NODE_ENV'] = 'development';

        const error = new ValidationError('Validation failed', {
          username: ['Username is required', 'Username is too short'],
          password: ['Password is required'],
        });

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: {
              fields: {
                username: ['Username is required', 'Username is too short'],
                password: ['Password is required'],
              },
            },
          })
        );
      });
    });

    describe('ZodError handling', () => {
      it('should return 400 for ZodError', () => {
        const issues: ZodIssue[] = [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['username'],
            message: 'Required',
          },
        ];
        const error = new ZodError(issues);

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 400,
            error: 'VALIDATION_ERROR',
          })
        );
      });

      it('should format Zod errors as field errors in development', () => {
        process.env['NODE_ENV'] = 'development';

        const issues: ZodIssue[] = [
          {
            code: 'too_small',
            minimum: 3,
            type: 'string',
            inclusive: true,
            exact: false,
            path: ['username'],
            message: 'String must contain at least 3 character(s)',
          },
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['password'],
            message: 'Required',
          },
        ];
        const error = new ZodError(issues);

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: {
              fields: {
                username: ['String must contain at least 3 character(s)'],
                password: ['Required'],
              },
            },
          })
        );
      });

      it('should handle nested paths in Zod errors', () => {
        process.env['NODE_ENV'] = 'development';

        const issues: ZodIssue[] = [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['config', 'settings', 'name'],
            message: 'Expected string, received number',
          },
        ];
        const error = new ZodError(issues);

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: {
              fields: {
                'config.settings.name': ['Expected string, received number'],
              },
            },
          })
        );
      });
    });

    describe('AuthenticationError handling', () => {
      it('should return 401 for INVALID_CREDENTIALS', () => {
        const error = new AuthenticationError(
          'Invalid username or password',
          'INVALID_CREDENTIALS'
        );

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 401,
            message: 'Invalid username or password',
            error: 'INVALID_CREDENTIALS',
          })
        );
      });

      it('should return 401 for INVALID_TOKEN', () => {
        const error = new AuthenticationError('Invalid token', 'INVALID_TOKEN');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'INVALID_TOKEN',
          })
        );
      });

      it('should return 401 for TOKEN_EXPIRED', () => {
        const error = new AuthenticationError('Token expired', 'TOKEN_EXPIRED');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'TOKEN_EXPIRED',
          })
        );
      });

      it('should return 403 for ACCOUNT_DISABLED', () => {
        const error = new AuthenticationError(
          'Account has been disabled',
          'ACCOUNT_DISABLED'
        );

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 403,
            error: 'ACCOUNT_DISABLED',
          })
        );
      });
    });

    describe('UserServiceError handling', () => {
      it('should return 404 for USER_NOT_FOUND', () => {
        const error = new UserServiceError('User not found', 'USER_NOT_FOUND');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 404,
            error: 'USER_NOT_FOUND',
          })
        );
      });

      it('should return 400 for USERNAME_EXISTS', () => {
        const error = new UserServiceError(
          'Username already exists',
          'USERNAME_EXISTS'
        );

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 400,
            error: 'USERNAME_EXISTS',
          })
        );
      });

      it('should return 400 for INVALID_INPUT', () => {
        const error = new UserServiceError('Invalid input', 'INVALID_INPUT');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should return 500 for FILE_ERROR', () => {
        const error = new UserServiceError(
          'Failed to read file',
          'FILE_ERROR'
        );

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(500);
      });
    });

    describe('HttpError handling', () => {
      it('should use status code from HttpError', () => {
        const error = new HttpError(418, "I'm a teapot", 'TEAPOT');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(418);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 418,
            message: "I'm a teapot",
            error: 'TEAPOT',
          })
        );
      });

      it('should handle NotFoundError', () => {
        const error = new NotFoundError('Stock not found');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 404,
            message: 'Stock not found',
            error: 'NOT_FOUND',
          })
        );
      });

      it('should use default error code for HttpError', () => {
        const error = new HttpError(500, 'Something went wrong');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'HTTP_ERROR',
          })
        );
      });
    });

    describe('Generic error handling', () => {
      it('should return 500 for unknown errors', () => {
        const error = new Error('Something unexpected happened');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 500,
            error: 'INTERNAL_ERROR',
          })
        );
      });

      it('should include stack trace in development for 500 errors', () => {
        process.env['NODE_ENV'] = 'development';

        const error = new Error('Unexpected error');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: {
              stack: expect.any(String),
            },
          })
        );
      });

      it('should hide error message in production for 500 errors', () => {
        process.env['NODE_ENV'] = 'production';

        const error = new Error('Sensitive internal error details');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'An internal server error occurred',
          })
        );
        expect(jsonMock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.anything(),
          })
        );
      });
    });

    describe('Response format', () => {
      it('should include all required fields in response', () => {
        const error = new Error('Test error');
        mockRequest.path = '/api/test';

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(jsonMock).toHaveBeenCalledWith({
          statusCode: expect.any(Number),
          message: expect.any(String),
          error: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/test',
          details: expect.anything(),
        });
      });

      it('should include ISO 8601 timestamp', () => {
        const error = new Error('Test error');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        const response = jsonMock.mock.calls[0][0] as { timestamp: string };
        const timestamp = new Date(response.timestamp);

        expect(timestamp.toISOString()).toBe(response.timestamp);
      });
    });

    describe('Error logging', () => {
      it('should log errors in development', () => {
        process.env['NODE_ENV'] = 'development';

        const error = new Error('Test error');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it('should log 500 errors in production', () => {
        process.env['NODE_ENV'] = 'production';

        const error = new Error('Server error');

        errorHandler(
          error,
          mockRequest as any,
          mockResponse as Response,
          nextFunction
        );

        expect(consoleErrorSpy).toHaveBeenCalled();
      });
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with proper format', () => {
      mockRequest.method = 'GET';
      mockRequest.path = '/nonexistent';

      notFoundHandler(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Cannot GET /nonexistent',
          error: 'NOT_FOUND',
          path: '/nonexistent',
        })
      );
    });

    it('should include method in message', () => {
      mockRequest.method = 'POST';
      mockRequest.path = '/api/users';

      notFoundHandler(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cannot POST /api/users',
        })
      );
    });

    it('should include timestamp', () => {
      notFoundHandler(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('Custom error classes', () => {
    describe('ValidationError', () => {
      it('should have correct name property', () => {
        const error = new ValidationError('Test', {});

        expect(error.name).toBe('ValidationError');
      });

      it('should preserve errors object', () => {
        const errors = { field1: ['error1'], field2: ['error2'] };
        const error = new ValidationError('Test', errors);

        expect(error.errors).toEqual(errors);
      });
    });

    describe('HttpError', () => {
      it('should have correct name property', () => {
        const error = new HttpError(400, 'Bad request');

        expect(error.name).toBe('HttpError');
      });

      it('should preserve status code', () => {
        const error = new HttpError(418, 'Teapot');

        expect(error.statusCode).toBe(418);
      });

      it('should preserve error code', () => {
        const error = new HttpError(400, 'Bad', 'CUSTOM_CODE');

        expect(error.errorCode).toBe('CUSTOM_CODE');
      });

      it('should default error code to HTTP_ERROR', () => {
        const error = new HttpError(400, 'Bad');

        expect(error.errorCode).toBe('HTTP_ERROR');
      });
    });

    describe('NotFoundError', () => {
      it('should have correct name property', () => {
        const error = new NotFoundError();

        expect(error.name).toBe('NotFoundError');
      });

      it('should default message to Resource not found', () => {
        const error = new NotFoundError();

        expect(error.message).toBe('Resource not found');
      });

      it('should allow custom message', () => {
        const error = new NotFoundError('User not found');

        expect(error.message).toBe('User not found');
      });

      it('should have status code 404', () => {
        const error = new NotFoundError();

        expect(error.statusCode).toBe(404);
      });

      it('should have error code NOT_FOUND', () => {
        const error = new NotFoundError();

        expect(error.errorCode).toBe('NOT_FOUND');
      });
    });
  });
});
