/**
 * Measurement-related type definitions for the grainwatch-controller BFF service.
 *
 * Defines types for temperature and humidity readings from grain stock sensors.
 */

/**
 * Temperature layer within a grain stock.
 * Each measurement spot has sensors at three vertical layers.
 */
export type Layer = 'top' | 'mid' | 'bottom';

/**
 * Temperature reading from a grain stock sensor.
 * Represents a single temperature measurement at a specific layer and time.
 */
export interface TemperatureReading {
  /** Measurement timestamp (ISO 8601 format) */
  timestamp: string;

  /** Grain stock identifier (e.g., 'corn-watch-1') */
  stockId: string;

  /** Vertical layer within the stock */
  layer: Layer;

  /** Temperature value in Celsius */
  temperature: number;

  /** Device identifier (e.g., '1.1') */
  deviceId: string;
}

/**
 * Aggregated temperature data point for API responses.
 * Used in time-series query results.
 */
export interface TemperatureDataPoint {
  /** Measurement timestamp (ISO 8601 format) */
  timestamp: string;

  /** Grain stock identifier */
  stockId: string;

  /** Temperature value in Celsius */
  value: number;

  /** Device identifier */
  deviceId: string;
}

/**
 * Humidity reading from a grain stock sensor.
 * Humidity is measured only at the middle layer.
 */
export interface HumidityReading {
  /** Measurement timestamp (ISO 8601 format) */
  timestamp: string;

  /** Grain stock identifier */
  stockId: string;

  /** Relative humidity percentage (0-100) */
  humidity: number;

  /** Temperature from the humidity sensor in Celsius */
  temperature: number;

  /** Device identifier */
  deviceId: string;
}

/**
 * Aggregated humidity data point for API responses.
 * Used in time-series query results.
 */
export interface HumidityDataPoint {
  /** Measurement timestamp (ISO 8601 format) */
  timestamp: string;

  /** Grain stock identifier */
  stockId: string;

  /** Relative humidity percentage (0-100) */
  humidity: number;

  /** Temperature from the humidity sensor in Celsius */
  temperature: number;

  /** Device identifier */
  deviceId: string;
}

/**
 * Raw measurement data as received from InfluxDB.
 * Contains all fields from a single device reading.
 */
export interface RawMeasurement {
  /** InfluxDB timestamp (ISO 8601 format) */
  timestamp: string;

  /** Device group / stock identifier (e.g., 'corn-watch-1') */
  deviceGroup: string;

  /** Device identifier (e.g., '1.1') */
  device: string;

  /** Temperature at top layer in Celsius */
  tempTop: number;

  /** Temperature at middle layer in Celsius */
  tempMid: number;

  /** Temperature at bottom layer in Celsius */
  tempBottom: number;

  /** Temperature from humidity sensor in Celsius */
  tempHumidity: number;

  /** Relative humidity percentage (0-100) */
  humidity: number;

  /** Battery voltage in centi-volts */
  batteryMV?: number;

  /** Actual measurement timestamp (Unix epoch seconds) */
  measurementTimeS?: number;
}
