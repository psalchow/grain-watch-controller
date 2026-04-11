/**
 * InfluxDB service for querying grain stock sensor data.
 *
 * Provides methods for retrieving temperature, humidity, and device status
 * from the InfluxDB 2.x time-series database using InfluxQL queries via
 * the v1 compatibility API.
 */

import { config } from '../../config';
import { Layer } from '../../models';

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
 * Represents a time-series data point for temperature or humidity.
 */
export interface TimeSeriesPoint {
  /** Timestamp (ISO 8601 format) */
  time: string;

  /** Device identifier */
  device: string;

  /** Measurement value */
  value: number | null;
}

/**
 * Represents summary statistics for a measurement.
 */
export interface SummaryStats {
  /** Device identifier */
  device: string;

  /** Minimum value in the period */
  min: number | null;

  /** Maximum value in the period */
  max: number | null;

  /** Mean value in the period */
  avg: number | null;

  /** Current (latest) value */
  current: number | null;
}

/**
 * Represents battery status for a device.
 */
export interface BatteryStatus {
  /** Device identifier */
  device: string;

  /** Battery voltage in centi-volts */
  battery: number | null;
}

/**
 * Valid window durations for time-series aggregation.
 */
export type WindowDuration = '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '12h' | '1d';

/**
 * Validates that a string is a valid window duration.
 *
 * @param duration - Duration string to validate
 * @returns True if valid, false otherwise
 */
export function isValidWindowDuration(duration: string): duration is WindowDuration {
  return ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'].includes(duration);
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
   * Validates that a layer value is valid.
   *
   * @param layer - Layer value to validate
   * @throws Error if layer is invalid
   */
  private validateLayer(layer: string): asserts layer is Layer {
    if (!['top', 'mid', 'bottom'].includes(layer)) {
      throw new Error(`Invalid layer: ${layer}. Must be 'top', 'mid', or 'bottom'`);
    }
  }

  /**
   * Validates that a time string is in ISO 8601 format.
   *
   * @param time - Time string to validate
   * @param paramName - Parameter name for error messages
   * @throws Error if time format is invalid
   */
  private validateTimeFormat(time: string, paramName: string): void {
    const date = new Date(time);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid ${paramName}: ${time}. Must be a valid ISO 8601 timestamp`);
    }
  }

  /**
   * Validates window duration format.
   *
   * @param duration - Duration string to validate
   * @throws Error if duration format is invalid
   */
  private validateWindowDuration(duration: string): void {
    if (!isValidWindowDuration(duration)) {
      throw new Error(
        `Invalid window duration: ${duration}. Must be one of: 1m, 5m, 15m, 30m, 1h, 6h, 12h, 1d`
      );
    }
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
        AND time > now() - 1h
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
   * Retrieves temperature time-series data for a specific layer.
   *
   * Returns mean temperature values aggregated over the specified window duration,
   * grouped by device.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @param layer - Temperature layer ('top', 'mid', or 'bottom')
   * @param startTime - Start of time range (ISO 8601 format)
   * @param endTime - End of time range (ISO 8601 format)
   * @param windowDuration - Aggregation window (default: '15m')
   * @returns Array of time-series data points
   *
   * @example
   * const data = await influxService.getTemperatureTimeSeries(
   *   'corn-watch-1',
   *   'top',
   *   '2026-01-15T00:00:00Z',
   *   '2026-01-16T00:00:00Z',
   *   '1h'
   * );
   */
  async getTemperatureTimeSeries(
    deviceGroup: string,
    layer: Layer,
    startTime: string,
    endTime: string,
    windowDuration: WindowDuration = '15m'
  ): Promise<TimeSeriesPoint[]> {
    this.validateLayer(layer);
    this.validateTimeFormat(startTime, 'startTime');
    this.validateTimeFormat(endTime, 'endTime');
    this.validateWindowDuration(windowDuration);

    const escapedGroup = this.escapeString(deviceGroup);
    const field = `temp-${layer}`;

    const query = `
      SELECT mean("${field}") AS "value"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time >= '${startTime}'
        AND time <= '${endTime}'
      GROUP BY time(${windowDuration}), "device"
      FILL(null)
    `;

    const result = await this.executeQuery(query);
    const points: TimeSeriesPoint[] = [];

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        for (const row of series.values) {
          const time = row[columnMap.get('time') ?? -1];
          const value = row[columnMap.get('value') ?? -1] as number | null;

          if (time) {
            points.push({
              time: new Date(time).toISOString(),
              device,
              value: value ?? null,
            });
          }
        }
      }
    }

    return points;
  }

  /**
   * Retrieves humidity time-series data.
   *
   * Returns mean humidity values aggregated over the specified window duration,
   * grouped by device. Humidity is measured at the middle layer only.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @param startTime - Start of time range (ISO 8601 format)
   * @param endTime - End of time range (ISO 8601 format)
   * @param windowDuration - Aggregation window (default: '15m')
   * @returns Array of time-series data points
   *
   * @example
   * const data = await influxService.getHumidityTimeSeries(
   *   'corn-watch-1',
   *   '2026-01-15T00:00:00Z',
   *   '2026-01-16T00:00:00Z',
   *   '1h'
   * );
   */
  async getHumidityTimeSeries(
    deviceGroup: string,
    startTime: string,
    endTime: string,
    windowDuration: WindowDuration = '15m'
  ): Promise<TimeSeriesPoint[]> {
    this.validateTimeFormat(startTime, 'startTime');
    this.validateTimeFormat(endTime, 'endTime');
    this.validateWindowDuration(windowDuration);

    const escapedGroup = this.escapeString(deviceGroup);

    const query = `
      SELECT mean("humidity") AS "value"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time >= '${startTime}'
        AND time <= '${endTime}'
      GROUP BY time(${windowDuration}), "device"
      FILL(null)
    `;

    const result = await this.executeQuery(query);
    const points: TimeSeriesPoint[] = [];

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        for (const row of series.values) {
          const time = row[columnMap.get('time') ?? -1];
          const value = row[columnMap.get('value') ?? -1] as number | null;

          if (time) {
            points.push({
              time: new Date(time).toISOString(),
              device,
              value: value ?? null,
            });
          }
        }
      }
    }

    return points;
  }

  /**
   * Retrieves all available device groups (grain stocks).
   *
   * Returns a list of unique device group identifiers found in the database.
   *
   * @returns Array of device group identifiers
   *
   * @example
   * const stocks = await influxService.getDeviceGroups();
   * // Returns: ['corn-watch-1', 'corn-watch-2']
   */
  async getDeviceGroups(): Promise<string[]> {
    const query = `SHOW TAG VALUES FROM ${this.escapeMeasurement(this.measurement)} WITH KEY = "device-group"`;

    const result = await this.executeQuery(query);
    const groups: string[] = [];

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        if (!series.values) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        for (const row of series.values) {
          const value = row[columnMap.get('value') ?? -1];
          if (typeof value === 'string') {
            groups.push(value);
          }
        }
      }
    }

    return groups;
  }

  /**
   * Retrieves summary statistics for a temperature layer.
   *
   * Returns min, max, mean, and current values for the specified time period,
   * grouped by device.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @param layer - Temperature layer ('top', 'mid', or 'bottom')
   * @param hours - Number of hours to look back (default: 24)
   * @returns Array of summary statistics, one per device
   *
   * @example
   * const stats = await influxService.getSummaryStats('corn-watch-1', 'top', 24);
   * // Returns: [
   * //   { device: '1.1', min: 8.5, max: 12.3, avg: 10.2, current: 10.5 },
   * //   { device: '1.2', min: 8.8, ... },
   * //   ...
   * // ]
   */
  async getSummaryStats(
    deviceGroup: string,
    layer: Layer,
    hours: number = 24
  ): Promise<SummaryStats[]> {
    this.validateLayer(layer);

    if (hours < 1 || hours > 8760) {
      throw new Error(`Invalid hours: ${hours}. Must be between 1 and 8760 (1 year)`);
    }

    const escapedGroup = this.escapeString(deviceGroup);
    const field = `temp-${layer}`;

    const query = `
      SELECT
        MIN("${field}") AS "min",
        MAX("${field}") AS "max",
        MEAN("${field}") AS "avg",
        LAST("${field}") AS "current"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time >= now() - ${hours}h
      GROUP BY "device"
    `;

    const result = await this.executeQuery(query);
    const deviceMap = new Map<string, SummaryStats>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values || series.values.length === 0) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        const row = series.values[0];
        if (!row) continue;

        deviceMap.set(device, {
          device,
          min: (row[columnMap.get('min') ?? -1] as number | null) ?? null,
          max: (row[columnMap.get('max') ?? -1] as number | null) ?? null,
          avg: (row[columnMap.get('avg') ?? -1] as number | null) ?? null,
          current: (row[columnMap.get('current') ?? -1] as number | null) ?? null,
        });
      }
    }

    return Array.from(deviceMap.values());
  }

  /**
   * Retrieves battery status for all devices in a grain stock.
   *
   * Returns the latest battery voltage for each device.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @returns Array of battery status entries, one per device
   *
   * @example
   * const batteries = await influxService.getBatteryStatus('corn-watch-1');
   * // Returns: [
   * //   { device: '1.1', battery: 436 },
   * //   { device: '1.2', battery: 428 },
   * //   ...
   * // ]
   */
  async getBatteryStatus(deviceGroup: string): Promise<BatteryStatus[]> {
    const escapedGroup = this.escapeString(deviceGroup);

    const query = `
      SELECT LAST("batteryMV") AS "battery"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time > now() - 1h
      GROUP BY "device"
    `;

    const result = await this.executeQuery(query);
    const deviceMap = new Map<string, BatteryStatus>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values || series.values.length === 0) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        const row = series.values[0];
        if (!row) continue;

        deviceMap.set(device, {
          device,
          battery: (row[columnMap.get('battery') ?? -1] as number | null) ?? null,
        });
      }
    }

    return Array.from(deviceMap.values());
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
