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
