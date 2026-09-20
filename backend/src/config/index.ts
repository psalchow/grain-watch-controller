/**
 * Application configuration module.
 *
 * Provides typed configuration derived from environment variables with
 * validation and sensible defaults for development.
 */

import { parseDurationMs } from '../utils/duration';

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

  /** Measurement name for outdoor temperature data */
  outdoorTemperatureMeasurement: string;

  /** Measurement name for outdoor humidity data */
  outdoorHumidityMeasurement: string;

  /**
   * Look-back window for every "latest value" query (sensor readings and
   * outdoor conditions) as an InfluxQL duration (e.g. '6h', '26w'). Readings
   * older than this window are reported as absent. Short in production, long
   * in development.
   */
  latestLookback: string;

  /**
   * Age at which a reading is shown as offline while still being returned, as
   * an InfluxQL duration (e.g. '1h'). Must not exceed `latestLookback`: a
   * reading is first flagged offline, then drops out of the look-back window.
   */
  offlineAfter: string;

  /**
   * How far the outdoor temperature and humidity timestamps may lie apart and
   * still be combined into dew point and absolute humidity, as an InfluxQL
   * duration. Both are published on change and at least every 15 minutes, so
   * the default keeps twice that as headroom: a threshold sitting on the
   * publish period would blank the derived values on ordinary jitter.
   */
  outdoorMaxSkew: string;
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

/** MQTT broker connection configuration (backend-wide). */
interface MqttConfig {
  /** Broker URL, e.g. 'mqtt://host:1883' or 'mqtts://host:8883' */
  url: string;
  /** Broker username (optional) */
  username?: string;
  /** Broker password (optional) */
  password?: string;
}

/** Fan-control timing configuration. */
interface FanConfig {
  /** Interval to re-assert the desired ON state (ms). Must be < Shelly Auto OFF (1 h). */
  keepAliveMs: number;
  /** Time to wait for a Shelly success after an ON command before switching off (ms). */
  watchdogMs: number;
  /** Days to retain fan_events rows. */
  retentionDays: number;
  /** Interval of the retention sweep (ms). */
  retentionSweepMs: number;
  /** Interval at which the stock rows are re-read to catch revoked fan control (ms). */
  reconcileIntervalMs: number;
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

  /** MQTT broker settings */
  mqtt: MqttConfig;

  /** Fan-control timing settings */
  fan: FanConfig;
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
 * Returns the shorter of two InfluxQL durations.
 *
 * Used to keep an unset offline threshold inside a look-back window the
 * operator shortened: tightening one variable must not fail the boot over the
 * default of another they never touched.
 *
 * @param value - Preferred duration
 * @param ceiling - Upper bound
 * @returns `ceiling` when it is shorter than `value`, otherwise `value`
 */
function clampDuration(value: string, ceiling: string): string {
  const valueMs = parseDurationMs(value);
  const ceilingMs = parseDurationMs(ceiling);
  if (valueMs === null || ceilingMs === null) return value;
  return ceilingMs < valueMs ? ceiling : value;
}

/**
 * Validates the configuration and throws descriptive errors for invalid settings.
 *
 * @param cfg - Configuration object to validate
 * @param env - Environment to check for retired variable names
 * @throws Error if configuration is invalid
 */
function validateConfig(
  cfg: Config,
  env: Record<string, string | undefined> = process.env
): void {
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

  // Validate MQTT URL format
  try {
    new URL(cfg.mqtt.url);
  } catch {
    errors.push(`MQTT_URL must be a valid URL, got: ${cfg.mqtt.url}`);
  }
  if (cfg.fan.keepAliveMs >= 3600000) {
    errors.push('FAN_KEEPALIVE_INTERVAL_MS must be under 3600000 (Shelly Auto OFF is 1 h)');
  }
  // Every tick reads the stock table, so a value meant as seconds would turn
  // into dozens of full-table reads per second.
  if (cfg.fan.reconcileIntervalMs < 1000) {
    errors.push(
      `FAN_RECONCILE_INTERVAL_MS must be at least 1000 ms, got: ${cfg.fan.reconcileIntervalMs}`
    );
  }

  // Reject the pre-rename variable outright: silently ignoring it would swap
  // the operator's window for the default without any sign of it.
  if (env['INFLUXDB_OUTDOOR_LOOKBACK'] !== undefined) {
    errors.push(
      'INFLUXDB_OUTDOOR_LOOKBACK has been replaced by INFLUXDB_LATEST_LOOKBACK, ' +
        'which now bounds stock readings and outdoor conditions alike. Rename the variable.'
    );
  }

  /**
   * Parses a duration and records an error for anything unusable. Zero is
   * rejected: `now() - 0h` matches nothing, which would empty every latest
   * query without a single complaint anywhere.
   */
  const durationMs = (name: string, value: string, example: string): number | null => {
    const ms = parseDurationMs(value);
    if (ms === null) {
      errors.push(
        `${name} must be a valid InfluxQL duration (e.g. '${example}'), got: ${value}`
      );
      return null;
    }
    if (ms === 0) {
      errors.push(`${name} must be greater than zero, got: ${value}`);
      return null;
    }
    return ms;
  };

  // Validate latest-value look-back duration (interpolated into InfluxQL)
  const lookbackMs = durationMs(
    'INFLUXDB_LATEST_LOOKBACK',
    cfg.influxdb.latestLookback,
    '6h'
  );

  // Validate offline threshold; it only makes sense inside the look-back
  // window. The ordering holds as long as device clocks are roughly right:
  // the window filters the InfluxDB ingest time, the offline flag for stock
  // readings the device-reported time.
  const offlineMs = durationMs(
    'INFLUXDB_OFFLINE_AFTER',
    cfg.influxdb.offlineAfter,
    '1h'
  );

  // Only an explicitly set threshold can be wrong here — an unset one is
  // clamped to the look-back window when the configuration is built.
  if (
    env['INFLUXDB_OFFLINE_AFTER'] !== undefined &&
    offlineMs !== null &&
    lookbackMs !== null &&
    offlineMs > lookbackMs
  ) {
    errors.push(
      `INFLUXDB_OFFLINE_AFTER (${cfg.influxdb.offlineAfter}) must not exceed ` +
        `INFLUXDB_LATEST_LOOKBACK (${cfg.influxdb.latestLookback})`
    );
  }

  // Validate the outdoor pairing tolerance
  durationMs('INFLUXDB_OUTDOOR_MAX_SKEW', cfg.influxdb.outdoorMaxSkew, '30m');

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

const isProduction = getEnvVar('NODE_ENV', 'development') === 'production';

const latestLookback = getEnvVar(
  'INFLUXDB_LATEST_LOOKBACK',
  isProduction ? '6h' : '26w'
);

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
    outdoorTemperatureMeasurement: getEnvVar(
      'INFLUXDB_OUTDOOR_TEMPERATURE_MEASUREMENT',
      'outdoor-temperature',
    ),
    outdoorHumidityMeasurement: getEnvVar(
      'INFLUXDB_OUTDOOR_HUMIDITY_MEASUREMENT',
      'outdoor-humidity',
    ),
    latestLookback,
    offlineAfter: getEnvVar(
      'INFLUXDB_OFFLINE_AFTER',
      clampDuration(isProduction ? '1h' : '26w', latestLookback),
    ),
    outdoorMaxSkew: getEnvVar('INFLUXDB_OUTDOOR_MAX_SKEW', '30m'),
  },
  database: {
    path: getEnvVar('DATABASE_PATH', './data/grainwatch.db'),
  },
  mqtt: {
    url: getEnvVar('MQTT_URL', 'mqtt://localhost:1883'),
    ...(process.env['MQTT_USERNAME'] ? { username: process.env['MQTT_USERNAME'] } : {}),
    ...(process.env['MQTT_PASSWORD'] ? { password: process.env['MQTT_PASSWORD'] } : {}),
  },
  fan: {
    keepAliveMs: getEnvVarAsInt('FAN_KEEPALIVE_INTERVAL_MS', 900000),
    watchdogMs: getEnvVarAsInt('FAN_WATCHDOG_TIMEOUT_MS', 10000),
    retentionDays: getEnvVarAsInt('FAN_EVENT_RETENTION_DAYS', 90),
    retentionSweepMs: getEnvVarAsInt('FAN_RETENTION_SWEEP_INTERVAL_MS', 21600000),
    reconcileIntervalMs: getEnvVarAsInt('FAN_RECONCILE_INTERVAL_MS', 60000),
  },
};

// Validate configuration on module load (skip in test environment for flexibility)
if (process.env['NODE_ENV'] !== 'test') {
  validateConfig(config);
}

export type { Config, InfluxDBConfig, JWTConfig, CookieConfig, DatabaseConfig, MqttConfig, FanConfig };
