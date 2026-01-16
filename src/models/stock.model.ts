/**
 * Grain stock-related type definitions for the grainwatch-controller BFF service.
 *
 * Defines types for grain storage facilities and their measurement devices.
 */

/**
 * Grain stock (storage facility) entity.
 * Represents a single grain storage location with multiple measurement spots.
 */
export interface GrainStock {
  /** Unique stock identifier (e.g., 'corn-watch-1', 'corn-watch-2') */
  id: string;

  /** Human-readable name (e.g., 'Wheat Storage A') */
  name: string;

  /** Optional description of the stock */
  description?: string;

  /** Whether the stock is currently active and being monitored */
  active: boolean;

  /** Stock creation timestamp (ISO 8601 format) */
  createdAt: string;
}

/**
 * Device identifier for a measurement spot.
 * Format: '{device-group-number}.{spot-number}' (e.g., '1.1', '1.2')
 */
export type DeviceId = string;

/**
 * Device group identifier matching the stock.
 * Examples: 'corn-watch-1', 'corn-watch-2'
 */
export type DeviceGroup = string;

/**
 * Spot number within a grain stock (1-5).
 * Each stock has 5 measurement spots.
 */
export type SpotNumber = 1 | 2 | 3 | 4 | 5;
