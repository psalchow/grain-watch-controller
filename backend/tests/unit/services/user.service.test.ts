/**
 * Unit tests for UserService.
 *
 * These tests verify user CRUD operations, password hashing,
 * and stock access permission checks.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as bcrypt from 'bcrypt';
import {
  UserService,
  UserServiceError,
  CreateUserData,
} from '../../../src/services/auth';
import { User } from '../../../src/models';

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

describe('UserService', () => {
  let service: UserService;
  let tempDir: string;
  let tempFilePath: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grainwatch-test-'));
    tempFilePath = path.join(tempDir, 'users.json');
    service = new UserService(tempFilePath);
  });

  afterEach(async () => {
    // Clean up temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadUsers', () => {
    it('should return empty array when file does not exist', async () => {
      const users = await service.loadUsers();
      expect(users).toEqual([]);
    });

    it('should load users from existing file', async () => {
      const testUsers: User[] = [
        {
          id: 'usr_001',
          username: 'testuser',
          passwordHash: '$2b$10$hashedpassword',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];

      await fs.writeFile(tempFilePath, JSON.stringify(testUsers));

      const users = await service.loadUsers();

      expect(users).toHaveLength(1);
      expect(users[0]?.username).toBe('testuser');
    });

    it('should throw error for invalid JSON', async () => {
      await fs.writeFile(tempFilePath, 'not valid json');

      await expect(service.loadUsers()).rejects.toThrow(UserServiceError);
      await expect(service.loadUsers()).rejects.toMatchObject({
        code: 'FILE_ERROR',
      });
    });

    it('should throw error for non-array JSON', async () => {
      await fs.writeFile(tempFilePath, '{"not": "an array"}');

      await expect(service.loadUsers()).rejects.toThrow(
        'Invalid users file format: expected array'
      );
    });
  });

  describe('saveUsers', () => {
    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'users.json');
      const nestedService = new UserService(nestedPath);

      const testUsers: User[] = [
        {
          id: 'usr_001',
          username: 'testuser',
          passwordHash: '$2b$10$hashedpassword',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];

      await nestedService.saveUsers(testUsers);

      const content = await fs.readFile(nestedPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].username).toBe('testuser');
    });

    it('should format JSON with indentation', async () => {
      const testUsers: User[] = [
        {
          id: 'usr_001',
          username: 'testuser',
          passwordHash: '$2b$10$hashedpassword',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];

      await service.saveUsers(testUsers);

      const content = await fs.readFile(tempFilePath, 'utf-8');

      // Check that it's formatted with newlines (not minified)
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });
  });

  describe('findUserByUsername', () => {
    beforeEach(async () => {
      const testUsers: User[] = [
        {
          id: 'usr_001',
          username: 'admin',
          passwordHash: '$2b$10$hashedpassword',
          role: 'admin',
          stockAccess: ['*'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
        {
          id: 'usr_002',
          username: 'viewer',
          passwordHash: '$2b$10$hashedpassword',
          role: 'viewer',
          stockAccess: ['corn-watch-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];

      await fs.writeFile(tempFilePath, JSON.stringify(testUsers));
    });

    it('should find existing user by username', async () => {
      const user = await service.findUserByUsername('admin');

      expect(user).not.toBeNull();
      expect(user?.id).toBe('usr_001');
      expect(user?.role).toBe('admin');
    });

    it('should return null for non-existent username', async () => {
      const user = await service.findUserByUsername('nonexistent');

      expect(user).toBeNull();
    });
  });

  describe('findUserById', () => {
    beforeEach(async () => {
      const testUsers: User[] = [
        {
          id: 'usr_001',
          username: 'admin',
          passwordHash: '$2b$10$hashedpassword',
          role: 'admin',
          stockAccess: ['*'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];

      await fs.writeFile(tempFilePath, JSON.stringify(testUsers));
    });

    it('should find existing user by ID', async () => {
      const user = await service.findUserById('usr_001');

      expect(user).not.toBeNull();
      expect(user?.username).toBe('admin');
    });

    it('should return null for non-existent ID', async () => {
      const user = await service.findUserById('usr_999');

      expect(user).toBeNull();
    });
  });

  describe('createUser', () => {
    it('should create a new user with hashed password', async () => {
      const userData: CreateUserData = {
        username: 'newuser',
        password: 'securepassword123',
        email: 'new@example.com',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      };

      const profile = await service.createUser(userData);

      expect(profile.id).toBe('usr_001');
      expect(profile.username).toBe('newuser');
      expect(profile.email).toBe('new@example.com');
      expect(profile.role).toBe('viewer');
      expect(profile.stockAccess).toEqual(['corn-watch-1']);

      // Profile should not contain password hash
      expect((profile as any).passwordHash).toBeUndefined();

      // Verify password was hashed in stored user
      const storedUser = await service.findUserByUsername('newuser');
      expect(storedUser?.passwordHash).toBeDefined();
      expect(storedUser?.passwordHash).not.toBe('securepassword123');

      // Verify password hash is valid
      const isValid = await bcrypt.compare(
        'securepassword123',
        storedUser?.passwordHash ?? ''
      );
      expect(isValid).toBe(true);
    });

    it('should generate sequential user IDs', async () => {
      await service.createUser({
        username: 'user1',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      await service.createUser({
        username: 'user2',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      const user1 = await service.findUserByUsername('user1');
      const user2 = await service.findUserByUsername('user2');

      expect(user1?.id).toBe('usr_001');
      expect(user2?.id).toBe('usr_002');
    });

    it('should throw error for empty username', async () => {
      await expect(
        service.createUser({
          username: '',
          password: 'password123',
          role: 'viewer',
          stockAccess: [],
        })
      ).rejects.toThrow('Username is required');
    });

    it('should throw error for short password', async () => {
      await expect(
        service.createUser({
          username: 'testuser',
          password: 'short',
          role: 'viewer',
          stockAccess: [],
        })
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should throw error for duplicate username', async () => {
      await service.createUser({
        username: 'existing',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      await expect(
        service.createUser({
          username: 'existing',
          password: 'password456',
          role: 'viewer',
          stockAccess: [],
        })
      ).rejects.toThrow("Username 'existing' already exists");

      await expect(
        service.createUser({
          username: 'existing',
          password: 'password456',
          role: 'viewer',
          stockAccess: [],
        })
      ).rejects.toMatchObject({ code: 'USERNAME_EXISTS' });
    });

    it('should set active to true by default', async () => {
      await service.createUser({
        username: 'newuser',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      const user = await service.findUserByUsername('newuser');
      expect(user?.active).toBe(true);
    });

    it('should set createdAt timestamp', async () => {
      const beforeCreate = new Date();

      await service.createUser({
        username: 'newuser',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      const afterCreate = new Date();
      const user = await service.findUserByUsername('newuser');

      expect(user?.createdAt).toBeDefined();

      const createdAt = new Date(user?.createdAt ?? '');
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });

  describe('updateUser', () => {
    beforeEach(async () => {
      await service.createUser({
        username: 'existinguser',
        password: 'password123',
        email: 'existing@example.com',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      });
    });

    it('should update username', async () => {
      const profile = await service.updateUser('usr_001', {
        username: 'updateduser',
      });

      expect(profile.username).toBe('updateduser');

      const user = await service.findUserById('usr_001');
      expect(user?.username).toBe('updateduser');
    });

    it('should update email', async () => {
      const profile = await service.updateUser('usr_001', {
        email: 'updated@example.com',
      });

      expect(profile.email).toBe('updated@example.com');
    });

    it('should update role', async () => {
      const profile = await service.updateUser('usr_001', {
        role: 'admin',
      });

      expect(profile.role).toBe('admin');
    });

    it('should update stockAccess', async () => {
      const profile = await service.updateUser('usr_001', {
        stockAccess: ['corn-watch-1', 'corn-watch-2'],
      });

      expect(profile.stockAccess).toEqual(['corn-watch-1', 'corn-watch-2']);
    });

    it('should update password with new hash', async () => {
      const userBefore = await service.findUserById('usr_001');
      const oldHash = userBefore?.passwordHash;

      await service.updateUser('usr_001', {
        password: 'newpassword456',
      });

      const userAfter = await service.findUserById('usr_001');

      expect(userAfter?.passwordHash).not.toBe(oldHash);

      const isValid = await bcrypt.compare(
        'newpassword456',
        userAfter?.passwordHash ?? ''
      );
      expect(isValid).toBe(true);
    });

    it('should update active status', async () => {
      await service.updateUser('usr_001', { active: false });

      const user = await service.findUserById('usr_001');
      expect(user?.active).toBe(false);
    });

    it('should throw error for non-existent user', async () => {
      await expect(
        service.updateUser('usr_999', { username: 'newname' })
      ).rejects.toThrow("User with ID 'usr_999' not found");

      await expect(
        service.updateUser('usr_999', { username: 'newname' })
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });

    it('should throw error for duplicate username', async () => {
      await service.createUser({
        username: 'otheruser',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      await expect(
        service.updateUser('usr_001', { username: 'otheruser' })
      ).rejects.toThrow("Username 'otheruser' already exists");
    });

    it('should throw error for short password', async () => {
      await expect(
        service.updateUser('usr_001', { password: 'short' })
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should allow keeping the same username', async () => {
      const profile = await service.updateUser('usr_001', {
        username: 'existinguser',
        email: 'newemail@example.com',
      });

      expect(profile.username).toBe('existinguser');
      expect(profile.email).toBe('newemail@example.com');
    });
  });

  describe('deleteUser', () => {
    beforeEach(async () => {
      await service.createUser({
        username: 'userToDelete',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });
    });

    it('should delete existing user', async () => {
      const result = await service.deleteUser('usr_001');

      expect(result).toBe(true);

      const user = await service.findUserById('usr_001');
      expect(user).toBeNull();
    });

    it('should throw error for non-existent user', async () => {
      await expect(service.deleteUser('usr_999')).rejects.toThrow(
        "User with ID 'usr_999' not found"
      );

      await expect(service.deleteUser('usr_999')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });
  });

  describe('canAccessStock', () => {
    it('should return true for wildcard access', () => {
      const user: User = {
        id: 'usr_001',
        username: 'admin',
        passwordHash: 'hash',
        role: 'admin',
        stockAccess: ['*'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      expect(service.canAccessStock(user, 'corn-watch-1')).toBe(true);
      expect(service.canAccessStock(user, 'corn-watch-2')).toBe(true);
      expect(service.canAccessStock(user, 'any-stock')).toBe(true);
    });

    it('should return true for stock in access list', () => {
      const user: User = {
        id: 'usr_001',
        username: 'viewer',
        passwordHash: 'hash',
        role: 'viewer',
        stockAccess: ['corn-watch-1', 'corn-watch-2'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      expect(service.canAccessStock(user, 'corn-watch-1')).toBe(true);
      expect(service.canAccessStock(user, 'corn-watch-2')).toBe(true);
    });

    it('should return false for stock not in access list', () => {
      const user: User = {
        id: 'usr_001',
        username: 'viewer',
        passwordHash: 'hash',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      expect(service.canAccessStock(user, 'corn-watch-2')).toBe(false);
      expect(service.canAccessStock(user, 'other-stock')).toBe(false);
    });

    it('should return false for empty access list', () => {
      const user: User = {
        id: 'usr_001',
        username: 'viewer',
        passwordHash: 'hash',
        role: 'viewer',
        stockAccess: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      expect(service.canAccessStock(user, 'corn-watch-1')).toBe(false);
    });

    it('should work with UserProfile as well', () => {
      const profile = {
        id: 'usr_001',
        username: 'viewer',
        role: 'viewer' as const,
        stockAccess: ['corn-watch-1'],
      };

      expect(service.canAccessStock(profile, 'corn-watch-1')).toBe(true);
      expect(service.canAccessStock(profile, 'corn-watch-2')).toBe(false);
    });
  });

  describe('initializeDefaultUsers', () => {
    it('should create admin user when no users exist', async () => {
      const profile = await service.initializeDefaultUsers();

      expect(profile).not.toBeNull();
      expect(profile?.username).toBe('admin');
      expect(profile?.role).toBe('admin');
      expect(profile?.stockAccess).toEqual(['*']);

      // Verify password is correct
      const user = await service.findUserByUsername('admin');
      const isValid = await bcrypt.compare(
        'changeme123',
        user?.passwordHash ?? ''
      );
      expect(isValid).toBe(true);
    });

    it('should return null when users already exist', async () => {
      await service.createUser({
        username: 'existinguser',
        password: 'password123',
        role: 'viewer',
        stockAccess: [],
      });

      const profile = await service.initializeDefaultUsers();

      expect(profile).toBeNull();

      // Verify no admin was created
      const admin = await service.findUserByUsername('admin');
      expect(admin).toBeNull();
    });
  });

  describe('getAllUsers', () => {
    beforeEach(async () => {
      await service.createUser({
        username: 'user1',
        password: 'password123',
        role: 'admin',
        stockAccess: ['*'],
      });

      await service.createUser({
        username: 'user2',
        password: 'password456',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
      });
    });

    it('should return all users as profiles', async () => {
      const profiles = await service.getAllUsers();

      expect(profiles).toHaveLength(2);
      expect(profiles[0]?.username).toBe('user1');
      expect(profiles[1]?.username).toBe('user2');
    });

    it('should not include password hashes', async () => {
      const profiles = await service.getAllUsers();

      for (const profile of profiles) {
        expect((profile as any).passwordHash).toBeUndefined();
      }
    });
  });

  describe('toUserProfile', () => {
    it('should convert User to UserProfile', () => {
      const user: User = {
        id: 'usr_001',
        username: 'testuser',
        passwordHash: '$2b$10$secrethash',
        email: 'test@example.com',
        role: 'viewer',
        stockAccess: ['corn-watch-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        active: true,
      };

      const profile = service.toUserProfile(user);

      expect(profile.id).toBe('usr_001');
      expect(profile.username).toBe('testuser');
      expect(profile.email).toBe('test@example.com');
      expect(profile.role).toBe('viewer');
      expect(profile.stockAccess).toEqual(['corn-watch-1']);

      // These should not be in profile
      expect((profile as any).passwordHash).toBeUndefined();
      expect((profile as any).createdAt).toBeUndefined();
      expect((profile as any).active).toBeUndefined();
    });
  });

  describe('clearCache', () => {
    it('should clear the internal cache', async () => {
      // Load users to populate cache
      await service.loadUsers();

      // Clear cache
      service.clearCache();

      // Modify file directly
      const testUsers: User[] = [
        {
          id: 'usr_999',
          username: 'directwrite',
          passwordHash: 'hash',
          role: 'admin',
          stockAccess: ['*'],
          createdAt: '2026-01-01T00:00:00.000Z',
          active: true,
        },
      ];
      await fs.writeFile(tempFilePath, JSON.stringify(testUsers));

      // Load should now read from file, not cache
      const users = await service.loadUsers();

      expect(users).toHaveLength(1);
      expect(users[0]?.username).toBe('directwrite');
    });
  });
});
