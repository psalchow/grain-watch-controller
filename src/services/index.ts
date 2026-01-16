/**
 * Service instance exports for the grainwatch-controller BFF.
 *
 * Provides singleton service instances for use across the application.
 * These instances are initialised once and reused to ensure consistent
 * state and efficient resource usage.
 */

import { InfluxDBService } from './influx';
import { UserService, AuthService } from './auth';

/**
 * Singleton InfluxDB service instance.
 *
 * Used for querying grain stock sensor data from InfluxDB.
 */
export const influxService = new InfluxDBService();

/**
 * Singleton user service instance.
 *
 * Used for user management operations including CRUD and permission checks.
 */
export const userService = new UserService();

/**
 * Singleton authentication service instance.
 *
 * Uses the shared userService instance for consistent user data access.
 * Provides JWT token generation, verification, and login operations.
 */
export const authService = new AuthService(userService);

// Re-export service classes and types for direct imports
export { InfluxDBService } from './influx';
export { UserService, AuthService, UserServiceError, AuthenticationError } from './auth';
export type {
  CreateUserData,
  UpdateUserData,
  LoginResult,
  DecodedToken,
} from './auth';
export type {
  DeviceReading,
  TimeSeriesPoint,
  SummaryStats,
  BatteryStatus,
  WindowDuration,
} from './influx';
export { isValidWindowDuration } from './influx';
