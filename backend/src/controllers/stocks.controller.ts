import { Request, Response, NextFunction } from 'express';
import { InfluxDBService, SeriesPoint } from '../services';
import { NotFoundError } from '../middleware';
import { hasStockAccess } from '../models';
import { getRange, Resolution } from '../utils/timeRange';

interface StockMetadata {
  name: string;
  description: string;
  deviceCount: number;
  deviceGroup: string;
  active: boolean;
  hasHumidity: boolean;
}

const STOCK_METADATA: Record<string, StockMetadata> = {
  'grain-watch-1': {
    name: 'Halle 8',
    description: 'Lagerhalle 8',
    deviceCount: 5,
    deviceGroup: 'corn-watch-1',
    active: true,
    hasHumidity: false,
  },
  'grain-watch-2': {
    name: 'Halle 7',
    description: 'Lagerhalle 7 - inaktiv',
    deviceCount: 5,
    deviceGroup: 'corn-watch-2',
    active: false,
    hasHumidity: false,
  },
};

export class StocksController {
  private readonly influxService: InfluxDBService;

  constructor(influxService: InfluxDBService) {
    this.influxService = influxService;
  }

  async listStocks(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;

      const accessibleStocks = Object.keys(STOCK_METADATA).filter((stockId) =>
        hasStockAccess(user, stockId)
      );

      const stocks = accessibleStocks.map((stockId) => {
        const metadata = STOCK_METADATA[stockId];
        return {
          id: stockId,
          name: metadata?.name ?? stockId,
          description: metadata?.description ?? '',
          deviceCount: metadata?.deviceCount ?? 5,
          active: metadata?.active ?? false,
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

  async getLatestReadings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;

      const metadata = STOCK_METADATA[stockId];
      if (!metadata) {
        throw new NotFoundError(`Stock not found: ${stockId}`);
      }

      const readings = await this.influxService.getLatestReadings(metadata.deviceGroup);

      if (readings.length === 0) {
        throw new NotFoundError(`No readings found for stock: ${stockId}`);
      }

      const latestTimestamp = readings.reduce((latest, reading) => {
        if (!reading.measurementTime) return latest;
        if (!latest) return reading.measurementTime;
        return new Date(reading.measurementTime) > new Date(latest)
          ? reading.measurementTime
          : latest;
      }, null as string | null);

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

  async getHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stockId = req.params['stockId'] as string;
      const resolution = (req.query as { resolution: Resolution }).resolution;

      const metadata = STOCK_METADATA[stockId];
      if (!metadata) {
        throw new NotFoundError(`Stock not found: ${stockId}`);
      }

      const range = getRange(resolution, new Date());

      const readings = await this.influxService.getHistory(
        metadata.deviceGroup,
        range.fromUtc,
        range.toUtc,
        range.intervalSeconds,
        metadata.hasHumidity
      );

      const devices = Array.from(
        { length: metadata.deviceCount },
        (_, i) => `1.${i + 1}`
      );

      const seriesFor = (layer: Map<string, SeriesPoint[]>): SeriesPoint[][] =>
        devices.map((device) => layer.get(device) ?? []);

      const series: {
        temperature: {
          top: SeriesPoint[][];
          mid: SeriesPoint[][];
          bottom: SeriesPoint[][];
        };
        humidity?: SeriesPoint[][];
      } = {
        temperature: {
          top: seriesFor(readings.temperature.top),
          mid: seriesFor(readings.temperature.mid),
          bottom: seriesFor(readings.temperature.bottom),
        },
      };

      if (readings.humidity) {
        series.humidity = seriesFor(readings.humidity);
      }

      res.status(200).json({
        stockId,
        stockName: metadata.name,
        resolution,
        from: range.fromUtc.toISOString(),
        to: range.toUtc.toISOString(),
        intervalSeconds: range.intervalSeconds,
        devices,
        series,
      });
    } catch (error) {
      next(error);
    }
  }
}
