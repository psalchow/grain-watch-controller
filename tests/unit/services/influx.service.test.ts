/**
 * Unit tests for InfluxDBService.
 *
 * These tests mock the InfluxDB client to verify query construction
 * and result transformation without requiring a live database connection.
 */

import { InfluxDB } from 'influx';
import {
  InfluxDBService,
  isValidWindowDuration,
  WindowDuration,
} from '../../../src/services/influx';

// Mock the influx module
jest.mock('influx');

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
    influxdb: {
      host: 'localhost',
      port: 8086,
      database: 'testdb',
      measurement: 'Temp',
      username: 'testuser',
      password: 'testpass',
    },
  },
}));

describe('InfluxDBService', () => {
  let service: InfluxDBService;
  let mockQuery: jest.Mock;
  let mockPing: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock query function
    mockQuery = jest.fn();
    mockPing = jest.fn();

    // Mock the InfluxDB constructor
    (InfluxDB as jest.MockedClass<typeof InfluxDB>).mockImplementation(() => ({
      query: mockQuery,
      ping: mockPing,
    }) as unknown as InfluxDB);

    service = new InfluxDBService();
  });

  describe('constructor', () => {
    it('should create an InfluxDB client with config values', () => {
      expect(InfluxDB).toHaveBeenCalledWith({
        host: 'localhost',
        port: 8086,
        database: 'testdb',
        username: 'testuser',
        password: 'testpass',
      });
    });
  });

  describe('isValidWindowDuration', () => {
    it('should return true for valid window durations', () => {
      const validDurations: WindowDuration[] = ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'];
      validDurations.forEach((duration) => {
        expect(isValidWindowDuration(duration)).toBe(true);
      });
    });

    it('should return false for invalid window durations', () => {
      expect(isValidWindowDuration('2m')).toBe(false);
      expect(isValidWindowDuration('1w')).toBe(false);
      expect(isValidWindowDuration('invalid')).toBe(false);
      expect(isValidWindowDuration('')).toBe(false);
    });
  });

  describe('getLatestReadings', () => {
    it('should query for latest readings and transform results', async () => {
      const mockResults = {
        groups: () => [
          {
            tags: { device: '1.1' },
            rows: [{
              temp_top: 10.5,
              temp_mid: 11.2,
              temp_bottom: 9.8,
              humidity: 85,
              battery: 436,
              measurement_time: 1705395600, // 2024-01-16T09:00:00Z
            }],
          },
          {
            tags: { device: '1.2' },
            rows: [{
              temp_top: 10.8,
              temp_mid: 11.5,
              temp_bottom: 10.0,
              humidity: 82,
              battery: 428,
              measurement_time: 1705395600,
            }],
          },
        ],
      };

      mockQuery.mockResolvedValue(mockResults);

      const readings = await service.getLatestReadings('corn-watch-1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain("device-group");
      expect(mockQuery.mock.calls[0][0]).toContain("corn-watch-1");

      expect(readings).toHaveLength(2);
      expect(readings[0]).toEqual({
        device: '1.1',
        tempTop: 10.5,
        tempMid: 11.2,
        tempBottom: 9.8,
        humidity: 85,
        battery: 436,
        measurementTime: expect.any(String),
      });
    });

    it('should handle empty results', async () => {
      mockQuery.mockResolvedValue({ groups: () => [] });

      const readings = await service.getLatestReadings('corn-watch-1');

      expect(readings).toHaveLength(0);
    });

    it('should escape special characters in device group', async () => {
      mockQuery.mockResolvedValue({ groups: () => [] });

      await service.getLatestReadings("corn-watch-1'--");

      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain("corn-watch-1\\'--");
    });
  });

  describe('getTemperatureTimeSeries', () => {
    it('should query for temperature time series with correct parameters', async () => {
      const mockResults = {
        groups: () => [
          {
            tags: { device: '1.1' },
            rows: [
              { time: { toISOString: () => '2026-01-15T00:00:00Z' }, value: 10.5 },
              { time: { toISOString: () => '2026-01-15T01:00:00Z' }, value: 10.8 },
            ],
          },
        ],
      };

      mockQuery.mockResolvedValue(mockResults);

      const data = await service.getTemperatureTimeSeries(
        'corn-watch-1',
        'top',
        '2026-01-15T00:00:00Z',
        '2026-01-16T00:00:00Z',
        '1h'
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('mean("temp-top")');
      expect(queryString).toContain('corn-watch-1');
      expect(queryString).toContain('time(1h)');

      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({
        time: '2026-01-15T00:00:00Z',
        device: '1.1',
        value: 10.5,
      });
    });

    it('should throw error for invalid layer', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'invalid' as any,
          '2026-01-15T00:00:00Z',
          '2026-01-16T00:00:00Z'
        )
      ).rejects.toThrow("Invalid layer: invalid");
    });

    it('should throw error for invalid start time', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          'not-a-date',
          '2026-01-16T00:00:00Z'
        )
      ).rejects.toThrow('Invalid startTime');
    });

    it('should throw error for invalid end time', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          '2026-01-15T00:00:00Z',
          'not-a-date'
        )
      ).rejects.toThrow('Invalid endTime');
    });

    it('should throw error for invalid window duration', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          '2026-01-15T00:00:00Z',
          '2026-01-16T00:00:00Z',
          '2h' as any
        )
      ).rejects.toThrow('Invalid window duration');
    });

    it('should use default window duration of 15m', async () => {
      mockQuery.mockResolvedValue({ groups: () => [] });

      await service.getTemperatureTimeSeries(
        'corn-watch-1',
        'top',
        '2026-01-15T00:00:00Z',
        '2026-01-16T00:00:00Z'
      );

      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('time(15m)');
    });
  });

  describe('getHumidityTimeSeries', () => {
    it('should query for humidity time series', async () => {
      const mockResults = {
        groups: () => [
          {
            tags: { device: '1.1' },
            rows: [
              { time: { toISOString: () => '2026-01-15T00:00:00Z' }, value: 85 },
              { time: { toISOString: () => '2026-01-15T01:00:00Z' }, value: 82 },
            ],
          },
        ],
      };

      mockQuery.mockResolvedValue(mockResults);

      const data = await service.getHumidityTimeSeries(
        'corn-watch-1',
        '2026-01-15T00:00:00Z',
        '2026-01-16T00:00:00Z',
        '1h'
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('mean("humidity")');

      expect(data).toHaveLength(2);
      expect(data[0]?.value).toBe(85);
    });
  });

  describe('getDeviceGroups', () => {
    it('should return list of device groups', async () => {
      const mockResults = [
        { key: 'device-group', value: 'corn-watch-1' },
        { key: 'device-group', value: 'corn-watch-2' },
      ];

      // Mock the map function for array-like results
      (mockResults as any).groups = () => [];
      mockQuery.mockResolvedValue(mockResults);

      const groups = await service.getDeviceGroups();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('SHOW TAG VALUES');
      expect(mockQuery.mock.calls[0][0]).toContain('device-group');

      expect(groups).toEqual(['corn-watch-1', 'corn-watch-2']);
    });

    it('should return empty array when no device groups exist', async () => {
      const mockResults: any[] = [];
      mockQuery.mockResolvedValue(mockResults);

      const groups = await service.getDeviceGroups();

      expect(groups).toEqual([]);
    });
  });

  describe('getSummaryStats', () => {
    it('should query for summary statistics', async () => {
      const mockResults = {
        groups: () => [
          {
            tags: { device: '1.1' },
            rows: [{
              min: 8.5,
              max: 12.3,
              avg: 10.2,
              current: 10.5,
            }],
          },
        ],
      };

      mockQuery.mockResolvedValue(mockResults);

      const stats = await service.getSummaryStats('corn-watch-1', 'top', 24);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('MIN("temp-top")');
      expect(queryString).toContain('MAX("temp-top")');
      expect(queryString).toContain('MEAN("temp-top")');
      expect(queryString).toContain('LAST("temp-top")');
      expect(queryString).toContain('24h');

      expect(stats).toHaveLength(1);
      expect(stats[0]).toEqual({
        device: '1.1',
        min: 8.5,
        max: 12.3,
        avg: 10.2,
        current: 10.5,
      });
    });

    it('should use default hours of 24', async () => {
      mockQuery.mockResolvedValue({ groups: () => [] });

      await service.getSummaryStats('corn-watch-1', 'mid');

      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('24h');
    });

    it('should throw error for invalid hours', async () => {
      await expect(
        service.getSummaryStats('corn-watch-1', 'top', 0)
      ).rejects.toThrow('Invalid hours');

      await expect(
        service.getSummaryStats('corn-watch-1', 'top', 10000)
      ).rejects.toThrow('Invalid hours');
    });
  });

  describe('getBatteryStatus', () => {
    it('should query for battery status', async () => {
      const mockResults = {
        groups: () => [
          { tags: { device: '1.1' }, rows: [{ battery: 436 }] },
          { tags: { device: '1.2' }, rows: [{ battery: 428 }] },
        ],
      };

      mockQuery.mockResolvedValue(mockResults);

      const batteries = await service.getBatteryStatus('corn-watch-1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryString = mockQuery.mock.calls[0][0];
      expect(queryString).toContain('LAST("batteryMV")');

      expect(batteries).toHaveLength(2);
      expect(batteries[0]).toEqual({ device: '1.1', battery: 436 });
      expect(batteries[1]).toEqual({ device: '1.2', battery: 428 });
    });
  });

  describe('testConnection', () => {
    it('should return true when at least one host is online', async () => {
      mockPing.mockResolvedValue([
        { online: true, url: { host: 'localhost' }, rtt: 5, version: '1.8.0' },
      ]);

      const result = await service.testConnection();

      expect(result).toBe(true);
      expect(mockPing).toHaveBeenCalledWith(5000);
    });

    it('should throw error when no hosts are online', async () => {
      mockPing.mockResolvedValue([
        { online: false, url: { host: 'localhost' }, rtt: 0, version: '' },
      ]);

      await expect(service.testConnection()).rejects.toThrow('No InfluxDB hosts are online');
    });

    it('should throw error when ping fails', async () => {
      mockPing.mockRejectedValue(new Error('Connection refused'));

      await expect(service.testConnection()).rejects.toThrow(
        'Failed to connect to InfluxDB: Connection refused'
      );
    });
  });
});
