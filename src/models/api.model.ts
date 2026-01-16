/**
 * API response type definitions for the grainwatch-controller BFF service.
 *
 * Defines standardised response structures for all API endpoints.
 */

import { GrainStock } from './stock.model';
import { TemperatureDataPoint } from './measurement.model';

/**
 * Stock list API response.
 * Returns all stocks accessible to the authenticated user.
 */
export interface StockListResponse {
  /** Array of grain stocks */
  stocks: GrainStock[];

  /** Total number of stocks returned */
  total: number;
}

/**
 * Time period for query metadata.
 */
export interface QueryPeriod {
  /** Start timestamp (ISO 8601 format) */
  start: string;

  /** End timestamp (ISO 8601 format) */
  end: string;
}

/**
 * Metadata for temperature query responses.
 */
export interface TemperatureQueryMeta {
  /** Stock identifier */
  stockId: string;

  /** Stock display name */
  stockName: string;

  /** Temperature layer filter (if applied) */
  layer?: string;

  /** Device filter (if applied) */
  deviceId?: string;

  /** Time period of the query */
  period: QueryPeriod;

  /** Number of data points returned */
  count: number;
}

/**
 * Temperature query API response.
 * Returns time-series temperature data for a specific stock.
 */
export interface TemperatureQueryResponse {
  /** Array of temperature data points */
  data: TemperatureDataPoint[];

  /** Query metadata */
  meta: TemperatureQueryMeta;
}

/**
 * Temperature readings organised by layer.
 * Each array contains 5 values (one per measurement spot).
 */
export interface LayeredTemperatures {
  /** Bottom layer temperatures (5 values) */
  bottom: number[];

  /** Middle layer temperatures (5 values) */
  mid: number[];

  /** Top layer temperatures (5 values) */
  top: number[];
}

/**
 * Latest readings API response.
 * Returns the most recent measurements for a specific stock.
 */
export interface LatestReadingsResponse {
  /** Stock identifier */
  stockId: string;

  /** Stock display name */
  stockName: string;

  /** Timestamp of the readings (ISO 8601 format) */
  timestamp: string;

  /** Temperature readings organised by layer */
  temperature: LayeredTemperatures;

  /** Humidity readings from all 5 spots (middle layer only) */
  humidity: number[];
}

/**
 * Standard error response structure.
 */
export interface ErrorResponse {
  /** HTTP status code */
  statusCode: number;

  /** Error message */
  message: string;

  /** Error code for client-side handling */
  error?: string;

  /** Additional error details (development mode only) */
  details?: unknown;

  /** Request timestamp (ISO 8601 format) */
  timestamp: string;

  /** Request path */
  path?: string;
}

/**
 * Generic API success response wrapper.
 * Use for simple success/failure responses.
 */
export interface ApiResponse<T = void> {
  /** Indicates successful operation */
  success: boolean;

  /** Optional response data */
  data?: T;

  /** Optional message */
  message?: string;
}

/**
 * Paginated response wrapper.
 * Use for endpoints that support pagination.
 */
export interface PaginatedResponse<T> {
  /** Array of items */
  items: T[];

  /** Pagination metadata */
  pagination: {
    /** Current page number (1-indexed) */
    page: number;

    /** Items per page */
    limit: number;

    /** Total number of items */
    total: number;

    /** Total number of pages */
    totalPages: number;

    /** Whether there is a next page */
    hasNext: boolean;

    /** Whether there is a previous page */
    hasPrevious: boolean;
  };
}

/**
 * Authentication token response.
 */
export interface AuthTokenResponse {
  /** JWT access token */
  accessToken: string;

  /** Token type (always 'Bearer') */
  tokenType: 'Bearer';

  /** Token expiry time in seconds */
  expiresIn: number;
}
