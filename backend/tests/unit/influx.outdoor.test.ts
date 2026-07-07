jest.mock('../../src/config', () => ({
  config: {
    influxdb: {
      url: 'http://influx:8086',
      token: 'test-token',
      bucket: 'testdb',
      measurement: 'Temp',
      outdoorTemperatureMeasurement: 'outdoor-temperature',
      outdoorHumidityMeasurement: 'outdoor-humidity',
      outdoorLookback: '1h',
    },
  },
}));

import { InfluxDBService } from '../../src/services/influx/influx.service';

describe('InfluxDBService.getOutdoorReading', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchWith(byUrl: (url: string) => unknown): void {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => byUrl(url),
    })) as unknown as typeof fetch;
  }

  it('queries both outdoor measurements filtered by device and parses values', async () => {
    const calls: string[] = [];
    mockFetchWith((url) => {
      calls.push(decodeURIComponent(url));
      if (decodeURIComponent(url).includes('outdoor-temperature')) {
        return {
          results: [
            {
              series: [
                {
                  name: 'outdoor-temperature',
                  columns: ['time', 'value'],
                  values: [['2026-07-07T09:00:00Z', 12.4]],
                },
              ],
            },
          ],
        };
      }
      return {
        results: [
          {
            series: [
              {
                name: 'outdoor-humidity',
                columns: ['time', 'value'],
                values: [['2026-07-07T09:00:30Z', 78]],
              },
            ],
          },
        ],
      };
    });

    const service = new InfluxDBService();
    const reading = await service.getOutdoorReading('corn-watch-1');

    expect(reading).toEqual({
      temperature: 12.4,
      humidity: 78,
      temperatureTime: '2026-07-07T09:00:00.000Z',
      humidityTime: '2026-07-07T09:00:30.000Z',
    });
    expect(calls.some((q) => q.includes('"device" = \'corn-watch-1\''))).toBe(true);
    expect(calls.some((q) => q.includes('outdoor-temperature'))).toBe(true);
    expect(calls.some((q) => q.includes('outdoor-humidity'))).toBe(true);
    expect(calls.every((q) => q.includes('now() - 1h'))).toBe(true);
    expect(calls.some((q) => q.includes('26w'))).toBe(false);
  });

  it('returns nulls when a measurement has no series', async () => {
    mockFetchWith(() => ({ results: [{}] }));

    const service = new InfluxDBService();
    const reading = await service.getOutdoorReading('corn-watch-1');

    expect(reading).toEqual({
      temperature: null,
      humidity: null,
      temperatureTime: null,
      humidityTime: null,
    });
  });
});
