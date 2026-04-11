import { Request, Response, NextFunction } from 'express';
import { InfluxDBService } from '../services/influx';
import { NotFoundError } from '../middleware';

interface StockMetadata {
  name: string;
  description: string;
  deviceCount: number;
}

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

      const deviceGroups = await this.influxService.getDeviceGroups();

      const accessibleStocks = deviceGroups.filter((stockId) => {
        if (user.stockAccess.includes('*')) {
          return true;
        }
        return user.stockAccess.includes(stockId);
      });

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
}
