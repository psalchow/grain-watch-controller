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
 * Builds the outdoor conditions from the two series the sink writes.
 *
 * Both figures come from one sensor; the sink splits them because it publishes
 * only the value that changed. An old humidity reading therefore means the
 * humidity has not moved, not that the measurement is missing — so the two are
 * combined whatever their ages, and the freshness of the pair follows the
 * *newer* timestamp, which is what shows the sensor is still reporting.
 *
 * The bound on how old a partner may get is `INFLUXDB_LATEST_LOOKBACK`: outside
 * that window the query finds nothing and the value is reported as missing.
 */
export function buildOutdoorConditions(
  reading: OutdoorReading,
  offlineThreshold: number,
): OutdoorConditions {
  const { temperature, humidity } = reading;

  const canDerive = temperature !== null && humidity !== null;

  const times = [reading.temperatureTime, reading.humidityTime].filter(
    (t): t is string => t !== null,
  );
  // One half gone from the look-back window entirely: there is no evidence the
  // sensor is alive, so the surviving half must not pass as current. Neither
  // present means the stock has no outdoor sensor at all — nothing to mark as
  // stale there.
  const onlyOnePresent = times.length === 1;

  // The newer of the two timestamps: it is the last time the sensor was heard
  // from, and that — not the age of the value that happened to stay constant —
  // is what decides whether the conditions are current.
  const lastMeasurement = times.reduce<string | null>(
    (newest, t) =>
      newest === null || new Date(t) > new Date(newest) ? t : newest,
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
