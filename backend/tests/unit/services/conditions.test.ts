import {
  buildOutdoorConditions,
  summariseGrain,
} from '../../../src/services/conditions';
import type { DeviceReading } from '../../../src/services/influx';

const THRESHOLD = new Date('2026-09-30T10:00:00.000Z').getTime();
const FRESH = '2026-09-30T10:30:00.000Z'; // after the threshold
const STALE = '2026-09-30T09:00:00.000Z'; // before the threshold

function reading(
  overrides: Partial<DeviceReading> & { device: string },
): DeviceReading {
  return {
    tempTop: null,
    tempMid: null,
    tempBottom: null,
    humidity: null,
    battery: null,
    measurementTime: FRESH,
    ...overrides,
  };
}

describe('buildOutdoorConditions', () => {
  // Both values come from one sensor; the sink splits them into two series
  // because it publishes only what changed. The newest of the two timestamps
  // therefore says whether the sensor is alive, and an old partner is a value
  // that did not change rather than a value that went missing.
  it('derives the dew point from a partner hours older than the fresh reading', () => {
    const result = buildOutdoorConditions(
      {
        temperature: 10,
        humidity: 80,
        temperatureTime: '2026-09-30T10:30:00.000Z',
        humidityTime: '2026-09-30T08:30:00.000Z',
      },
      THRESHOLD,
    );

    expect(result.dewPoint).toBeCloseTo(6.7, 1);
    expect(result.absoluteHumidity).not.toBeNull();
    expect(result.offline).toBe(false);
    expect(result.offlineReason).toBeNull();
  });

  it('reports the newest of the two timestamps as the last measurement', () => {
    const result = buildOutdoorConditions(
      {
        temperature: 10,
        humidity: 80,
        temperatureTime: '2026-09-30T10:30:00.000Z',
        humidityTime: '2026-09-30T08:30:00.000Z',
      },
      THRESHOLD,
    );

    expect(result.lastMeasurement).toBe('2026-09-30T10:30:00.000Z');
  });

  it('counts as offline once the newer of the two readings has aged out', () => {
    const result = buildOutdoorConditions(
      {
        temperature: 10,
        humidity: 80,
        temperatureTime: '2026-09-30T09:30:00.000Z',
        humidityTime: '2026-09-30T08:30:00.000Z',
      },
      THRESHOLD,
    );

    expect(result.offline).toBe(true);
    expect(result.offlineReason).toBe('stale');
    expect(result.lastMeasurement).toBe('2026-09-30T09:30:00.000Z');
  });

  it('counts as offline when one of the two measurements is absent entirely', () => {
    // Outside the look-back window the sink has nothing to pair: with one half
    // gone there is no evidence the sensor is alive, whatever the other says.
    const result = buildOutdoorConditions(
      {
        temperature: 10,
        humidity: null,
        temperatureTime: FRESH,
        humidityTime: null,
      },
      THRESHOLD,
    );

    expect(result.offline).toBe(true);
    expect(result.offlineReason).toBe('partner-missing');
    expect(result.dewPoint).toBeNull();
  });

  it('reports no derived values and no offline flag for a stock without an outdoor sensor', () => {
    const result = buildOutdoorConditions(
      {
        temperature: null,
        humidity: null,
        temperatureTime: null,
        humidityTime: null,
      },
      THRESHOLD,
    );

    expect(result).toEqual({
      temperature: null,
      humidity: null,
      dewPoint: null,
      absoluteHumidity: null,
      lastMeasurement: null,
      offline: false,
      offlineReason: null,
    });
  });
});

describe('summariseGrain', () => {
  it('averages the three layers of one fresh device', () => {
    const result = summariseGrain(
      [reading({ device: '1.1', tempTop: 10, tempMid: 12, tempBottom: 14 })],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: 12, minC: 10, validValues: 3 });
  });

  it('excludes a null layer value from the mean, the minimum and the count', () => {
    const result = summariseGrain(
      [reading({ device: '1.1', tempTop: 10, tempMid: null, tempBottom: 14 })],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: 12, minC: 10, validValues: 2 });
  });

  it('contributes nothing from a device whose measurementTime is older than the threshold', () => {
    const result = summariseGrain(
      [
        reading({
          device: '1.1',
          tempTop: 10,
          tempMid: 12,
          tempBottom: 14,
          measurementTime: STALE,
        }),
      ],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: null, minC: null, validValues: 0 });
  });

  it('contributes nothing from a device whose measurementTime is null', () => {
    // Trap: isOffline(null, threshold) answers false -- "not offline" -- so a
    // validity check built on !isOffline(...) would count this device as
    // measured. summariseGrain must reject it explicitly instead.
    const result = summariseGrain(
      [
        reading({
          device: '1.1',
          tempTop: 10,
          tempMid: 12,
          tempBottom: 14,
          measurementTime: null,
        }),
      ],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: null, minC: null, validValues: 0 });
  });

  it('returns nulls and a zero count for an empty list', () => {
    expect(summariseGrain([], THRESHOLD)).toEqual({
      meanC: null,
      minC: null,
      validValues: 0,
    });
  });

  it('returns nulls and a zero count when every device is invalid', () => {
    const result = summariseGrain(
      [
        reading({ device: '1.1', tempTop: null, tempMid: null, tempBottom: null }),
        reading({
          device: '1.2',
          measurementTime: STALE,
          tempTop: 5,
          tempMid: 5,
          tempBottom: 5,
        }),
      ],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: null, minC: null, validValues: 0 });
  });

  it('takes the minimum from the coldest single layer, not the coldest device average', () => {
    // Device 1.1 averages colder (4) than 1.2 (7), but 1.2 holds the single
    // coldest layer (1). The minimum must be 1, not 2 (1.1's own minimum).
    const result = summariseGrain(
      [
        reading({ device: '1.1', tempTop: 2, tempMid: 4, tempBottom: 6 }),
        reading({ device: '1.2', tempTop: 1, tempMid: 9, tempBottom: 11 }),
      ],
      THRESHOLD,
    );
    expect(result).toEqual({ meanC: 5.5, minC: 1, validValues: 6 });
  });
});
