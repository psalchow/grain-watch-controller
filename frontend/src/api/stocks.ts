import axios from './client';
import {
  StocksResponse,
  LatestReadingsResponse,
  TimeSeriesResponse,
  SummaryResponse,
  BatteryResponse,
  Layer,
} from '../types/api';

/**
 * Grain Stocks API
 */
export const stocksApi = {
  /**
   * Get all stocks accessible to the user
   */
  async getStocks(): Promise<StocksResponse> {
    const response = await axios.get<StocksResponse>('/stocks');
    return response.data;
  },

  /**
   * Get latest readings for a stock
   */
  async getLatestReadings(stockId: string): Promise<LatestReadingsResponse> {
    const response = await axios.get<LatestReadingsResponse>(
      `/stocks/${stockId}/latest`
    );
    return response.data;
  },

  /**
   * Get temperature time series
   */
  async getTemperature(
    stockId: string,
    params: {
      start: string; // ISO 8601
      end: string; // ISO 8601
      layer?: Layer;
      device?: string;
      window?: string; // e.g., '15m', '1h', '1d'
    }
  ): Promise<TimeSeriesResponse> {
    const response = await axios.get<TimeSeriesResponse>(
      `/stocks/${stockId}/temperature`,
      { params }
    );
    return response.data;
  },

  /**
   * Get humidity time series
   */
  async getHumidity(
    stockId: string,
    params: {
      start: string; // ISO 8601
      end: string; // ISO 8601
      device?: string;
      window?: string;
    }
  ): Promise<TimeSeriesResponse> {
    const response = await axios.get<TimeSeriesResponse>(
      `/stocks/${stockId}/humidity`,
      { params }
    );
    return response.data;
  },

  /**
   * Get summary statistics
   */
  async getSummary(
    stockId: string,
    params?: {
      period?: '24h' | '7d' | '30d';
      layer?: Layer;
    }
  ): Promise<SummaryResponse> {
    const response = await axios.get<SummaryResponse>(
      `/stocks/${stockId}/summary`,
      { params }
    );
    return response.data;
  },

  /**
   * Get battery status
   */
  async getBatteryStatus(stockId: string): Promise<BatteryResponse> {
    const response = await axios.get<BatteryResponse>(
      `/stocks/${stockId}/battery`
    );
    return response.data;
  },
};
