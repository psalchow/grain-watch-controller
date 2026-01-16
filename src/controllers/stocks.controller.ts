/**
 * Stocks controller for handling grain stock data queries.
 *
 * Provides request handlers for retrieving stock information,
 * temperature, humidity, and battery data from InfluxDB.
 * All handlers are thin and delegate data retrieval to the InfluxDBService.
 */

import { Request, Response, NextFunction } from 'express';
import {
  InfluxDBService,
  WindowDuration,
  isValidWindowDuration,
} from '../services/influx';
import { StockQueryParams, NotFoundError } from '../middleware';
import { Layer } from '../models';

/**
 * Stock metadata configuration.
 *
 * Maps stock IDs to their display names and descriptions.
 * In a production environment, this would likely come from a database.
 */
interface StockMetadata {
  name: string;
  description: string;
  deviceCount: number;
}

/**
 * Default stock metadata for known stocks.
 */
const STOCK_METADATA: Record<string, StockMetadata> = {
  'corn-watch-1': {
    name: 'Grain Stock 1',
    description: 'Main storage facility',
    deviceCount: 5,
  },
  'corn-watch-2': {
    name: 'Grain Stock 2',
    description: 'Secondary storage',
    deviceCount: 5,
  },
};

/**
 * Battery voltage thresholds in centi-volts.
 */
const BATTERY_THRESHOLDS = {
  GOOD: 370, // > 3.70V
  LOW: 340,  // 3.40-3.70V
  // < 3.40V is critical
};

/**
 * Period mapping from API values to hours.
 */
const PERIOD_TO_HOURS: Record<string, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

/**
 * Controller class for stock-related endpoints.
 *
 * Handles queries for stock listings, latest readings, time-series data,
 * summaries, and battery status.
 */
export class StocksController {
  private readonly influxService: InfluxDBService;

  /**
   * Creates a new StocksController instance.
   *
   * @param influxService - InfluxDBService instance for data retrieval
   */
  constructor(influxService: InfluxDBService) {
    this.influxService = influxService;
  }

  /**
   * Lists all grain stocks accessible to the authenticated user.
   *
   * GET /api/v1/stocks
   *
   * Admins see all stocks, viewers see only their assigned stocks.
   *
   * @param req - Express request with authenticated user
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async listStocks(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      // Get all available device groups from InfluxDB
      const deviceGroups = await this.influxService.getDeviceGroups();

      // Filter based on user permissions
      const accessibleStocks = deviceGroups.filter((stockId) => {
        if (user.stockAccess.includes('*')) {
          return true;
        }
        return user.stockAccess.includes(stockId);
      });

      // Build response with metadata
      const stocks = accessibleStocks.map((stockId) => {
        const metadata = STOCK_METADATA[stockId];
        return {
          id: stockId,
          name: metadata?.name ?? stockId,
          description: metadata?.description ?? '',
          deviceCount: metadata?.deviceCount ?? 5,
          active: true,
        };
      });

      res.status(200).json({
        stocks,
        total: stocks.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets the most recent readings for all devices in a grain stock.
   *
   * GET /api/v1/stocks/:stockId/latest
   *
   * @param req - Express request with stockId parameter
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async getLatestReadings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;

      const readings = await this.influxService.getLatestReadings(stockId);

      if (readings.length === 0) {
        throw new NotFoundError(`No readings found for stock: ${stockId}`);
      }

      // Find the most recent timestamp across all devices
      const latestTimestamp = readings.reduce((latest, reading) => {
        if (!reading.measurementTime) return latest;
        if (!latest) return reading.measurementTime;
        return new Date(reading.measurementTime) > new Date(latest)
          ? reading.measurementTime
          : latest;
      }, null as string | null);

      const metadata = STOCK_METADATA[stockId];

      const devices = readings.map((reading) => ({
        device: reading.device,
        temperature: {
          top: reading.tempTop,
          mid: reading.tempMid,
          bottom: reading.tempBottom,
        },
        humidity: reading.humidity,
        batteryMV: reading.battery,
        lastMeasurement: reading.measurementTime,
      }));

      res.status(200).json({
        stockId,
        stockName: metadata?.name ?? stockId,
        timestamp: latestTimestamp ?? new Date().toISOString(),
        devices,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets temperature time-series data for a stock.
   *
   * GET /api/v1/stocks/:stockId/temperature
   *
   * Query parameters:
   * - start (required): ISO 8601 timestamp
   * - end (required): ISO 8601 timestamp
   * - layer (optional): 'top', 'mid', or 'bottom'
   * - device (optional): Specific device ID
   * - window (optional): Aggregation window (default: '15m')
   *
   * @param req - Express request with stockId and query parameters
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async getTemperatureData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const { start, end, layer, device, window: windowParam } = req.query as StockQueryParams;

      // Validate required parameters
      if (!start || !end) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Missing required parameters',
            details: 'Both start and end query parameters are required',
          },
        });
        return;
      }

      // Validate and normalise window parameter
      const window: WindowDuration = windowParam && isValidWindowDuration(windowParam)
        ? windowParam
        : '15m';

      const metadata = STOCK_METADATA[stockId];
      let allData: Array<{ timestamp: string; device: string; value: number | null }> = [];

      // If layer is specified, query only that layer; otherwise query all layers
      const layersToQuery: Layer[] = layer
        ? [layer as Layer]
        : ['top', 'mid', 'bottom'];

      for (const queryLayer of layersToQuery) {
        const points = await this.influxService.getTemperatureTimeSeries(
          stockId,
          queryLayer,
          start,
          end,
          window
        );

        // Filter by device if specified
        const filteredPoints = device
          ? points.filter((p) => p.device === device)
          : points;

        // Transform points to response format
        const transformedPoints = filteredPoints.map((point) => ({
          timestamp: point.time,
          device: point.device,
          value: point.value,
          layer: queryLayer,
        }));

        allData = allData.concat(transformedPoints);
      }

      // Sort by timestamp
      allData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.status(200).json({
        data: allData,
        meta: {
          stockId,
          stockName: metadata?.name ?? stockId,
          layer: layer ?? undefined,
          period: {
            start,
            end,
          },
          window,
          count: allData.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets humidity time-series data for a stock.
   *
   * GET /api/v1/stocks/:stockId/humidity
   *
   * Query parameters:
   * - start (required): ISO 8601 timestamp
   * - end (required): ISO 8601 timestamp
   * - device (optional): Specific device ID
   * - window (optional): Aggregation window (default: '15m')
   *
   * @param req - Express request with stockId and query parameters
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async getHumidityData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const { start, end, device, window: windowParam } = req.query as StockQueryParams;

      // Validate required parameters
      if (!start || !end) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Missing required parameters',
            details: 'Both start and end query parameters are required',
          },
        });
        return;
      }

      // Validate and normalise window parameter
      const window: WindowDuration = windowParam && isValidWindowDuration(windowParam)
        ? windowParam
        : '15m';

      const metadata = STOCK_METADATA[stockId];

      const points = await this.influxService.getHumidityTimeSeries(
        stockId,
        start,
        end,
        window
      );

      // Filter by device if specified
      const filteredPoints = device
        ? points.filter((p) => p.device === device)
        : points;

      // Transform points to response format
      const data = filteredPoints.map((point) => ({
        timestamp: point.time,
        device: point.device,
        value: point.value,
      }));

      // Sort by timestamp
      data.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.status(200).json({
        data,
        meta: {
          stockId,
          stockName: metadata?.name ?? stockId,
          period: {
            start,
            end,
          },
          window,
          count: data.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets aggregated statistics for a stock over a time period.
   *
   * GET /api/v1/stocks/:stockId/summary
   *
   * Query parameters:
   * - period (optional): '24h', '7d', or '30d' (default: '24h')
   * - layer (optional): 'top', 'mid', or 'bottom' (default: all)
   *
   * @param req - Express request with stockId and query parameters
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async getSummary(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const query = req.query as { period?: string; layer?: string };
      const { period = '24h', layer } = query;

      // Validate period
      const hours = PERIOD_TO_HOURS[period];
      if (!hours) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid period parameter',
            details: "Period must be one of: '24h', '7d', '30d'",
          },
        });
        return;
      }

      const metadata = STOCK_METADATA[stockId];

      // Get temperature stats for each layer
      const layersToQuery: Layer[] = layer
        ? [layer as Layer]
        : ['top', 'mid', 'bottom'];

      const temperatureStats: Record<string, {
        min: number | null;
        max: number | null;
        avg: number | null;
        current: number | null;
      }> = {};

      for (const queryLayer of layersToQuery) {
        const stats = await this.influxService.getSummaryStats(stockId, queryLayer, hours);

        // Aggregate across all devices
        if (stats.length > 0) {
          const validStats = stats.filter((s) =>
            s.min !== null && s.max !== null && s.avg !== null
          );

          if (validStats.length > 0) {
            const allMin = validStats.map((s) => s.min).filter((v): v is number => v !== null);
            const allMax = validStats.map((s) => s.max).filter((v): v is number => v !== null);
            const allAvg = validStats.map((s) => s.avg).filter((v): v is number => v !== null);
            const allCurrent = validStats.map((s) => s.current).filter((v): v is number => v !== null);

            temperatureStats[queryLayer] = {
              min: allMin.length > 0 ? Math.min(...allMin) : null,
              max: allMax.length > 0 ? Math.max(...allMax) : null,
              avg: allAvg.length > 0
                ? Math.round((allAvg.reduce((a, b) => a + b, 0) / allAvg.length) * 100) / 100
                : null,
              current: allCurrent.length > 0
                ? Math.round((allCurrent.reduce((a, b) => a + b, 0) / allCurrent.length) * 100) / 100
                : null,
            };
          }
        }
      }

      // Get latest readings for humidity and device status
      const latestReadings = await this.influxService.getLatestReadings(stockId);

      // Calculate humidity stats
      const humidityValues = latestReadings
        .map((r) => r.humidity)
        .filter((v): v is number => v !== null);

      const humidityStats = humidityValues.length > 0
        ? {
          min: Math.min(...humidityValues),
          max: Math.max(...humidityValues),
          avg: Math.round(humidityValues.reduce((a, b) => a + b, 0) / humidityValues.length),
          current: Math.round(humidityValues.reduce((a, b) => a + b, 0) / humidityValues.length),
        }
        : { min: null, max: null, avg: null, current: null };

      // Build device status
      const deviceStatus = latestReadings.map((reading) => ({
        device: reading.device,
        batteryMV: reading.battery,
        batteryStatus: this.determineBatteryStatus(reading.battery),
        lastSeen: reading.measurementTime,
      }));

      res.status(200).json({
        stockId,
        stockName: metadata?.name ?? stockId,
        period,
        summary: {
          temperature: temperatureStats,
          humidity: humidityStats,
        },
        deviceStatus,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets battery status for all devices in a stock.
   *
   * GET /api/v1/stocks/:stockId/battery
   *
   * @param req - Express request with stockId parameter
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async getBatteryData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;

      const batteryData = await this.influxService.getBatteryStatus(stockId);
      const latestReadings = await this.influxService.getLatestReadings(stockId);

      const metadata = STOCK_METADATA[stockId];

      // Build device battery info with last seen timestamps
      const devices = batteryData.map((battery) => {
        const reading = latestReadings.find((r) => r.device === battery.device);
        const batteryVoltage = battery.battery !== null
          ? battery.battery / 100  // Convert centi-volts to volts
          : null;

        return {
          device: battery.device,
          battery: batteryVoltage,
          batteryStatus: this.determineBatteryStatus(battery.battery),
          lastSeen: reading?.measurementTime ?? null,
        };
      });

      // Generate alerts for low/critical batteries
      const alerts = devices
        .filter((d) => d.batteryStatus === 'low' || d.batteryStatus === 'critical')
        .map((d) => ({
          device: d.device,
          message: d.batteryStatus === 'critical'
            ? `Critical battery: ${d.battery?.toFixed(2) ?? 'unknown'}V`
            : `Low battery: ${d.battery?.toFixed(2) ?? 'unknown'}V`,
        }));

      res.status(200).json({
        stockId,
        stockName: metadata?.name ?? stockId,
        devices,
        alerts,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Determines battery status based on voltage.
   *
   * @param batteryMV - Battery voltage in centi-volts (or null)
   * @returns Battery status string: 'good', 'low', or 'critical'
   */
  private determineBatteryStatus(batteryMV: number | null): 'good' | 'low' | 'critical' {
    if (batteryMV === null) {
      return 'critical'; // Unknown is treated as critical
    }

    if (batteryMV > BATTERY_THRESHOLDS.GOOD) {
      return 'good';
    }

    if (batteryMV >= BATTERY_THRESHOLDS.LOW) {
      return 'low';
    }

    return 'critical';
  }
}
