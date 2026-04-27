/**
 * Unit tests for authentication middleware.
 *
 * Tests JWT token verification, role-based access control,
 * and stock-level permission checks.
 */

import { Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import {
  authenticate,
  requireRole,
  requireStockAccess,
  setAuthService,
} from '../../../src/middleware/auth.middleware';
import { AuthService } from '../../../src/services/auth';
import { UserProfile } from '../../../src/models';

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
    usersFilePath: './data/users.json',
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
    },
    influxdb: {
      url: 'http://localhost:8086',
      token: 'test-token',
      org: 'test-org',
      bucket: 'testdb',
      measurement: 'Temp',
    },
  },
}));

/**
 * Mock request type for testing that allows mutable properties.
 */
interface MockRequest {
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  path: string;
  user?: UserProfile;
}

describe('Authentication Middleware', () => {
  let mockRequest: MockRequest;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Reset auth service before each test
    setAuthService(null);

    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      headers: {},
      params: {},
      path: '/test',
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    nextFunction = jest.fn();
  });

  afterEach(() => {
    setAuthService(null);
  });

  describe('authenticate', () => {
    it('should call next() and attach user for valid token', () => {
      const token = jwt.sign(
        {
          userId: 'usr_001',
          username: 'testuser',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        },
        'test-secret-key-for-testing-only-must-be-long-enough',
        { expiresIn: '1h' }
      );

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user?.id).toBe('usr_001');
      expect(mockRequest.user?.username).toBe('testuser');
      expect(mockRequest.user?.role).toBe('viewer');
      expect(mockRequest.user?.stockAccess).toEqual(['corn-watch-1']);
    });

    it('should return 401 for missing Authorization header', () => {
      mockRequest.headers = {};

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          error: 'INVALID_TOKEN',
        })
      );
    });

    it('should return 401 for invalid token format', () => {
      mockRequest.headers = {
        authorization: 'InvalidFormat',
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return 401 for expired token', () => {
      const token = jwt.sign(
        {
          userId: 'usr_001',
          username: 'testuser',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        },
        'test-secret-key-for-testing-only-must-be-long-enough',
        { expiresIn: '-1s' }
      );

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          error: 'TOKEN_EXPIRED',
        })
      );
    });

    it('should return 401 for token signed with wrong secret', () => {
      const token = jwt.sign(
        {
          userId: 'usr_001',
          username: 'testuser',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
        },
        'wrong-secret-key',
        { expiresIn: '1h' }
      );

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return 401 for malformed token', () => {
      mockRequest.headers = {
        authorization: 'Bearer not.a.valid.jwt',
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should include path in error response', () => {
      mockRequest.path = '/api/test/endpoint';
      mockRequest.headers = {};

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/test/endpoint',
        })
      );
    });

    it('should include timestamp in error response', () => {
      mockRequest.headers = {};

      authenticate(
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

  describe('requireRole', () => {
    it('should call next() when user has required role', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'admin',
        role: 'admin',
        stockAccess: ['*'],
      };

      const middleware = requireRole('admin');
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when user has wrong role', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };

      const middleware = requireRole('admin');
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: 'FORBIDDEN',
          message: expect.stringContaining('admin'),
        })
      );
    });

    it('should return 401 when user is not authenticated', () => {
      delete mockRequest.user;

      const middleware = requireRole('admin');
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          error: 'UNAUTHENTICATED',
        })
      );
    });

    it('should work with viewer role', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };

      const middleware = requireRole('viewer');
      middleware(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('requireStockAccess', () => {
    it('should call next() when user has explicit stock access', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: ['corn-watch-1', 'corn-watch-2'],
      };
      mockRequest.params = { stockId: 'corn-watch-1' };

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should call next() when user has wildcard access', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'admin',
        role: 'admin',
        stockAccess: ['*'],
      };
      mockRequest.params = { stockId: 'any-stock-id' };

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should return 403 when user lacks stock access', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      mockRequest.params = { stockId: 'corn-watch-2' };

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: 'FORBIDDEN',
          message: expect.stringContaining('corn-watch-2'),
        })
      );
    });

    it('should return 401 when user is not authenticated', () => {
      delete mockRequest.user;
      mockRequest.params = { stockId: 'corn-watch-1' };

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          error: 'UNAUTHENTICATED',
        })
      );
    });

    it('should return 400 when stockId is missing from params', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };
      mockRequest.params = {};

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          error: 'INVALID_REQUEST',
        })
      );
    });

    it('should return 403 for empty stock access list', () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer',
        stockAccess: [],
      };
      mockRequest.params = { stockId: 'corn-watch-1' };

      requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('setAuthService', () => {
    it('should allow setting a custom auth service', () => {
      const mockAuthService = new AuthService();
      jest.spyOn(mockAuthService, 'validateAuthHeader').mockReturnValue({
        userId: 'custom_user',
        username: 'customuser',
        role: 'admin',
        stockAccess: ['*'],
      });

      setAuthService(mockAuthService);

      mockRequest.headers = {
        authorization: 'Bearer any-token',
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user?.id).toBe('custom_user');
      expect(mockRequest.user?.username).toBe('customuser');
    });

    it('should reset to default when set to null', () => {
      const mockAuthService = new AuthService();
      jest.spyOn(mockAuthService, 'validateAuthHeader').mockReturnValue({
        userId: 'custom_user',
        username: 'customuser',
        role: 'admin',
        stockAccess: ['*'],
      });

      setAuthService(mockAuthService);
      setAuthService(null);

      // Should now use default auth service which will fail with invalid token
      mockRequest.headers = {
        authorization: 'Bearer invalid-token',
      };

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });

  describe('Error response format', () => {
    it('should return standardised error response structure', () => {
      mockRequest.headers = {};
      mockRequest.path = '/api/test';

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(jsonMock).toHaveBeenCalledWith({
        statusCode: 401,
        message: expect.any(String),
        error: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/test',
      });
    });

    it('should include ISO 8601 timestamp', () => {
      mockRequest.headers = {};

      authenticate(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      const response = jsonMock.mock.calls[0][0] as { timestamp: string };
      const timestamp = new Date(response.timestamp);

      expect(timestamp.toISOString()).toBe(response.timestamp);
    });
  });
});
