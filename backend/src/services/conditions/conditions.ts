import { DeviceReading, OutdoorReading } from '../influx';
import { config } from '../../config';
import { parseDurationMs } from '../../utils/duration';
import { dewPoint, absoluteHumidity } from '../../utils/psychrometrics';

export interface OutdoorConditions {
  temperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  absoluteHumidity: number | null;
  lastMeasurement: string | null;
  /** True once the reading is older than the configured offline threshold. */
  offline: boolean;
  /**
   * Why the conditions count as offline: `'stale'` for an ageing reading,
   * `'partner-missing'` when one of the two measurements is absent entirely.
   * `null` whenever `offline` is false — the client must not re-derive this.
   */
  offlineReason: 'stale' | 'partner-missing' | null;
  /**
   * Why `dewPoint` and `absoluteHumidity` are absent, when the inputs alone do
   * not explain it. `'skew'` means the two measurement times lie further apart
   * than `INFLUXDB_OUTDOOR_MAX_SKEW`; `null` means there is nothing to explain.
   */
  derivedUnavailableReason: 'skew' | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Rounds a derived figure, or reports it as absent when the calculation did not
 * produce a finite number (0 % relative humidity drives the dew point to
 * -Infinity, which JSON would serialise as `null` anyway — just not on purpose).
 */
const finiteOrNull = (value: number): number | null =>
  Number.isFinite(value) ? round1(value) : null;

/**
 * Age beyond which a reading counts as offline, in milliseconds.
 *
 * Read per call so tests can swap the config; the value is validated as an
 * InfluxQL duration at startup, hence the fallback is never reached in practice.
 */
export const offlineAfterMs = (): number =>
  parseDurationMs(config.influxdb.offlineAfter) ?? Number.POSITIVE_INFINITY;

/**
 * Whether a reading counts as offline.
 *
 * Note the timestamp is the one the device reports, not the InfluxDB ingest
 * time that bounds the look-back window; a skewed device clock shifts the flag.
 */
export function isOffline(timestamp: string | null, threshold: number): boolean {
  return timestamp !== null && new Date(timestamp).getTime() < threshold;
}

/**
 * How far outdoor temperature and humidity may drift apart and still be
 * combined, in milliseconds.
 *
 * Configurable because the two measurements are published independently (on
 * change, plus a time-based refresh), so their cadences can diverge. Pairing
 * readings hours apart yields a plausible but wrong dew point.
 */
export const outdoorMaxSkewMs = (): number =>
  parseDurationMs(config.influxdb.outdoorMaxSkew) ?? Number.POSITIVE_INFINITY;

export function buildOutdoorConditions(
  reading: OutdoorReading,
  offlineThreshold: number,
): OutdoorConditions {
  const { temperature, humidity } = reading;

  // Dew point and absolute humidity only mean something when both inputs
  // describe roughly the same instant; the two measurements are queried
  // separately and can drift apart.
  const skewMs =
    reading.temperatureTime !== null && reading.humidityTime !== null
      ? Math.abs(
          new Date(reading.temperatureTime).getTime() -
            new Date(reading.humidityTime).getTime(),
        )
      : Number.POSITIVE_INFINITY;

  const inputsPresent = temperature !== null && humidity !== null;
  const withinSkew = skewMs <= outdoorMaxSkewMs();
  const canDerive = inputsPresent && withinSkew;

  const times = [reading.temperatureTime, reading.humidityTime].filter(
    (t): t is string => t !== null,
  );
  // A partner that dropped out of the look-back window entirely is worse than
  // one that is merely old, so it flags too. Neither present means the stock
  // has no outdoor sensor at all — nothing to mark as stale there.
  const onlyOnePresent = times.length === 1;

  // Temperature and humidity are queried separately, so their ages differ.
  // The reported age follows the older of the two, so a fresh value cannot mask
  // a stale partner. With one partner gone entirely the surviving timestamp is
  // reported — an age is more useful than none, and the null value itself tells
  // the reader which half is missing.
  const lastMeasurement = times.reduce<string | null>(
    (oldest, t) =>
      oldest === null || new Date(t) < new Date(oldest) ? t : oldest,
    null,
  );

  const stale = isOffline(lastMeasurement, offlineThreshold);

  return {
    temperature: temperature !== null ? round1(temperature) : null,
    humidity: humidity !== null ? Math.round(humidity) : null,
    dewPoint: canDerive ? finiteOrNull(dewPoint(temperature, humidity)) : null,
    absoluteHumidity: canDerive
      ? finiteOrNull(absoluteHumidity(temperature, humidity))
      : null,
    lastMeasurement,
    offline: onlyOnePresent || stale,
    offlineReason: onlyOnePresent ? 'partner-missing' : stale ? 'stale' : null,
    derivedUnavailableReason: inputsPresent && !withinSkew ? 'skew' : null,
  };
}

/**
 * Summarises the grain temperature readings into the two figures the
 * automation's control rule needs (design spec §4.1): the mean, which drives
 * ΔT, and the minimum, which the condensation guard compares the outdoor dew
 * point against — water condenses on the coldest surface the air meets, not on
 * an average.
 *
 * Both figures are derived from the same set of valid values: one `(device,
 * layer)` temperature is valid when it is a finite number, on a device whose
 * `measurementTime` is non-null and no older than `offlineThreshold`. The mean
 * and the minimum are computed over these values, not over devices — one live
 * probe among four dead ones is sparse evidence, not none.
 *
 * The freshness check is deliberately not `!isOffline(...)`: `isOffline`
 * answers `false` for a null timestamp, so a device that never reported would
 * read as fresh under that predicate — the opposite of what a valid reading
 * requires here.
 */
export function summariseGrain(
  readings: DeviceReading[],
  offlineThreshold: number,
): { meanC: number | null; minC: number | null; validValues: number } {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let validValues = 0;

  for (const reading of readings) {
    const fresh =
      reading.measurementTime !== null &&
      new Date(reading.measurementTime).getTime() >= offlineThreshold;
    if (!fresh) continue;

    for (const value of [reading.tempTop, reading.tempMid, reading.tempBottom]) {
      if (value === null || !Number.isFinite(value)) continue;
      sum += value;
      if (value < min) min = value;
      validValues += 1;
    }
  }

  return {
    meanC: validValues > 0 ? round1(sum / validValues) : null,
    minC: validValues > 0 ? round1(min) : null,
    validValues,
  };
}
