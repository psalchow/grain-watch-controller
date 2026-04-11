/**
 * Unit tests for validation middleware.
 *
 * Tests request body, query, and params validation using Zod schemas.
 * Also tests the common validation schemas.
 */

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  validateBody,
  validateQuery,
  validateParams,
  loginSchema,
  createUserSchema,
  updateUserSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  userRoleEnum,
} from '../../../src/middleware/validation.middleware';

/**
 * Mock request type for testing that allows mutable properties.
 */
interface MockRequest {
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, string>;
  path: string;
}

describe('Validation Middleware', () => {
  let mockRequest: MockRequest;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      body: {},
      query: {},
      params: {},
      path: '/test',
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    nextFunction = jest.fn();
  });

  describe('validateBody', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number().positive(),
    });

    it('should call next() for valid body', () => {
      mockRequest.body = { name: 'John', age: 25 };

      const middleware = validateBody(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should replace body with parsed data', () => {
      mockRequest.body = { name: '  John  ', age: 25 };

      const schemaWithTransform = z.object({
        name: z.string().transform((s) => s.trim()),
        age: z.number(),
      });

      const middleware = validateBody(schemaWithTransform);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(mockRequest.body).toEqual({ name: 'John', age: 25 });
    });

    it('should return 400 for invalid body', () => {
      mockRequest.body = { name: '', age: -5 };

      const middleware = validateBody(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return validation error format', () => {
      mockRequest.body = { name: '' };

      const middleware = validateBody(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Request body validation failed',
          error: 'VALIDATION_ERROR',
          details: {
            fields: expect.any(Object),
          },
        })
      );
    });

    it('should include field errors for each invalid field', () => {
      mockRequest.body = { name: '', age: 'not a number' };

      const middleware = validateBody(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      const response = jsonMock.mock.calls[0][0] as {
        details: { fields: Record<string, string[]> };
      };

      expect(response.details.fields.name).toBeDefined();
      expect(response.details.fields.age).toBeDefined();
    });

    it('should include path and timestamp in error response', () => {
      mockRequest.path = '/api/test';
      mockRequest.body = {};

      const middleware = validateBody(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/test',
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('validateQuery', () => {
    const testSchema = z.object({
      page: z.coerce.number().positive().optional(),
      limit: z.coerce.number().positive().optional(),
    });

    it('should call next() for valid query', () => {
      mockRequest.query = { page: '1', limit: '10' };

      const middleware = validateQuery(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should replace query with parsed data', () => {
      mockRequest.query = { page: '1', limit: '10' };

      const middleware = validateQuery(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(mockRequest.query).toEqual({ page: 1, limit: 10 });
    });

    it('should return 400 for invalid query', () => {
      mockRequest.query = { page: 'not-a-number' };

      const middleware = validateQuery(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Query parameter validation failed',
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should handle optional query parameters', () => {
      mockRequest.query = {};

      const middleware = validateQuery(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('validateParams', () => {
    const testSchema = z.object({
      id: z.string().uuid(),
    });

    it('should call next() for valid params', () => {
      mockRequest.params = { id: '550e8400-e29b-41d4-a716-446655440000' };

      const middleware = validateParams(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should return 400 for invalid params', () => {
      mockRequest.params = { id: 'not-a-uuid' };

      const middleware = validateParams(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Route parameter validation failed',
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should replace params with parsed data', () => {
      mockRequest.params = { id: '550e8400-e29b-41d4-a716-446655440000' };

      const middleware = validateParams(testSchema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(mockRequest.params).toEqual({
        id: '550e8400-e29b-41d4-a716-446655440000',
      });
    });
  });

  describe('loginSchema', () => {
    it('should accept valid login data', () => {
      const data = { username: 'testuser', password: 'password123' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should reject empty username', () => {
      const data = { username: '', password: 'password123' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject missing username', () => {
      const data = { password: 'password123' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject empty password', () => {
      const data = { username: 'testuser', password: '' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject missing password', () => {
      const data = { username: 'testuser' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject username longer than 50 characters', () => {
      const data = { username: 'a'.repeat(51), password: 'password123' };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject password longer than 100 characters', () => {
      const data = { username: 'testuser', password: 'a'.repeat(101) };
      const result = loginSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('createUserSchema', () => {
    it('should accept valid user creation data', () => {
      const data = {
        username: 'newuser',
        password: 'password123',
        email: 'user@example.com',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should accept user without email', () => {
      const data = {
        username: 'newuser',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should reject username less than 3 characters', () => {
      const data = {
        username: 'ab',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject username with special characters', () => {
      const data = {
        username: 'user@name',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should accept username with underscores', () => {
      const data = {
        username: 'user_name_123',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should reject password less than 8 characters', () => {
      const data = {
        username: 'newuser',
        password: 'short',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject invalid email format', () => {
      const data = {
        username: 'newuser',
        password: 'password123',
        email: 'not-an-email',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should accept valid roles', () => {
      for (const role of ['admin', 'viewer']) {
        const data = {
          username: 'newuser',
          password: 'password123',
          role,
          stockAccess: ['corn-watch-1'],
        };
        const result = createUserSchema.safeParse(data);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid role', () => {
      const data = {
        username: 'newuser',
        password: 'password123',
        role: 'superadmin',
        stockAccess: ['corn-watch-1'],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject empty stockAccess array', () => {
      const data = {
        username: 'newuser',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      };
      const result = createUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('updateUserSchema', () => {
    it('should accept valid partial update', () => {
      const data = { username: 'newname' };
      const result = updateUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should accept multiple fields', () => {
      const data = {
        username: 'newname',
        email: 'new@example.com',
        role: 'admin',
      };
      const result = updateUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = updateUserSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should accept active status update', () => {
      const data = { active: false };
      const result = updateUserSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should reject invalid password in update', () => {
      const data = { password: 'short' };
      const result = updateUserSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('stockIdParamsSchema', () => {
    it('should accept valid stock ID', () => {
      const result = stockIdParamsSchema.safeParse({ stockId: 'corn-watch-1' });

      expect(result.success).toBe(true);
    });

    it('should reject empty stock ID', () => {
      const result = stockIdParamsSchema.safeParse({ stockId: '' });

      expect(result.success).toBe(false);
    });

    it('should reject missing stock ID', () => {
      const result = stockIdParamsSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });

  describe('userIdParamsSchema', () => {
    it('should accept valid user ID', () => {
      const result = userIdParamsSchema.safeParse({ userId: 'usr_001' });

      expect(result.success).toBe(true);
    });

    it('should reject empty user ID', () => {
      const result = userIdParamsSchema.safeParse({ userId: '' });

      expect(result.success).toBe(false);
    });

    it('should reject missing user ID', () => {
      const result = userIdParamsSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });

  describe('userRoleEnum', () => {
    it('should accept valid role values', () => {
      for (const value of ['admin', 'viewer']) {
        const result = userRoleEnum.safeParse(value);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid role value', () => {
      const result = userRoleEnum.safeParse('superuser');

      expect(result.success).toBe(false);
    });

    it('should provide helpful error message', () => {
      const result = userRoleEnum.safeParse('invalid');

      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('admin');
        expect(result.error.issues[0]?.message).toContain('viewer');
      }
    });
  });

  describe('Error format consistency', () => {
    it('should return consistent error format for body validation', () => {
      mockRequest.body = {};

      const schema = z.object({ required: z.string() });
      const middleware = validateBody(schema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Request body validation failed',
        error: 'VALIDATION_ERROR',
        details: {
          fields: expect.any(Object),
        },
        timestamp: expect.any(String),
        path: expect.any(String),
      });
    });

    it('should return consistent error format for query validation', () => {
      mockRequest.query = { invalid: 'value' };

      const schema = z.object({ required: z.string() });
      const middleware = validateQuery(schema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Query parameter validation failed',
        error: 'VALIDATION_ERROR',
        details: {
          fields: expect.any(Object),
        },
        timestamp: expect.any(String),
        path: expect.any(String),
      });
    });

    it('should return consistent error format for params validation', () => {
      mockRequest.params = {};

      const schema = z.object({ id: z.string() });
      const middleware = validateParams(schema);
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Route parameter validation failed',
        error: 'VALIDATION_ERROR',
        details: {
          fields: expect.any(Object),
        },
        timestamp: expect.any(String),
        path: expect.any(String),
      });
    });
  });
});
