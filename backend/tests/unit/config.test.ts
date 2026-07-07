describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Set required env vars to prevent validation errors
    process.env['INFLUXDB_TOKEN'] = 'test-token';
    process.env['INFLUXDB_URL'] = 'http://localhost:8086';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use default values when environment variables are not set', async () => {
    delete process.env['PORT'];
    delete process.env['NODE_ENV'];
    delete process.env['JWT_SECRET'];
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
  });

  it('should use environment variables when set', async () => {
    process.env['PORT'] = '4000';
    process.env['NODE_ENV'] = 'development';
    process.env['JWT_SECRET'] = 'test-secret';
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.jwt.secret).toBe('test-secret');
  });

  it('should validate JWT secret length in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'short';
    process.env['INFLUXDB_TOKEN'] = 'test-token';
    process.env['INFLUXDB_URL'] = 'http://localhost:8086';

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_SECRET must be at least 32 characters/
    );
  });

  it('should require JWT secret to be changed in production', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
    process.env['INFLUXDB_TOKEN'] = 'test-token';
    process.env['INFLUXDB_URL'] = 'http://localhost:8086';

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_SECRET must be set in production/
    );
  });

  it('should use default access and refresh token expiries', async () => {
    delete process.env['JWT_EXPIRES_IN'];
    delete process.env['JWT_REFRESH_EXPIRES_IN'];
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.jwt.expiresIn).toBe('15m');
    expect(config.jwt.refreshExpiresIn).toBe('30d');
  });

  it('should default cookie settings by environment', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['COOKIE_SECURE'];
    delete process.env['COOKIE_SAMESITE'];
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.cookie.secure).toBe(false);
    expect(config.cookie.sameSite).toBe('lax');
  });

  it('should require refresh secret to be set in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-sufficiently-long-production-secret-value';
    delete process.env['JWT_REFRESH_SECRET'];
    process.env['INFLUXDB_TOKEN'] = 'test-token';
    process.env['INFLUXDB_URL'] = 'http://localhost:8086';

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_REFRESH_SECRET must be set in production/
    );
  });

  it('should require refresh secret to differ from access secret in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-sufficiently-long-production-secret-value';
    process.env['JWT_REFRESH_SECRET'] = 'a-sufficiently-long-production-secret-value';
    process.env['INFLUXDB_TOKEN'] = 'test-token';
    process.env['INFLUXDB_URL'] = 'http://localhost:8086';

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_REFRESH_SECRET must be different from JWT_SECRET/
    );
  });

  it('should include influxdb measurement in config', async () => {
    process.env['INFLUXDB_MEASUREMENT'] = 'TestMeasurement';
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.influxdb.measurement).toBe('TestMeasurement');
  });

  it('should include database.path in config', async () => {
    process.env['DATABASE_PATH'] = '/custom/path/grainwatch.db';
    process.env['INFLUXDB_TOKEN'] = 'test-token';

    const { config } = await import('../../src/config/index');

    expect(config.database.path).toBe('/custom/path/grainwatch.db');
  });
});
