/**
 * Unit tests for InfluxDBService.
 *
 * These tests mock the fetch API to verify query construction
 * and result transformation without requiring a live database connection.
 */

import {
  InfluxDBService,
  isValidWindowDuration,
  WindowDuration,
} from '../../../src/services/influx';

// Mock the config module
jest.mock('../../../src/config', () => ({
  config: {
    influxdb: {
      url: 'http://localhost:8086',
      token: 'test-token',
      org: 'test-org',
      bucket: 'testdb',
      measurement: 'Temp',
    },
  },
}));

describe('InfluxDBService', () => {
  let service: InfluxDBService;
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock global fetch
    mockFetch = jest.spyOn(global, 'fetch' as any);

    service = new InfluxDBService();
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe('constructor', () => {
    it('should create an InfluxDB client with config values', () => {
      expect(service).toBeInstanceOf(InfluxDBService);
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
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            tags: { device: '1.1' },
            columns: ['time', 'temp_top', 'temp_mid', 'temp_bottom', 'humidity', 'battery', 'measurement_time'],
            values: [[
              '2024-01-16T09:00:00Z',
              10.5,
              11.2,
              9.8,
              85,
              436,
              1705395600,
            ]],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getLatestReadings('corn-watch-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('corn-watch-1'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Token test-token',
          }),
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        device: '1.1',
        tempTop: 10.5,
        tempMid: 11.2,
        tempBottom: 9.8,
        humidity: 85,
        battery: 436,
        measurementTime: '2024-01-16T09:00:00.000Z',
      });
    });

    it('should handle empty results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await service.getLatestReadings('corn-watch-1');

      expect(result).toEqual([]);
    });

    it('should escape special characters in device group', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await service.getLatestReadings("test'group");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(callUrl);
      expect(decodedUrl).toContain("test\\'group");
    });
  });

  describe('getTemperatureTimeSeries', () => {
    it('should query for temperature time series with correct parameters', async () => {
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            tags: { device: '1.1' },
            columns: ['time', 'value'],
            values: [
              ['2024-01-15T00:00:00Z', 10.5],
              ['2024-01-15T01:00:00Z', 10.3],
            ],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getTemperatureTimeSeries(
        'corn-watch-1',
        'top',
        '2024-01-15T00:00:00Z',
        '2024-01-16T00:00:00Z',
        '1h'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('temp-top'),
        expect.anything()
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        time: '2024-01-15T00:00:00.000Z',
        device: '1.1',
        value: 10.5,
      });
    });

    it('should throw error for invalid layer', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'invalid' as any,
          '2024-01-15T00:00:00Z',
          '2024-01-16T00:00:00Z'
        )
      ).rejects.toThrow('Invalid layer');
    });

    it('should throw error for invalid start time', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          'invalid-time',
          '2024-01-16T00:00:00Z'
        )
      ).rejects.toThrow('Invalid startTime');
    });

    it('should throw error for invalid end time', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          '2024-01-15T00:00:00Z',
          'invalid-time'
        )
      ).rejects.toThrow('Invalid endTime');
    });

    it('should throw error for invalid window duration', async () => {
      await expect(
        service.getTemperatureTimeSeries(
          'corn-watch-1',
          'top',
          '2024-01-15T00:00:00Z',
          '2024-01-16T00:00:00Z',
          '2m' as any
        )
      ).rejects.toThrow('Invalid window duration');
    });

    it('should use default window duration of 15m', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await service.getTemperatureTimeSeries(
        'corn-watch-1',
        'top',
        '2024-01-15T00:00:00Z',
        '2024-01-16T00:00:00Z'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('time(15m)'),
        expect.anything()
      );
    });
  });

  describe('getHumidityTimeSeries', () => {
    it('should query for humidity time series', async () => {
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            tags: { device: '1.1' },
            columns: ['time', 'value'],
            values: [['2024-01-15T00:00:00Z', 85]],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getHumidityTimeSeries(
        'corn-watch-1',
        '2024-01-15T00:00:00Z',
        '2024-01-16T00:00:00Z'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('humidity'),
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.value).toBe(85);
    });
  });

  describe('getDeviceGroups', () => {
    it('should return list of device groups', async () => {
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            columns: ['key', 'value'],
            values: [
              ['device-group', 'corn-watch-1'],
              ['device-group', 'corn-watch-2'],
            ],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getDeviceGroups();

      const callUrl = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(callUrl);
      expect(decodedUrl).toContain('SHOW TAG VALUES');
      expect(result).toEqual(['corn-watch-1', 'corn-watch-2']);
    });

    it('should return empty array when no device groups exist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await service.getDeviceGroups();

      expect(result).toEqual([]);
    });
  });

  describe('getSummaryStats', () => {
    it('should query for summary statistics', async () => {
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            tags: { device: '1.1' },
            columns: ['time', 'min', 'max', 'avg', 'current'],
            values: [[
              '2024-01-15T00:00:00Z',
              9.5,
              11.5,
              10.5,
              10.5,
            ]],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getSummaryStats('corn-watch-1', 'top', 24);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('MIN'),
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        device: '1.1',
        min: 9.5,
        max: 11.5,
        avg: 10.5,
        current: 10.5,
      });
    });

    it('should use default hours of 24', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await service.getSummaryStats('corn-watch-1', 'top');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('24h'),
        expect.anything()
      );
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
      const mockResponse = {
        results: [{
          series: [{
            name: 'Temp',
            tags: { device: '1.1' },
            columns: ['time', 'battery'],
            values: [['2024-01-15T00:00:00Z', 436]],
          }],
        }],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getBatteryStatus('corn-watch-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('batteryMV'),
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.battery).toBe(436);
    });
  });

  describe('testConnection', () => {
    it('should return true when at least one host is online', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await service.testConnection();

      expect(result).toBe(true);
    });

    it('should throw error when no hosts are online', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Connection refused',
      });

      await expect(service.testConnection()).rejects.toThrow('Failed to connect to InfluxDB');
    });

    it('should throw error when ping fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.testConnection()).rejects.toThrow('Failed to connect to InfluxDB');
    });
  });
});
