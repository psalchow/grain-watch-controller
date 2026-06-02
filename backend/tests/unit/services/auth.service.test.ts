/**
 * Unit tests for AuthService.
 *
 * These tests verify JWT token generation, verification,
 * and user authentication operations.
 */

import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories';
import {
  AuthService,
  AuthenticationError,
  UserService,
} from '../../../src/services/auth';
import { User } from '../../../src/models';

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
    },
  },
}));

/**
 * Inserts a fully-formed user into the repo without going through createUser
 * (so the test can control the password hash directly).
 */
async function seedUser(repo: UserRepository, user: User): Promise<void> {
  await repo.insert(user);
}

describe('AuthService', () => {
  let testDb: TestDb;
  let userService: UserService;
  let authService: AuthService;
  let repo: UserRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new UserRepository(testDb.db);
    userService = new UserService(repo);
    authService = new AuthService(userService);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$hashedpassword',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const token = authService.generateToken(user);

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('should include correct claims in token', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$hashedpassword',
        email: 'test@example.com',
        role: 'admin',
        stockAccess: ['*'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const token = authService.generateToken(user);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.userId).toBe('usr_001');
      expect(decoded.username).toBe('testuser');
      expect(decoded.role).toBe('admin');
      expect(decoded.stockAccess).toEqual(['*']);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should not include sensitive data in token', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$hashedpassword',
        email: 'test@example.com',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const token = authService.generateToken(user);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.passwordHash).toBeUndefined();
      expect(decoded.email).toBeUndefined();
      expect(decoded.createdAt).toBeUndefined();
      expect(decoded.active).toBeUndefined();
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$hashedpassword',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const token = authService.generateToken(user);
      const decoded = authService.verifyToken(token);

      expect(decoded.userId).toBe('usr_001');
      expect(decoded.username).toBe('testuser');
      expect(decoded.role).toBe('viewer');
      expect(decoded.stockAccess).toEqual(['corn-watch-1']);
    });

    it('should throw error for invalid token', () => {
      expect(() => authService.verifyToken('invalid-token')).toThrow(
        AuthenticationError
      );

      expect(() => authService.verifyToken('invalid-token')).toThrow(
        'Invalid token'
      );
    });

    it('should throw error for malformed token', () => {
      expect(() => authService.verifyToken('not.a.jwt.at.all')).toThrow(
        AuthenticationError
      );
    });

    it('should throw error for expired token', () => {
      // Create a token that expires immediately
      const expiredToken = jwt.sign(
        {
          userId: 'usr_001',
          username: 'test',
          role: 'viewer',
          stockAccess: [],
        },
        'test-secret-key-for-testing-only-must-be-long-enough',
        { expiresIn: '-1s' }
      );

      expect(() => authService.verifyToken(expiredToken)).toThrow(
        AuthenticationError
      );

      try {
        authService.verifyToken(expiredToken);
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('TOKEN_EXPIRED');
      }
    });

    it('should throw error for token signed with wrong secret', () => {
      const wrongSecretToken = jwt.sign(
        {
          userId: 'usr_001',
          username: 'test',
          role: 'viewer',
          stockAccess: [],
        },
        'wrong-secret-key'
      );

      expect(() => authService.verifyToken(wrongSecretToken)).toThrow(
        AuthenticationError
      );
    });

    it('should throw error for token with missing required claims', () => {
      const incompleteToken = jwt.sign(
        {
          userId: 'usr_001',
          // Missing username, role, stockAccess
        },
        'test-secret-key-for-testing-only-must-be-long-enough'
      );

      expect(() => authService.verifyToken(incompleteToken)).toThrow(
        'Invalid token payload structure'
      );
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      // Create a test user
      const passwordHash = await bcrypt.hash('password123', 10);
      await seedUser(repo, {
        id: 'usr_001',
        username: 'testuser',
        passwordHash,
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      });
      await seedUser(repo, {
        id: 'usr_002',
        username: 'disableduser',
        passwordHash,
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: false,
      });
    });

    it('should return login result for valid credentials', async () => {
      const result = await authService.login('testuser', 'password123');

      expect(result.accessToken).toBeDefined();
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(86400); // 24 hours in seconds
    });

    it('should return valid JWT in login result', async () => {
      const result = await authService.login('testuser', 'password123');

      const decoded = authService.verifyToken(result.accessToken);

      expect(decoded.userId).toBe('usr_001');
      expect(decoded.username).toBe('testuser');
    });

    it('should throw error for non-existent user', async () => {
      await expect(
        authService.login('nonexistent', 'password123')
      ).rejects.toThrow(AuthenticationError);

      await expect(
        authService.login('nonexistent', 'password123')
      ).rejects.toThrow('Invalid username or password');

      try {
        await authService.login('nonexistent', 'password123');
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('should throw error for wrong password', async () => {
      await expect(
        authService.login('testuser', 'wrongpassword')
      ).rejects.toThrow('Invalid username or password');

      try {
        await authService.login('testuser', 'wrongpassword');
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('should throw error for disabled account', async () => {
      await expect(
        authService.login('disableduser', 'password123')
      ).rejects.toThrow('Account has been disabled');

      try {
        await authService.login('disableduser', 'password123');
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('ACCOUNT_DISABLED');
      }
    });
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'securepassword123';
      const hash = await authService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2b$')).toBe(true);
    });

    it('should produce different hashes for same password', async () => {
      const password = 'securepassword123';

      const hash1 = await authService.hashPassword(password);
      const hash2 = await authService.hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePasswords', () => {
    it('should return true for matching password', async () => {
      const password = 'securepassword123';
      const hash = await bcrypt.hash(password, 10);

      const result = await authService.comparePasswords(password, hash);

      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const hash = await bcrypt.hash('correctpassword', 10);

      const result = await authService.comparePasswords('wrongpassword', hash);

      expect(result).toBe(false);
    });
  });

  describe('extractBearerToken', () => {
    it('should extract token from valid Authorization header', () => {
      const token = authService.extractBearerToken('Bearer abc123xyz');

      expect(token).toBe('abc123xyz');
    });

    it('should return null for undefined header', () => {
      const token = authService.extractBearerToken(undefined);

      expect(token).toBeNull();
    });

    it('should return null for empty header', () => {
      const token = authService.extractBearerToken('');

      expect(token).toBeNull();
    });

    it('should return null for non-Bearer scheme', () => {
      const token = authService.extractBearerToken('Basic abc123xyz');

      expect(token).toBeNull();
    });

    it('should return null for malformed header', () => {
      expect(authService.extractBearerToken('Bearer')).toBeNull();
      expect(authService.extractBearerToken('Bearerabc123')).toBeNull();
      expect(authService.extractBearerToken('Bearer a b c')).toBeNull();
    });
  });

  describe('validateAuthHeader', () => {
    it('should validate and decode token from header', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$hashedpassword',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const token = authService.generateToken(user);
      const decoded = authService.validateAuthHeader(`Bearer ${token}`);

      expect(decoded.userId).toBe('usr_001');
      expect(decoded.username).toBe('testuser');
    });

    it('should throw error for missing header', () => {
      expect(() => authService.validateAuthHeader(undefined)).toThrow(
        'Missing or invalid Authorization header'
      );
    });

    it('should throw error for invalid header format', () => {
      expect(() => authService.validateAuthHeader('Basic abc')).toThrow(
        'Missing or invalid Authorization header'
      );
    });

    it('should throw error for invalid token in header', () => {
      expect(() =>
        authService.validateAuthHeader('Bearer invalid-token')
      ).toThrow(AuthenticationError);
    });
  });

  describe('refreshToken', () => {
    beforeEach(async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      await seedUser(repo, {
        id: 'usr_001',
        username: 'activeuser',
        passwordHash,
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      });
      await seedUser(repo, {
        id: 'usr_002',
        username: 'disableduser',
        passwordHash,
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: false,
      });
    });

    it('should generate new token for active user', async () => {
      const result = await authService.refreshToken('usr_001');

      expect(result.accessToken).toBeDefined();
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(86400);

      const decoded = authService.verifyToken(result.accessToken);
      expect(decoded.userId).toBe('usr_001');
    });

    it('should throw error for non-existent user', async () => {
      await expect(authService.refreshToken('usr_999')).rejects.toThrow(
        'User not found'
      );

      try {
        await authService.refreshToken('usr_999');
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('should throw error for disabled user', async () => {
      await expect(authService.refreshToken('usr_002')).rejects.toThrow(
        'Account has been disabled'
      );

      try {
        await authService.refreshToken('usr_002');
      } catch (error) {
        expect((error as AuthenticationError).code).toBe('ACCOUNT_DISABLED');
      }
    });
  });

  describe('AuthenticationError', () => {
    it('should have correct name property', () => {
      const error = new AuthenticationError('test', 'INVALID_CREDENTIALS');

      expect(error.name).toBe('AuthenticationError');
    });

    it('should preserve error codes', () => {
      const codes = [
        'INVALID_CREDENTIALS',
        'INVALID_TOKEN',
        'TOKEN_EXPIRED',
        'ACCOUNT_DISABLED',
      ] as const;

      for (const code of codes) {
        const error = new AuthenticationError('test message', code);
        expect(error.code).toBe(code);
        expect(error.message).toBe('test message');
      }
    });
  });
});
