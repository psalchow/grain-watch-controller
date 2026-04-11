/**
 * User management service for the grainwatch-controller BFF.
 *
 * Handles user CRUD operations, password hashing, and stock access
 * permission checks. User data is persisted to a JSON file.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { config } from '../../config';
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
      | 'FILE_ERROR'
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
 * Service for managing user data stored in a JSON file.
 *
 * Provides methods for user CRUD operations and authorisation checks.
 * All file operations are asynchronous to ensure thread safety.
 */
export class UserService {
  private readonly filePath: string;
  private usersCache: User[] | null = null;

  /**
   * Creates a new UserService instance.
   *
   * @param customFilePath - Optional custom path to users file (defaults to config value)
   */
  constructor(customFilePath?: string) {
    this.filePath = customFilePath ?? config.usersFilePath;
  }

  /**
   * Resolves the absolute path to the users file.
   *
   * @returns Absolute path to the users JSON file
   */
  private getAbsolutePath(): string {
    if (path.isAbsolute(this.filePath)) {
      return this.filePath;
    }
    return path.resolve(process.cwd(), this.filePath);
  }

  /**
   * Ensures the data directory exists.
   *
   * @throws UserServiceError if directory creation fails
   */
  private async ensureDirectoryExists(): Promise<void> {
    const absolutePath = this.getAbsolutePath();
    const directory = path.dirname(absolutePath);

    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new UserServiceError(
        `Failed to create data directory: ${message}`,
        'FILE_ERROR'
      );
    }
  }

  /**
   * Loads users from the JSON file.
   *
   * Returns cached users if available, otherwise reads from file.
   * Creates an empty users array if the file does not exist.
   *
   * @returns Array of user objects
   * @throws UserServiceError if file reading fails
   */
  async loadUsers(): Promise<User[]> {
    // Return cached users if available
    if (this.usersCache !== null) {
      return this.usersCache;
    }

    const absolutePath = this.getAbsolutePath();

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        throw new UserServiceError(
          'Invalid users file format: expected array',
          'FILE_ERROR'
        );
      }

      this.usersCache = parsed as User[];
      return this.usersCache;
    } catch (error) {
      // If file doesn't exist, return empty array
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.usersCache = [];
        return [];
      }

      // If JSON parsing failed
      if (error instanceof SyntaxError) {
        throw new UserServiceError(
          `Invalid JSON in users file: ${error.message}`,
          'FILE_ERROR'
        );
      }

      // Re-throw UserServiceError
      if (error instanceof UserServiceError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new UserServiceError(
        `Failed to read users file: ${message}`,
        'FILE_ERROR'
      );
    }
  }

  /**
   * Saves users to the JSON file.
   *
   * @param users - Array of users to save
   * @throws UserServiceError if file writing fails
   */
  async saveUsers(users: User[]): Promise<void> {
    await this.ensureDirectoryExists();

    const absolutePath = this.getAbsolutePath();

    try {
      const content = JSON.stringify(users, null, 2);
      await fs.writeFile(absolutePath, content, 'utf-8');
      this.usersCache = users;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new UserServiceError(
        `Failed to write users file: ${message}`,
        'FILE_ERROR'
      );
    }
  }

  /**
   * Finds a user by username.
   *
   * @param username - Username to search for
   * @returns User object or null if not found
   */
  async findUserByUsername(username: string): Promise<User | null> {
    const users = await this.loadUsers();
    return users.find((user) => user.username === username) ?? null;
  }

  /**
   * Finds a user by ID.
   *
   * @param id - User ID to search for
   * @returns User object or null if not found
   */
  async findUserById(id: string): Promise<User | null> {
    const users = await this.loadUsers();
    return users.find((user) => user.id === id) ?? null;
  }

  /**
   * Creates a new user with a hashed password.
   *
   * @param userData - User data including plain text password
   * @returns The created user profile (without password hash)
   * @throws UserServiceError if username already exists or input is invalid
   */
  async createUser(userData: CreateUserData): Promise<UserProfile> {
    // Validate input
    if (!userData.username || userData.username.trim().length === 0) {
      throw new UserServiceError('Username is required', 'INVALID_INPUT');
    }

    if (!userData.password || userData.password.length < 8) {
      throw new UserServiceError(
        'Password must be at least 8 characters',
        'INVALID_INPUT'
      );
    }

    const users = await this.loadUsers();

    // Check for duplicate username
    const existingUser = users.find(
      (user) => user.username === userData.username
    );
    if (existingUser) {
      throw new UserServiceError(
        `Username '${userData.username}' already exists`,
        'USERNAME_EXISTS'
      );
    }

    // Generate unique ID
    const id = this.generateUserId(users);

    // Hash password
    const passwordHash = await bcrypt.hash(
      userData.password,
      BCRYPT_SALT_ROUNDS
    );

    // Build user object, conditionally adding email only if provided
    const newUser: User = {
      id,
      username: userData.username.trim(),
      passwordHash,
      role: userData.role,
      stockAccess: userData.stockAccess,
      createdAt: new Date().toISOString(),
      active: true,
    };

    // Only add email if it's provided (exactOptionalPropertyTypes compliance)
    const trimmedEmail = userData.email?.trim();
    if (trimmedEmail !== undefined) {
      newUser.email = trimmedEmail;
    }

    users.push(newUser);
    await this.saveUsers(users);

    return this.toUserProfile(newUser);
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
    const users = await this.loadUsers();
    const userIndex = users.findIndex((user) => user.id === id);

    if (userIndex === -1) {
      throw new UserServiceError(
        `User with ID '${id}' not found`,
        'USER_NOT_FOUND'
      );
    }

    const existingUser = users[userIndex] as User;

    // Check for duplicate username if updating
    if (updates.username && updates.username !== existingUser.username) {
      const duplicate = users.find(
        (user) => user.username === updates.username
      );
      if (duplicate) {
        throw new UserServiceError(
          `Username '${updates.username}' already exists`,
          'USERNAME_EXISTS'
        );
      }
    }

    // Validate password if provided
    if (updates.password !== undefined && updates.password.length < 8) {
      throw new UserServiceError(
        'Password must be at least 8 characters',
        'INVALID_INPUT'
      );
    }

    // Build updated user
    const updatedUser: User = {
      ...existingUser,
      username: updates.username?.trim() ?? existingUser.username,
      role: updates.role ?? existingUser.role,
      stockAccess: updates.stockAccess ?? existingUser.stockAccess,
      active: updates.active ?? existingUser.active,
    };

    // Handle email update (exactOptionalPropertyTypes compliance)
    if (updates.email !== undefined) {
      const trimmedEmail = updates.email.trim();
      if (trimmedEmail.length > 0) {
        updatedUser.email = trimmedEmail;
      } else {
        delete updatedUser.email;
      }
    }

    // Hash new password if provided
    if (updates.password) {
      updatedUser.passwordHash = await bcrypt.hash(
        updates.password,
        BCRYPT_SALT_ROUNDS
      );
    }

    users[userIndex] = updatedUser;
    await this.saveUsers(users);

    return this.toUserProfile(updatedUser);
  }

  /**
   * Deletes a user by ID.
   *
   * @param id - User ID to delete
   * @returns True if user was deleted
   * @throws UserServiceError if user not found
   */
  async deleteUser(id: string): Promise<boolean> {
    const users = await this.loadUsers();
    const userIndex = users.findIndex((user) => user.id === id);

    if (userIndex === -1) {
      throw new UserServiceError(
        `User with ID '${id}' not found`,
        'USER_NOT_FOUND'
      );
    }

    users.splice(userIndex, 1);
    await this.saveUsers(users);

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
    // Admin users with wildcard access can access all stocks
    if (user.stockAccess.includes('*')) {
      return true;
    }

    // Check if stock is in user's access list
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
    const users = await this.loadUsers();

    if (users.length > 0) {
      return null;
    }

    const adminProfile = await this.createUser({
      username: 'admin',
      password: 'changeme123',
      role: 'admin',
      stockAccess: ['*'],
    });

    return adminProfile;
  }

  /**
   * Gets all users as profiles (without password hashes).
   *
   * @returns Array of user profiles
   */
  async getAllUsers(): Promise<UserProfile[]> {
    const users = await this.loadUsers();
    return users.map((user) => this.toUserProfile(user));
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

    // Only add email if present (exactOptionalPropertyTypes compliance)
    if (user.email !== undefined) {
      profile.email = user.email;
    }

    return profile;
  }

  /**
   * Generates a unique user ID.
   *
   * @param existingUsers - Array of existing users
   * @returns Unique user ID in format 'usr_XXX'
   */
  private generateUserId(existingUsers: User[]): string {
    // Extract numeric parts from existing IDs
    const existingNumbers = existingUsers
      .map((user) => {
        const match = user.id.match(/^usr_(\d+)$/);
        const numStr = match?.[1];
        return numStr !== undefined ? parseInt(numStr, 10) : 0;
      })
      .filter((num) => !isNaN(num));

    // Find next available number
    const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const nextNumber = maxNumber + 1;

    return `usr_${String(nextNumber).padStart(3, '0')}`;
  }

  /**
   * Clears the internal users cache.
   * Useful for testing or forcing a reload from disk.
   */
  clearCache(): void {
    this.usersCache = null;
  }
}
