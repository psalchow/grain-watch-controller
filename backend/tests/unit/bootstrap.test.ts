/**
 * Tests for application bootstrap functionality.
 */

// Set DATABASE_PATH before config module loads so bootstrap uses :memory:
process.env['DATABASE_PATH'] = ':memory:';

import { closeDb } from '../../src/db';
import {
  getUserService,
  userService,
  resetServiceSingletonsForTests,
} from '../../src/services';
import { bootstrapApplication, validateBootstrap } from '../../src/bootstrap';

// Override config.database.path to use in-memory SQLite for all tests.
// NOTE: `mqtt` and `fan` are intentionally omitted from this mock.
// Their absence causes initFanControl() to short-circuit (graceful-degradation guard),
// which prevents the unit test from opening a real MQTT socket or leaking
// FanControlManager retention-sweep timers across the 7+ bootstrapApplication() calls.
// WARNING: do NOT add `mqtt`/`fan` here unless you also mock
// `createMqttService` from `../../src/services/mqtt` and call manager.shutdown()
// in afterEach — otherwise the suite will open sockets and leak timers.
jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    database: { path: ':memory:' },
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '24h',
    },
    influxdb: {
      url: 'http://localhost:8086',
      token: 'test-token',
      org: 'test-org',
      bucket: 'testdb',
      measurement: 'Temp',
    },
  },
}));

describe('Application Bootstrap', () => {
  // bootstrapApplication itself does initDb + runMigrations + seedStocks now.
  beforeEach(() => {});

  afterEach(() => {
    closeDb();
    resetServiceSingletonsForTests();
    jest.restoreAllMocks();
  });

  describe('bootstrapApplication', () => {
    it('should create default admin user when no users exist', async () => {
      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(true);
      expect(result.defaultAdminUsername).toBe('admin');

      // Verify the user was actually created
      expect(await userService.countUsers()).toBe(1);
      const admin = await userService.findUserByUsername('admin');
      expect(admin?.username).toBe('admin');
      expect(admin?.role).toBe('admin');
      expect(admin?.stockAccess).toEqual(['*']);
    });

    it('should not create default users when a user already exists', async () => {
      // Bootstrap once to set up the DB
      await bootstrapApplication();

      // The admin user was created; reset singletons so getUserService() returns
      // a fresh instance pointing at the same (still open) DB, then add another user.
      resetServiceSingletonsForTests();

      // Now mock initializeDefaultUsers to simulate "users already exist" path
      jest
        .spyOn(getUserService(), 'initializeDefaultUsers')
        .mockResolvedValueOnce(null);

      // Close and reopen the DB via a fresh bootstrap — but that would re-init.
      // Instead, test the "skip" path directly: mock the service on a second bootstrap.
      // We need to close and re-open so initDb doesn't throw.
      closeDb();
      resetServiceSingletonsForTests();

      // Spy on getUserService to inject a mock that returns null from initializeDefaultUsers
      const servicesModule = await import('../../src/services');
      jest
        .spyOn(servicesModule, 'getUserService')
        .mockReturnValue({
          initializeDefaultUsers: jest.fn().mockResolvedValue(null),
          countUsers: jest.fn().mockResolvedValue(1),
        } as unknown as ReturnType<typeof servicesModule.getUserService>);

      const result = await bootstrapApplication();

      expect(result.defaultUsersCreated).toBe(false);
      expect(result.defaultAdminUsername).toBeUndefined();
    });

    it('should throw when initializeDefaultUsers fails', async () => {
      // Spy on getUserService to inject a mock that throws
      const servicesModule = await import('../../src/services');
      jest
        .spyOn(servicesModule, 'getUserService')
        .mockReturnValue({
          initializeDefaultUsers: jest.fn().mockRejectedValue(new Error('Simulated bootstrap failure')),
        } as unknown as ReturnType<typeof servicesModule.getUserService>);

      await expect(bootstrapApplication()).rejects.toThrow('Bootstrap failed: Simulated bootstrap failure');
    });
  });

  describe('validateBootstrap', () => {
    beforeEach(async () => {
      // validateBootstrap needs the DB to be initialised; use bootstrapApplication to do it
      await bootstrapApplication();
    });

    it('should return true when users exist', async () => {
      // bootstrapApplication already created the admin user
      const isValid = await validateBootstrap();
      expect(isValid).toBe(true);
    });

    it('should return false on validation errors', async () => {
      // Mock countUsers to throw an error
      const mockError = new Error('Simulated validation error');
      jest
        .spyOn(getUserService(), 'countUsers')
        .mockRejectedValueOnce(mockError);

      // Mock console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const isValid = await validateBootstrap();

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Bootstrap validation failed:',
        'Simulated validation error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Default admin credentials', () => {
    it('should create admin with expected credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');

      expect(admin).not.toBeNull();
      expect(admin?.username).toBe('admin');
      expect(admin?.role).toBe('admin');
      expect(admin?.stockAccess).toEqual(['*']);
      expect(admin?.active).toBe(true);

      // Verify password hash exists
      expect(admin?.passwordHash).toBeDefined();
      expect(admin?.passwordHash).not.toBe('changeme123'); // Should be hashed
    });

    it('should allow login with default admin credentials', async () => {
      await bootstrapApplication();

      const admin = await userService.findUserByUsername('admin');
      expect(admin).not.toBeNull();

      // Import bcrypt to verify password
      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.compare('changeme123', admin!.passwordHash);

      expect(isValid).toBe(true);
    });
  });
});
