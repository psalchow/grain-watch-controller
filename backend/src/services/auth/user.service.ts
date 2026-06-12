/**
 * User management service for the grainwatch-controller BFF.
 *
 * Handles user CRUD operations, password hashing, and stock access
 * permission checks. User data is persisted via the {@link UserRepository}
 * (SQLite-backed via Drizzle ORM).
 */

import * as bcrypt from 'bcrypt';
import { UserRepository } from '../../db/repositories';
import { User, UserProfile, UserRole } from '../../models';

/**
 * Error thrown when a user operation fails.
 */
export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'USER_NOT_FOUND'
      | 'USERNAME_EXISTS'
      | 'INVALID_INPUT'
      | 'DB_ERROR'
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

/**
 * Data required to create a new user.
 */
export interface CreateUserData {
  /** Login username (must be unique) */
  username: string;

  /** Plain text password (will be hashed) */
  password: string;

  /** User email address (optional) */
  email?: string;

  /** User role */
  role: UserRole;

  /** Stock IDs the user can access (use ['*'] for all stocks) */
  stockAccess: string[];
}

/**
 * Partial user data for updates.
 */
export interface UpdateUserData {
  /** New username (optional) */
  username?: string;

  /** New plain text password (optional, will be hashed) */
  password?: string;

  /** New email address (optional) */
  email?: string;

  /** New role (optional) */
  role?: UserRole;

  /** New stock access list (optional) */
  stockAccess?: string[];

  /** Account active status (optional) */
  active?: boolean;
}

/** Salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Service for managing user data backed by a {@link UserRepository}.
 *
 * Provides methods for user CRUD operations and authorisation checks.
 */
export class UserService {
  /**
   * Creates a new UserService instance.
   *
   * @param repo - UserRepository used for persistence
   */
  constructor(private readonly repo: UserRepository) {}

  /**
   * Finds a user by username.
   *
   * @param username - Username to search for
   * @returns User object or null if not found
   */
  async findUserByUsername(username: string): Promise<User | null> {
    return this.repo.findByUsername(username);
  }

  /**
   * Finds a user by ID.
   *
   * @param id - User ID to search for
   * @returns User object or null if not found
   */
  async findUserById(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  /**
   * Returns the total number of users in the system.
   *
   * Cheaper than loading all users when only the count is needed
   * (e.g. bootstrap validation).
   */
  async countUsers(): Promise<number> {
    return this.repo.count();
  }

  /**
   * Returns full user records (including passwordHash, active, createdAt).
   *
   * @returns Array of full user objects
   */
  async listFullUsers(): Promise<User[]> {
    return this.repo.findAll();
  }

  /**
   * Creates a new user with a hashed password.
   *
   * @param data - User data including plain text password
   * @returns The created user profile (without password hash)
   * @throws UserServiceError if username already exists or input is invalid
   */
  async createUser(data: CreateUserData): Promise<UserProfile> {
    if (!data.username || data.username.trim().length === 0) {
      throw new UserServiceError('Username is required', 'INVALID_INPUT');
    }
    if (!data.password || data.password.length < 8) {
      throw new UserServiceError(
        'Password must be at least 8 characters',
        'INVALID_INPUT'
      );
    }

    const existing = await this.repo.findByUsername(data.username);
    if (existing) {
      throw new UserServiceError(
        `Username '${data.username}' already exists`,
        'USERNAME_EXISTS'
      );
    }

    const id = await this.generateUserId();
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    const user: User = {
      id,
      username: data.username.trim(),
      passwordHash,
      role: data.role,
      stockAccess: data.stockAccess,
      createdAt: new Date().toISOString(),
      active: true,
    };
    const trimmedEmail = data.email?.trim();
    if (trimmedEmail !== undefined && trimmedEmail.length > 0) {
      user.email = trimmedEmail;
    }

    await this.repo.insert(user);
    return this.toUserProfile(user);
  }

  /**
   * Updates an existing user.
   *
   * @param id - User ID to update
   * @param updates - Partial user data to update
   * @returns Updated user profile
   * @throws UserServiceError if user not found or username already exists
   */
  async updateUser(id: string, updates: UpdateUserData): Promise<UserProfile> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new UserServiceError(
        `User with ID '${id}' not found`,
        'USER_NOT_FOUND'
      );
    }

    if (updates.username && updates.username !== existing.username) {
      const duplicate = await this.repo.findByUsername(updates.username);
      if (duplicate) {
        throw new UserServiceError(
          `Username '${updates.username}' already exists`,
          'USERNAME_EXISTS'
        );
      }
    }

    if (updates.password !== undefined && updates.password.length < 8) {
      throw new UserServiceError(
        'Password must be at least 8 characters',
        'INVALID_INPUT'
      );
    }

    const patch: Parameters<UserRepository['update']>[1] = {};
    if (updates.username !== undefined) patch.username = updates.username.trim();
    if (updates.role !== undefined) patch.role = updates.role;
    if (updates.active !== undefined) patch.active = updates.active;
    if (updates.stockAccess !== undefined) patch.stockAccess = updates.stockAccess;
    if (updates.password) {
      patch.passwordHash = await bcrypt.hash(updates.password, BCRYPT_SALT_ROUNDS);
    }
    if (updates.email !== undefined) {
      const trimmed = updates.email.trim();
      patch.email = trimmed.length > 0 ? trimmed : null;
    }

    await this.repo.update(id, patch);

    const updated = await this.repo.findById(id);
    if (!updated) {
      throw new UserServiceError('User disappeared after update', 'DB_ERROR');
    }
    return this.toUserProfile(updated);
  }

  /**
   * Deletes a user by ID.
   *
   * @param id - User ID to delete
   * @returns True if user was deleted
   * @throws UserServiceError if user not found
   */
  async deleteUser(id: string): Promise<boolean> {
    const existed = await this.repo.delete(id);
    if (!existed) {
      throw new UserServiceError(
        `User with ID '${id}' not found`,
        'USER_NOT_FOUND'
      );
    }
    return true;
  }

  /**
   * Checks if a user can access a specific grain stock.
   *
   * @param user - User object to check
   * @param stockId - Stock ID to check access for
   * @returns True if user has access to the stock
   */
  canAccessStock(user: User | UserProfile, stockId: string): boolean {
    if (user.stockAccess.includes('*')) return true;
    return user.stockAccess.includes(stockId);
  }

  /**
   * Initialises default admin user if no users exist.
   *
   * Creates an admin user with:
   * - Username: 'admin'
   * - Password: 'changeme123' (should be changed immediately)
   * - Full stock access
   *
   * @returns The created admin profile, or null if users already exist
   */
  async initializeDefaultUsers(): Promise<UserProfile | null> {
    const existing = await this.repo.findAll();
    if (existing.length > 0) return null;
    return this.createUser({
      username: 'admin',
      password: 'changeme123',
      role: 'admin',
      stockAccess: ['*'],
    });
  }

  /**
   * Converts a User to a UserProfile (removes sensitive data).
   *
   * @param user - Full user object
   * @returns User profile without password hash
   */
  toUserProfile(user: User): UserProfile {
    const profile: UserProfile = {
      id: user.id,
      username: user.username,
      role: user.role,
      stockAccess: user.stockAccess,
    };
    if (user.email !== undefined) profile.email = user.email;
    return profile;
  }

  /**
   * Generates a unique user ID in format 'usr_XXX'.
   */
  private async generateUserId(): Promise<string> {
    const existing = await this.repo.findAll();
    const numbers = existing
      .map((u) => {
        const match = u.id.match(/^usr_(\d+)$/);
        const numStr = match?.[1];
        return numStr !== undefined ? parseInt(numStr, 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
    return `usr_${String(next).padStart(3, '0')}`;
  }
}
