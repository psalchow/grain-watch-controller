/**
 * Unit tests for InfluxDBService.
 *
 * These tests mock the fetch API to verify query construction
 * and result transformation without requiring a live database connection.
 */

import { InfluxDBService } from '../../../src/services/influx';

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
