/**
 * Application bootstrap module.
 *
 * Handles initialisation tasks that must run before the application starts
 * accepting requests, such as creating default users.
 */

import { userService } from './services';
import { config } from './config';

/**
 * Bootstrap result containing information about initialisation tasks.
 */
interface BootstrapResult {
  /** Whether default users were initialised */
  defaultUsersCreated: boolean;

  /** Username of the default admin user if created */
  defaultAdminUsername?: string;
}

/**
 * Initialises the application by running startup tasks.
 *
 * This function should be called once during application startup, before
 * the server begins accepting requests. It ensures that:
 *
 * - A default admin user exists (creates one if no users exist)
 * - The application is ready to handle authentication requests
 *
 * The function is idempotent - it can be called multiple times safely.
 * If users already exist, no changes are made.
 *
 * Default admin credentials (created only if no users exist):
 * - Username: 'admin'
 * - Password: 'changeme123'
 * - Role: admin
 * - Stock Access: all stocks (*)
 *
 * @returns Bootstrap result with information about what was initialised
 * @throws Error if initialisation fails critically
 *
 * @example
 * // During application startup
 * await bootstrapApplication();
 * // Application is now ready to accept requests
 */
export async function bootstrapApplication(): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    defaultUsersCreated: false,
  };

  try {
    // Initialise default users if none exist
    const adminProfile = await userService.initializeDefaultUsers();

    if (adminProfile !== null) {
      result.defaultUsersCreated = true;
      result.defaultAdminUsername = adminProfile.username;

      // Log the creation of default admin user
      const environment = config.nodeEnv;
      console.log('\n========================================');
      console.log('Default Admin User Created');
      console.log('========================================');
      console.log(`Environment: ${environment}`);
      console.log(`Username: ${adminProfile.username}`);
      console.log('Password: changeme123');
      console.log('========================================');
      console.log('IMPORTANT: Change the default password immediately!');
      console.log('========================================\n');
    } else {
      // Users already exist, no action needed
      console.log('User bootstrap: Users already exist, skipping default user creation');
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to bootstrap application:', message);

    // In production, we might want to fail fast if bootstrap fails
    if (config.nodeEnv === 'production') {
      throw new Error(`Bootstrap failed: ${message}`);
    }

    // In development, we log and continue
    console.warn('Continuing despite bootstrap failure (development mode)');
    return result;
  }
}

/**
 * Validates that the application is properly bootstrapped.
 *
 * Checks that at least one user exists in the system. This can be used
 * as a health check or during application startup verification.
 *
 * @returns True if at least one user exists
 */
export async function validateBootstrap(): Promise<boolean> {
  try {
    const users = await userService.getAllUsers();
    return users.length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Bootstrap validation failed:', message);
    return false;
  }
}
