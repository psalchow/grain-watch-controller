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
}

// Grain Stocks
export interface GrainStock {
  id: string;
  name: string;
  description: string;
  deviceCount: number;
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
    top: number;
    mid: number;
    bottom: number;
  };
  humidity: number;
  batteryMV: number;
  lastMeasurement: string; // ISO 8601
}

export interface LatestReadingsResponse {
  stockId: string;
  stockName: string;
  timestamp: string; // ISO 8601
  devices: DeviceReading[];
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
