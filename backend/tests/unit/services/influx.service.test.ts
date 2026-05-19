/**
 * Unit tests for InfluxDBService.
 *
 * These tests mock the fetch API to verify query construction
 * and result transformation without requiring a live database connection.
 */

import { InfluxDBService } from '../../../src/services';

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
    jwt: {
      secret: 'jwt-secret',
    }
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

  describe('getHistory', () => {
    it('issues one query per temperature layer with the requested interval', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ series: [] }] }),
      });

      await service.getHistory(
        'corn-watch-1',
        new Date('2026-05-19T00:00:00Z'),
        new Date('2026-05-19T08:00:00Z'),
        1800,
        false,
      );

      // 3 layer queries, no humidity
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const calls = mockFetch.mock.calls.map((c) => decodeURIComponent(c[0] as string));
      expect(calls.some((url) => url.includes('MEAN("temp-top")'))).toBe(true);
      expect(calls.some((url) => url.includes('MEAN("temp-mid")'))).toBe(true);
      expect(calls.some((url) => url.includes('MEAN("temp-bottom")'))).toBe(true);
      expect(calls.every((url) => url.includes('GROUP BY time(1800s)'))).toBe(true);
      expect(calls.every((url) => url.includes(', "device" fill(null)'))).toBe(true);
      expect(calls.every((url) => url.includes("'corn-watch-1'"))).toBe(true);
    });

    it('also issues a humidity query when requested', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ series: [] }] }),
      });

      await service.getHistory(
        'corn-watch-1',
        new Date('2026-05-19T00:00:00Z'),
        new Date('2026-05-19T08:00:00Z'),
        1800,
        true,
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const calls = mockFetch.mock.calls.map((c) => decodeURIComponent(c[0] as string));
      expect(calls.some((url) => url.includes('MEAN("humidity")'))).toBe(true);
    });

    it('maps Influx series into per-device point arrays per layer', async () => {
      const respFor = (_field: string) => ({
        ok: true,
        json: async () => ({
          results: [{
            series: [
              {
                name: 'Temp',
                tags: { device: '1.1' },
                columns: ['time', 'mean'],
                values: [
                  ['2026-05-19T00:00:00Z', 12.0],
                  ['2026-05-19T00:30:00Z', null],
                  ['2026-05-19T01:00:00Z', 12.5],
                ],
              },
              {
                name: 'Temp',
                tags: { device: '1.2' },
                columns: ['time', 'mean'],
                values: [
                  ['2026-05-19T00:00:00Z', 13.0],
                  ['2026-05-19T00:30:00Z', 13.2],
                  ['2026-05-19T01:00:00Z', 13.4],
                ],
              },
            ],
          }],
        }),
      });

      // Each call returns the same shape regardless of field.
      mockFetch
        .mockResolvedValueOnce(respFor('temp-top'))
        .mockResolvedValueOnce(respFor('temp-mid'))
        .mockResolvedValueOnce(respFor('temp-bottom'));

      const result = await service.getHistory(
        'corn-watch-1',
        new Date('2026-05-19T00:00:00Z'),
        new Date('2026-05-19T01:00:00Z'),
        1800,
        false,
      );

      expect(result.temperature.top.get('1.1')).toEqual([
        { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
        { t: '2026-05-19T00:30:00.000Z', v: null },
        { t: '2026-05-19T01:00:00.000Z', v: 12.5 },
      ]);
      expect(result.temperature.top.get('1.2')?.[1]).toEqual({
        t: '2026-05-19T00:30:00.000Z',
        v: 13.2,
      });
      expect(result.humidity).toBeUndefined();
    });

    it('escapes the device-group value in the query', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ series: [] }] }),
      });

      await service.getHistory(
        "corn-watch'1",
        new Date('2026-05-19T00:00:00Z'),
        new Date('2026-05-19T08:00:00Z'),
        1800,
        false,
      );

      const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
      expect(url).toContain("'corn-watch\\'1'");
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
