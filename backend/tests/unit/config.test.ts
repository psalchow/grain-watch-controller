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

  describe('look-back windows', () => {
    it('defaults to a short window and a shorter offline threshold in production', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['JWT_SECRET'] = 'a'.repeat(40);
      process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(40);
      delete process.env['INFLUXDB_LATEST_LOOKBACK'];
      delete process.env['INFLUXDB_OFFLINE_AFTER'];

      const { config } = await import('../../src/config/index');

      expect(config.influxdb.latestLookback).toBe('6h');
      expect(config.influxdb.offlineAfter).toBe('1h');
    });

    it('rejects an offline threshold beyond the look-back window', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_LATEST_LOOKBACK'] = '1h';
      process.env['INFLUXDB_OFFLINE_AFTER'] = '2h';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_OFFLINE_AFTER \(2h\) must not exceed INFLUXDB_LATEST_LOOKBACK \(1h\)/
      );
    });

    it('rejects a malformed duration', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_LATEST_LOOKBACK'] = 'soon';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_LATEST_LOOKBACK must be a valid InfluxQL duration/
      );
    });

    it('rejects a zero duration', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_LATEST_LOOKBACK'] = '0h';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_LATEST_LOOKBACK must be greater than zero/
      );
    });

    it('clamps the unset offline default to a shortened look-back window', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_LATEST_LOOKBACK'] = '30m';
      delete process.env['INFLUXDB_OFFLINE_AFTER'];

      const { config } = await import('../../src/config/index');

      expect(config.influxdb.offlineAfter).toBe('30m');
    });

    it('still rejects an explicitly set threshold beyond the window', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_LATEST_LOOKBACK'] = '30m';
      process.env['INFLUXDB_OFFLINE_AFTER'] = '2h';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_OFFLINE_AFTER \(2h\) must not exceed INFLUXDB_LATEST_LOOKBACK \(30m\)/
      );
    });

    it('rejects a malformed outdoor skew tolerance', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_OUTDOOR_MAX_SKEW'] = 'quarter';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_OUTDOOR_MAX_SKEW must be a valid InfluxQL duration/
      );
    });

    it('fails fast when the pre-rename variable is still set', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['INFLUXDB_OUTDOOR_LOOKBACK'] = '1h';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /INFLUXDB_OUTDOOR_LOOKBACK has been replaced by INFLUXDB_LATEST_LOOKBACK/
      );
    });
  });

  describe('fan/mqtt config', () => {
    it('rejects a reconciliation interval below a second', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['FAN_RECONCILE_INTERVAL_MS'] = '60';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /FAN_RECONCILE_INTERVAL_MS must be at least 1000 ms/
      );
    });

    it('rejects an automation interval below a second', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['FAN_AUTOMATION_INTERVAL_MS'] = '300';

      await expect(import('../../src/config/index')).rejects.toThrow(
        /FAN_AUTOMATION_INTERVAL_MS must be at least 1000 ms/
      );
    });

    it('provides mqtt and fan defaults', async () => {
      jest.resetModules();
      process.env['NODE_ENV'] = 'development';
      const { config } = await import('../../src/config');
      expect(config.fan.keepAliveMs).toBe(900000);
      expect(config.fan.watchdogMs).toBe(10000);
      expect(config.fan.retentionDays).toBe(90);
      expect(config.fan.automationIntervalMs).toBe(300000);
      expect(config.mqtt.url).toBe('mqtt://localhost:1883');
    });
  });
});
