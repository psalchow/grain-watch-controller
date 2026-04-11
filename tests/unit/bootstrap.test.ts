/**
 * Tests for application bootstrap functionality.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

// Mock the services module to provide a test-specific userService
jest.mock('../../src/services', () => {
  const testUsersFile = path.join(__dirname, '../data/bootstrap-test/users.json');
  const originalModule = jest.requireActual('../../src/services');
  const testUserService = new originalModule.UserService(testUsersFile);

  return {
    ...originalModule,
    userService: testUserService,
  };
});

// Import after mocking
import { bootstrapApplication, validateBootstrap } from '../../src/bootstrap';
import { userService } from '../../src/services';

describe('Application Bootstrap', () => {
  const testUsersDir = path.join(__dirname, '../data/bootstrap-test');

  beforeEach(async () => {
    // Clean up any existing test files
    try {
      await fs.rm(testUsersDir, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }

    // Clear the cache
    userService.clearCache();
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testUsersDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('bootstrapApplication', () => {
    it('should create default admin user when no users exist', async () => {
      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(true);
      expect(result.defaultAdminUsername).toBe('admin');

      // Verify the user was actually created
      const users = await userService.getAllUsers();
      expect(users).toHaveLength(1);
      expect(users[0]?.username).toBe('admin');
      expect(users[0]?.role).toBe('admin');
      expect(users[0]?.stockAccess).toEqual(['*']);
    });

    it('should not create default users when users already exist', async () => {
      // Create a user first
      await userService.createUser({
        username: 'existing-user',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['stock1'],
      });

      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(false);
      expect(result.defaultAdminUsername).toBeUndefined();

      // Verify no additional users were created
      const users = await userService.getAllUsers();
      expect(users).toHaveLength(1);
      expect(users[0]?.username).toBe('existing-user');
    });

    it('should be idempotent when called multiple times', async () => {
      // Call bootstrap twice
      const result1 = await bootstrapApplication();
      const result2 = await bootstrapApplication();

      expect(result1.defaultUsersCreated).toBe(true);
      expect(result2.defaultUsersCreated).toBe(false);

      // Verify only one user exists
      const users = await userService.getAllUsers();
      expect(users).toHaveLength(1);
      expect(users[0]?.username).toBe('admin');
    });

    it('should handle bootstrap errors gracefully in development mode', async () => {
      // Mock initializeDefaultUsers to throw an error
      const mockError = new Error('Simulated bootstrap failure');
      jest.spyOn(userService, 'initializeDefaultUsers').mockRejectedValueOnce(mockError);

      // Override NODE_ENV temporarily
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      try {
        // Mock console methods
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // Bootstrap should not throw, but return a result
        const result = await bootstrapApplication();

        expect(result.defaultUsersCreated).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to bootstrap application:',
          'Simulated bootstrap failure'
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Continuing despite bootstrap failure (development mode)'
        );

        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      } finally {
        // Restore original environment
        if (originalEnv !== undefined) {
          process.env['NODE_ENV'] = originalEnv;
        } else {
          delete process.env['NODE_ENV'];
        }
      }
    });
  });

  describe('validateBootstrap', () => {
    it('should return true when users exist', async () => {
      // Create a user
      await userService.createUser({
        username: 'test-user',
        password: 'password123',
        role: 'viewer',
        stockAccess: ['stock1'],
      });

      const isValid = await validateBootstrap();
      expect(isValid).toBe(true);
    });

    it('should return false when no users exist', async () => {
      const isValid = await validateBootstrap();
      expect(isValid).toBe(false);
    });

    it('should return false on validation errors', async () => {
      // Mock getAllUsers to throw an error
      const mockError = new Error('Simulated validation error');
      jest.spyOn(userService, 'getAllUsers').mockRejectedValueOnce(mockError);

      // Mock console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const isValid = await validateBootstrap();

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Bootstrap validation failed:',
        'Simulated validation error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Default admin credentials', () => {
    it('should create admin with expected credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');

      expect(admin).not.toBeNull();
      expect(admin?.username).toBe('admin');
      expect(admin?.role).toBe('admin');
      expect(admin?.stockAccess).toEqual(['*']);
      expect(admin?.active).toBe(true);

      // Verify password hash exists
      expect(admin?.passwordHash).toBeDefined();
      expect(admin?.passwordHash).not.toBe('changeme123'); // Should be hashed
    });

    it('should allow login with default admin credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');
      expect(admin).not.toBeNull();

      // Import bcrypt to verify password
      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.compare('changeme123', admin!.passwordHash);

      expect(isValid).toBe(true);
    });
  });
});
