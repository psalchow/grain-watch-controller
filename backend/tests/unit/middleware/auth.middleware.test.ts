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
import { initDb, closeDb, getDb, getSqliteHandle } from '../../../src/db';
import { runMigrations } from '../../../src/db/migrate';
import { StockRepository } from '../../../src/db/repositories';
import { DEFAULT_TENANT_ID } from '../../../src/db/schema';
import { resetServiceSingletonsForTests } from '../../../src/services';

/** The tenant the seeded hall belongs to, as it rides in a token. */
const DEFAULT_TENANT = { id: DEFAULT_TENANT_ID, name: 'Standard' };
const OTHER_TENANT_ID = 'tnt_other';

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
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

  beforeAll(async () => {
    // The default auth service Proxy resolves to the singleton, which needs
    // a DB to instantiate its UserRepository. Provide an in-memory DB so the
    // fallback path works in tests that don't override the auth service.
    // `requireStockAccess` reads halls from the same DB, hence the fixture.
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    getSqliteHandle()
      .prepare('INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
      .run(OTHER_TENANT_ID, 'Zweiter Betrieb', '2026-06-02T00:00:00.000Z');
    await new StockRepository(getDb()).upsertMany([
      {
        id: 'hall-default',
        name: 'Halle 8',
        deviceGroup: 'corn-watch-1',
        devicePrefix: '1',
        hasHumidity: true,
        hasGrainSensors: true,
        active: true,
        createdAt: '2026-06-02T00:00:00.000Z',
        fanControlEnabled: false,
        fanSwitchId: 0,
        tenantId: DEFAULT_TENANT_ID,
      },
      {
        id: 'hall-other',
        name: 'Halle 7',
        deviceGroup: 'corn-watch-2',
        devicePrefix: '2',
        hasHumidity: false,
        hasGrainSensors: true,
        active: true,
        createdAt: '2026-06-02T00:00:00.000Z',
        fanControlEnabled: false,
        fanSwitchId: 0,
        tenantId: OTHER_TENANT_ID,
      },
    ]);
  });

  afterAll(() => {
    closeDb();
    resetServiceSingletonsForTests();
  });

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
          tenants: [DEFAULT_TENANT],
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
      expect(mockRequest.user?.tenantIds).toEqual([DEFAULT_TENANT_ID]);
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
          tenants: [DEFAULT_TENANT],
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
          tenants: [DEFAULT_TENANT],
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
        tenantIds: [DEFAULT_TENANT_ID],
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
        tenantIds: [DEFAULT_TENANT_ID],
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
        tenantIds: [DEFAULT_TENANT_ID],
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
    const viewerOf = (tenantIds: string[]): UserProfile => ({
      id: 'usr_001',
      username: 'viewer',
      role: 'viewer',
      tenantIds,
    });

    it('should call next() for a hall of the user own tenant', async () => {
      mockRequest.user = viewerOf([DEFAULT_TENANT_ID]);
      mockRequest.params = { stockId: 'hall-default' };

      await requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should call next() for any hall when the user is an administrator', async () => {
      mockRequest.user = {
        id: 'usr_001',
        username: 'admin',
        role: 'admin',
        tenantIds: [DEFAULT_TENANT_ID],
      };
      mockRequest.params = { stockId: 'hall-other' };

      await requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 for a hall of another tenant', async () => {
      mockRequest.user = viewerOf([DEFAULT_TENANT_ID]);
      mockRequest.params = { stockId: 'hall-other' };

      await requireStockAccess(
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
          message: expect.stringContaining('hall-other'),
        })
      );
    });

    // 403 rather than 404 on purpose: the client reads a 404 on the fan
    // stream as fan control having been withdrawn.
    it('should return 403 for a hall that does not exist', async () => {
      mockRequest.user = viewerOf([DEFAULT_TENANT_ID]);
      mockRequest.params = { stockId: 'hall-missing' };

      await requireStockAccess(
        mockRequest as any,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 401 when user is not authenticated', async () => {
      delete mockRequest.user;
      mockRequest.params = { stockId: 'hall-default' };

      await requireStockAccess(
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

    it('should return 400 when stockId is missing from params', async () => {
      mockRequest.user = viewerOf([DEFAULT_TENANT_ID]);
      mockRequest.params = {};

      await requireStockAccess(
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

    it('should return 403 for a user without any membership', async () => {
      mockRequest.user = viewerOf([]);
      mockRequest.params = { stockId: 'hall-default' };

      await requireStockAccess(
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
        tenants: [DEFAULT_TENANT],
        mustChangePassword: false,
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
        tenants: [DEFAULT_TENANT],
        mustChangePassword: false,
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
