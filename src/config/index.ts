interface Config {
  port: number;
  nodeEnv: string;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  influxdb: {
    host: string;
    port: number;
    database: string;
    username: string | undefined;
    password: string | undefined;
  };
}

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

export const config: Config = {
  port: getEnvVarAsInt('PORT', 3000),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  jwt: {
    secret: getEnvVar('JWT_SECRET', 'development-secret-change-in-production'),
    expiresIn: getEnvVar('JWT_EXPIRES_IN', '24h'),
  },
  influxdb: {
    host: getEnvVar('INFLUXDB_HOST', 'localhost'),
    port: getEnvVarAsInt('INFLUXDB_PORT', 8086),
    database: getEnvVar('INFLUXDB_DATABASE', 'grainwatch'),
    username: process.env['INFLUXDB_USERNAME'],
    password: process.env['INFLUXDB_PASSWORD'],
  },
};
