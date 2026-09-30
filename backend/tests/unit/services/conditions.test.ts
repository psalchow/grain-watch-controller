import { summariseGrain } from '../../../src/services/conditions';
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
