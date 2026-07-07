/**
 * Application configuration module.
 *
 * Provides typed configuration derived from environment variables with
 * validation and sensible defaults for development.
 */

/**
 * InfluxDB connection configuration.
 */
interface InfluxDBConfig {
  /** InfluxDB URL (e.g., 'http://localhost:8086') */
  url: string;

  /** Authentication token */
  token: string;

  /** Organization name */
  org: string;

  /** Bucket name */
  bucket: string;

  /** Measurement name for sensor data */
  measurement: string;
}

/**
 * JWT authentication configuration.
 */
interface JWTConfig {
  /** Secret key for signing access tokens */
  secret: string;

  /** Access token expiry duration (e.g., '15m', '1h') */
  expiresIn: string;

  /** Secret key for signing refresh tokens (must differ from `secret`) */
  refreshSecret: string;

  /** Refresh token expiry duration (e.g., '30d') */
  refreshExpiresIn: string;
}

/**
 * Refresh-token cookie configuration.
 */
interface CookieConfig {
  /** Whether the refresh cookie requires HTTPS (Secure attribute) */
  secure: boolean;

  /** SameSite attribute for the refresh cookie */
  sameSite: 'lax' | 'strict' | 'none';
}

/**
 * Database configuration.
 */
interface DatabaseConfig {
  /** Absolute or relative path to the SQLite file, or ':memory:' for tests. */
  path: string;
}

/**
 * Complete application configuration.
 */
interface Config {
  /** HTTP server port */
  port: number;

  /** Node environment (development, production, test) */
  nodeEnv: string;

  /** JWT authentication settings */
  jwt: JWTConfig;

  /** Refresh-token cookie settings */
  cookie: CookieConfig;

  /** InfluxDB connection settings */
  influxdb: InfluxDBConfig;

  /** Database connection settings */
  database: DatabaseConfig;
}

/**
 * Retrieves an environment variable with an optional default value.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 * @throws Error if required variable is not set and no default provided
 */
function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Retrieves an environment variable as an integer with an optional default value.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The parsed integer value
 * @throws Error if required variable is not set and no default provided
 * @throws Error if value cannot be parsed as an integer
 */
function getEnvVarAsInt(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer`);
  }
  return parsed;
}


/**
 * Retrieves an environment variable as a boolean with a default value.
 *
 * Accepts 'true'/'1' as true and 'false'/'0' as false (case-insensitive).
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The parsed boolean value
 */
function getEnvVarAsBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value === 'true' || value === '1';
}

/**
 * Validates the configuration and throws descriptive errors for invalid settings.
 *
 * @param cfg - Configuration object to validate
 * @throws Error if configuration is invalid
 */
function validateConfig(cfg: Config): void {
  const errors: string[] = [];

  // Validate JWT secret in production
  if (cfg.nodeEnv === 'production') {
    if (cfg.jwt.secret === 'development-secret-change-in-production') {
      errors.push('JWT_SECRET must be set in production environment');
    }
    if (cfg.jwt.secret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (
      cfg.jwt.refreshSecret === 'development-refresh-secret-change-in-production'
    ) {
      errors.push('JWT_REFRESH_SECRET must be set in production environment');
    }
    if (cfg.jwt.refreshSecret.length < 32) {
      errors.push(
        'JWT_REFRESH_SECRET must be at least 32 characters in production'
      );
    }
    if (cfg.jwt.refreshSecret === cfg.jwt.secret) {
      errors.push('JWT_REFRESH_SECRET must be different from JWT_SECRET');
    }
  }

  // Validate port range
  if (cfg.port < 1 || cfg.port > 65535) {
    errors.push(`PORT must be between 1 and 65535, got: ${cfg.port}`);
  }

  // Validate InfluxDB URL format
  try {
    new URL(cfg.influxdb.url);
  } catch {
    errors.push(`INFLUXDB_URL must be a valid URL, got: ${cfg.influxdb.url}`);
  }

  // Validate JWT expiry format (basic check)
  const expiryPattern = /^\d+[smhdw]$/;
  if (!expiryPattern.test(cfg.jwt.expiresIn)) {
    errors.push(
      `JWT_EXPIRES_IN must be a valid duration (e.g., '24h', '7d'), got: ${cfg.jwt.expiresIn}`
    );
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Application configuration object.
 *
 * All values are derived from environment variables with sensible defaults
 * for development. Production environments should set all required variables.
 *
 * @example
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - NODE_ENV: Environment name (default: 'development')
 * - JWT_SECRET: Secret for signing JWTs (required in production)
 * - JWT_EXPIRES_IN: Token expiry duration (default: '24h')
 * - INFLUXDB_URL: InfluxDB URL (default: 'http://localhost:8086')
 * - INFLUXDB_TOKEN: Authentication token (required)
 * - INFLUXDB_ORG: Organization name (default: 'grainwatch')
 * - INFLUXDB_BUCKET: Bucket name (default: 'grainwatch')
 * - INFLUXDB_MEASUREMENT: Measurement name (default: 'Temp')
 * - DATABASE_PATH: Path to SQLite database file (default: './data/grainwatch.db')
 */
export const config: Config = {
  port: getEnvVarAsInt('PORT', 3000),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  jwt: {
    secret: getEnvVar('JWT_SECRET', 'development-secret-change-in-production'),
    expiresIn: getEnvVar('JWT_EXPIRES_IN', '15m'),
    refreshSecret: getEnvVar(
      'JWT_REFRESH_SECRET',
      'development-refresh-secret-change-in-production'
    ),
    refreshExpiresIn: getEnvVar('JWT_REFRESH_EXPIRES_IN', '30d'),
  },
  cookie: {
    secure: getEnvVarAsBool(
      'COOKIE_SECURE',
      getEnvVar('NODE_ENV', 'development') === 'production'
    ),
    sameSite: getEnvVar('COOKIE_SAMESITE', 'lax') as CookieConfig['sameSite'],
  },
  influxdb: {
    url: getEnvVar('INFLUXDB_URL', 'http://localhost:8086'),
    token: getEnvVar('INFLUXDB_TOKEN', ''),
    org: getEnvVar('INFLUXDB_ORG', 'grainwatch'),
    bucket: getEnvVar('INFLUXDB_BUCKET', 'grainwatch'),
    measurement: getEnvVar('INFLUXDB_MEASUREMENT', 'Temp'),
  },
  database: {
    path: getEnvVar('DATABASE_PATH', './data/grainwatch.db'),
  },
};

// Validate configuration on module load (skip in test environment for flexibility)
if (process.env['NODE_ENV'] !== 'test') {
  validateConfig(config);
}

export type { Config, InfluxDBConfig, JWTConfig, CookieConfig, DatabaseConfig };
