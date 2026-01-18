describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use default values when environment variables are not set', async () => {
    delete process.env['PORT'];
    delete process.env['NODE_ENV'];
    delete process.env['JWT_SECRET'];

    const { config } = await import('../../src/config/index');

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
  });

  it('should use environment variables when set', async () => {
    process.env['PORT'] = '4000';
    process.env['NODE_ENV'] = 'development';
    process.env['JWT_SECRET'] = 'test-secret';

    const { config } = await import('../../src/config/index');

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.jwt.secret).toBe('test-secret');
  });

  it('should validate JWT secret length in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'short';

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_SECRET must be at least 32 characters/
    );
  });

  it('should require JWT secret to be changed in production', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];

    await expect(import('../../src/config/index')).rejects.toThrow(
      /JWT_SECRET must be set in production/
    );
  });

  it('should include influxdb measurement in config', async () => {
    process.env['INFLUXDB_MEASUREMENT'] = 'TestMeasurement';

    const { config } = await import('../../src/config/index');

    expect(config.influxdb.measurement).toBe('TestMeasurement');
  });

  it('should include usersFilePath in config', async () => {
    process.env['USERS_FILE_PATH'] = '/custom/path/users.json';

    const { config } = await import('../../src/config/index');

    expect(config.usersFilePath).toBe('/custom/path/users.json');
  });
});
