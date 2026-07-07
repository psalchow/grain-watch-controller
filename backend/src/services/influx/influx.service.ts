/**
 * InfluxDB service for querying grain stock sensor data.
 *
 * Provides methods for retrieving temperature and humidity data
 * from the InfluxDB 2.x time-series database using InfluxQL queries via
 * the v1 compatibility API.
 */

import { config } from '../../config';

/**
 * Represents a single device's latest readings.
 */
export interface DeviceReading {
  /** Device identifier (e.g., '1.1') */
  device: string;

  /** Temperature at top layer in Celsius */
  tempTop: number | null;

  /** Temperature at middle layer in Celsius */
  tempMid: number | null;

  /** Temperature at bottom layer in Celsius */
  tempBottom: number | null;

  /** Relative humidity percentage (0-100) */
  humidity: number | null;

  /** Battery voltage in centi-volts */
  battery: number | null;

  /** Measurement timestamp (ISO 8601 format) */
  measurementTime: string | null;
}

/**
 * Latest outdoor reading for a device group.
 */
export interface OutdoorReading {
  /** Outdoor temperature in Celsius */
  temperature: number | null;

  /** Outdoor relative humidity percentage (0-100) */
  humidity: number | null;

  /** Temperature measurement timestamp (ISO 8601), or null */
  temperatureTime: string | null;

  /** Humidity measurement timestamp (ISO 8601), or null */
  humidityTime: string | null;
}

/** Single aggregated data point in a series. */
export interface SeriesPoint {
  /** ISO 8601 UTC timestamp of the bucket start. */
  t: string;
  /** Mean value in the bucket, or null if no data was recorded. */
  v: number | null;
}

/** Per-layer aggregated history readings keyed by device id. */
export interface HistoryReadings {
  temperature: {
    top: Map<string, SeriesPoint[]>;
    mid: Map<string, SeriesPoint[]>;
    bottom: Map<string, SeriesPoint[]>;
  };
  /** Present only when humidity was requested. */
  humidity?: Map<string, SeriesPoint[]>;
}

/**
 * InfluxDB query result interface.
 */
interface InfluxQueryResult {
  results: Array<{
    series?: Array<{
      name: string;
      columns: string[];
      values: Array<Array<string | number | null>>;
      tags?: Record<string, string>;
    }>;
  }>;
}

/**
 * InfluxDB service for querying grain stock measurement data.
 *
 * Uses InfluxDB 2.x with InfluxQL queries via the v1 compatibility API.
 * String values are escaped to prevent injection.
 */
export class InfluxDBService {
  private readonly url: string;
  private readonly token: string;
  private readonly bucket: string;
  private readonly measurement: string;
  private readonly outdoorTemperatureMeasurement: string;
  private readonly outdoorHumidityMeasurement: string;

  /**
   * Creates a new InfluxDB service instance.
   *
   * Connection configuration is read from the application config,
   * which derives values from environment variables.
   */
  constructor() {
    this.url = config.influxdb.url;
    this.token = config.influxdb.token;
    this.bucket = config.influxdb.bucket;
    this.measurement = config.influxdb.measurement;
    this.outdoorTemperatureMeasurement = config.influxdb.outdoorTemperatureMeasurement;
    this.outdoorHumidityMeasurement = config.influxdb.outdoorHumidityMeasurement;
  }

  /**
   * Executes an InfluxQL query using the v1 compatibility API.
   *
   * @param query - InfluxQL query string
   * @returns Query results
   */
  private async executeQuery(query: string): Promise<InfluxQueryResult> {
    const queryUrl = `${this.url}/query?db=${encodeURIComponent(this.bucket)}&q=${encodeURIComponent(query)}`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`InfluxDB query failed: ${response.statusText}`);
    }

    return await response.json() as InfluxQueryResult;
  }

  /**
   * Escapes a string value for use in InfluxQL queries.
   *
   * @param value - String value to escape
   * @returns Escaped string
   */
  private escapeString(value: string): string {
    return value.replace(/'/g, "\\'");
  }

  /**
   * Escapes a measurement name for use in InfluxQL queries.
   *
   * @param name - Measurement name to escape
   * @returns Escaped measurement name with quotes
   */
  private escapeMeasurement(name: string): string {
    return `"${name.replace(/"/g, '\\"')}"`;
  }

  /**
   * Retrieves the latest readings for all devices in a grain stock.
   *
   * Returns the most recent temperature, humidity, and battery values
   * for each device in the specified device group.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @returns Array of device readings, one per device
   *
   * @example
   * const readings = await influxService.getLatestReadings('corn-watch-1');
   * // Returns: [
   * //   { device: '1.1', tempTop: 10.5, tempMid: 11.2, tempBottom: 9.8, humidity: 85, battery: 436, measurementTime: '2026-01-16T09:00:00Z' },
   * //   { device: '1.2', tempTop: 10.8, ... },
   * //   ...
   * // ]
   */
  async getLatestReadings(deviceGroup: string): Promise<DeviceReading[]> {
    const escapedGroup = this.escapeString(deviceGroup);

    const query = `
      SELECT
        LAST("temp-top") AS "temp_top",
        LAST("temp-mid") AS "temp_mid",
        LAST("temp-bottom") AS "temp_bottom",
        LAST("humidity") AS "humidity",
        LAST("batteryMV") AS "battery",
        LAST("measurementTimeS") AS "measurement_time"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time > now() - 26w
      GROUP BY "device"
    `;

    const result = await this.executeQuery(query);
    const deviceMap = new Map<string, DeviceReading>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values || series.values.length === 0) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        const row = series.values[0];
        if (!row) continue;

        const measurementTimeS = row[columnMap.get('measurement_time') ?? -1] as number | null;

        deviceMap.set(device, {
          device,
          tempTop: (row[columnMap.get('temp_top') ?? -1] as number | null) ?? null,
          tempMid: (row[columnMap.get('temp_mid') ?? -1] as number | null) ?? null,
          tempBottom: (row[columnMap.get('temp_bottom') ?? -1] as number | null) ?? null,
          humidity: (row[columnMap.get('humidity') ?? -1] as number | null) ?? null,
          battery: (row[columnMap.get('battery') ?? -1] as number | null) ?? null,
          measurementTime: measurementTimeS
            ? new Date(measurementTimeS * 1000).toISOString()
            : null,
        });
      }
    }

    return Array.from(deviceMap.values());
  }

  /**
   * Retrieves the latest outdoor temperature and humidity for a device group.
   *
   * The two values live in separate measurements and are filtered by the
   * `device` tag. Each `LAST()` query returns the timestamp of the point in
   * its `time` column, which is used to report the reading age.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @returns Latest outdoor reading; individual values are null when absent
   */
  async getOutdoorReading(deviceGroup: string): Promise<OutdoorReading> {
    const escapedGroup = this.escapeString(deviceGroup);

    const buildQuery = (measurement: string, field: string): string => `
      SELECT LAST(${this.escapeMeasurement(field)}) AS "value"
      FROM ${this.escapeMeasurement(measurement)}
      WHERE "device" = '${escapedGroup}'
        AND time > now() - 26w
    `;

    const [tempResult, humidityResult] = await Promise.all([
      this.executeQuery(buildQuery(this.outdoorTemperatureMeasurement, 'temp')),
      this.executeQuery(buildQuery(this.outdoorHumidityMeasurement, 'humidity')),
    ]);

    const temp = this.parseLastPoint(tempResult);
    const humidity = this.parseLastPoint(humidityResult);

    return {
      temperature: temp.value,
      humidity: humidity.value,
      temperatureTime: temp.time,
      humidityTime: humidity.time,
    };
  }

  /**
   * Extracts the single value and timestamp from a `LAST()` query result.
   */
  private parseLastPoint(
    result: InfluxQueryResult,
  ): { value: number | null; time: string | null } {
    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        if (!series.values || series.values.length === 0) continue;

        const valueIdx = series.columns.indexOf('value');
        const timeIdx = series.columns.indexOf('time');
        const row = series.values[0];
        if (!row || valueIdx === -1) continue;

        const rawValue = row[valueIdx];
        const rawTime = timeIdx !== -1 ? row[timeIdx] : null;

        return {
          value: typeof rawValue === 'number' ? rawValue : null,
          time:
            rawTime != null ? new Date(rawTime as string).toISOString() : null,
        };
      }
    }

    return { value: null, time: null };
  }

  /**
   * Retrieves aggregated history for all devices in a stock.
   *
   * Runs one query per requested field in parallel. Each query
   * aggregates by the supplied interval, grouped by device, with
   * `fill(null)` to surface gaps.
   */
  async getHistory(
    deviceGroup: string,
    fromUtc: Date,
    toUtc: Date,
    intervalSeconds: number,
    includeHumidity: boolean,
  ): Promise<HistoryReadings> {
    const escapedGroup = this.escapeString(deviceGroup);
    const measurement = this.escapeMeasurement(this.measurement);
    const fromIso = fromUtc.toISOString();
    const toIso = toUtc.toISOString();
    const interval = `${intervalSeconds}s`;

    const buildQuery = (field: string): string => `
      SELECT MEAN(${this.escapeMeasurement(field)}) AS "mean"
      FROM ${measurement}
      WHERE "device-group" = '${escapedGroup}'
        AND time >= '${fromIso}'
        AND time <= '${toIso}'
      GROUP BY time(${interval}), "device" fill(null)
    `;

    const runLayer = (field: string): Promise<Map<string, SeriesPoint[]>> =>
      this.executeQuery(buildQuery(field)).then((r) =>
        this.parseHistorySeries(r),
      );

    const [top, mid, bottom, humidity] = await Promise.all([
      runLayer('temp-top'),
      runLayer('temp-mid'),
      runLayer('temp-bottom'),
      includeHumidity ? runLayer('humidity') : Promise.resolve(undefined),
    ] as const);

    const result: HistoryReadings = {
      temperature: { top, mid, bottom },
    };
    if (humidity) {
      result.humidity = humidity;
    }
    return result;
  }

  /** Transforms an Influx query result into a per-device map of points. */
  private parseHistorySeries(
    result: InfluxQueryResult,
  ): Map<string, SeriesPoint[]> {
    const out = new Map<string, SeriesPoint[]>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device) continue;

        const timeIdx = series.columns.indexOf('time');
        const meanIdx = series.columns.indexOf('mean');
        if (timeIdx === -1 || meanIdx === -1) continue;

        const points: SeriesPoint[] = (series.values ?? []).map((row) => {
          const rawTime = row[timeIdx];
          const rawValue = row[meanIdx];
          const t =
            typeof rawTime === 'string'
              ? new Date(rawTime).toISOString()
              : new Date(Number(rawTime)).toISOString();
          const v = typeof rawValue === 'number' ? rawValue : null;
          return { t, v };
        });

        out.set(device, points);
      }
    }

    return out;
  }

  /**
   * Tests the connection to InfluxDB.
   *
   * Attempts to ping the database and returns connection status.
   *
   * @returns True if connection is successful
   * @throws Error if connection fails
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try a simple query to test the connection
      const query = `SHOW MEASUREMENTS LIMIT 1`;
      await this.executeQuery(query);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to InfluxDB: ${message}`);
    }
  }
}
