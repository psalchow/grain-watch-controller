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
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'test-secret';

    const { config } = await import('../../src/config/index');

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('production');
    expect(config.jwt.secret).toBe('test-secret');
  });
});
