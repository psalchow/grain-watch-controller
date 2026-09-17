/**
 * API Types for Grainwatch Controller Backend
 * Based on ../grainwatch-controller/docs/design/API_DESIGN.md
 */

// Authentication
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresIn: string;
  user: User;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  stockAccess: string[]; // ['*'] for admin, specific stock IDs for viewers
  mustChangePassword?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// Admin user management
export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
  active: boolean;
  createdAt: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
}

export interface UpdatePermissionsRequest {
  role?: 'admin' | 'viewer';
  stockAccess?: string[];
}

// Grain Stocks
export interface GrainStock {
  id: string;
  name: string;
  description: string;
  deviceCount: number;
  /**
   * False for stocks with fan control only and no grain thermometers.
   * Optional: a cached response from a pre-upgrade backend omits it.
   */
  hasGrainSensors?: boolean;
  active: boolean;
}

export interface StocksResponse {
  stocks: GrainStock[];
  total: number;
}

// Latest Readings
export interface DeviceReading {
  device: string;
  temperature: {
    top: number | null;
    mid: number | null;
    bottom: number | null;
  };
  humidity: number | null;
  batteryMV: number | null;
  lastMeasurement: string | null; // ISO 8601
  /**
   * True once the reading is older than the configured offline threshold.
   * Optional: a cached response from a pre-upgrade backend omits it.
   */
  offline?: boolean;
}

export interface OutdoorConditions {
  temperature: number | null; // °C
  humidity: number | null; // %
  dewPoint: number | null; // °C
  absoluteHumidity: number | null; // g/m³
  lastMeasurement: string | null; // ISO 8601
  /**
   * True once the reading is older than the configured offline threshold.
   * Optional: a cached response from a pre-upgrade backend omits it.
   */
  offline?: boolean;
  /**
   * Why the derived values are absent when temperature and humidity are not.
   * 'skew' means the two measurement times lie too far apart.
   */
  derivedUnavailableReason?: 'skew' | null;
}

export interface LatestReadingsResponse {
  stockId: string;
  stockName: string;
  timestamp: string | null; // ISO 8601; null when no current readings exist
  devices: DeviceReading[];
  /**
   * False for stocks with fan control only and no grain thermometers.
   * Optional: a cached response from a pre-upgrade backend omits it.
   */
  hasGrainSensors?: boolean;
  outdoor: OutdoorConditions;
  fanControlEnabled?: boolean;
}

// Temperature/Humidity Time Series
export type Layer = 'top' | 'mid' | 'bottom';

export interface TimeSeriesDataPoint {
  timestamp: string; // ISO 8601
  device: string;
  value: number;
}

export interface TimeSeriesResponse {
  data: TimeSeriesDataPoint[];
  meta: {
    stockId: string;
    stockName: string;
    layer?: Layer;
    period: {
      start: string;
      end: string;
    };
    window: string;
    count: number;
  };
}

// Summary Statistics
export interface TemperatureSummary {
  min: number;
  max: number;
  avg: number;
  current: number;
}

export interface HumiditySummary {
  min: number;
  max: number;
  avg: number;
  current: number;
}

export interface DeviceStatus {
  device: string;
  batteryMV: number;
  batteryStatus: 'good' | 'low' | 'critical';
  lastSeen: string; // ISO 8601
}

export interface SummaryResponse {
  stockId: string;
  stockName: string;
  period: string;
  summary: {
    temperature: {
      top: TemperatureSummary;
      mid: TemperatureSummary;
      bottom: TemperatureSummary;
    };
    humidity: HumiditySummary;
  };
  deviceStatus: DeviceStatus[];
}

// Battery Status
export interface BatteryDevice {
  device: string;
  battery: number; // in Volts
  batteryStatus: 'good' | 'low' | 'critical';
  lastSeen: string; // ISO 8601
}

export interface BatteryAlert {
  device: string;
  message: string;
}

export interface BatteryResponse {
  stockId: string;
  stockName: string;
  devices: BatteryDevice[];
  alerts: BatteryAlert[];
}

// Error Response
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

// Stock History
export type Resolution = 'day' | 'week' | 'month' | 'year';

export interface SeriesPoint {
  /** ISO 8601 UTC timestamp at the bucket start. */
  t: string;
  /** Mean value or null if no data was recorded in the bucket. */
  v: number | null;
}

export interface StockHistoryResponse {
  stockId: string;
  stockName: string;
  resolution: Resolution;
  from: string; // ISO 8601 UTC
  to: string;   // ISO 8601 UTC
  intervalSeconds: number;
  devices: string[];
  series: {
    temperature: {
      top: SeriesPoint[][];
      mid: SeriesPoint[][];
      bottom: SeriesPoint[][];
    };
    humidity?: SeriesPoint[][];
  };
}
