import { Request, Response, NextFunction } from 'express';
import { InfluxDBService, SeriesPoint, StockService } from '../services';
import { fanControlAvailable } from '../services/fan';
import {
  offlineAfterMs,
  isOffline,
  buildOutdoorConditions,
} from '../services/conditions';
import { NotFoundError } from '../middleware';
import { hasStockAccess } from '../models';
import { getRange, Resolution } from '../utils/timeRange';

export class StocksController {
  constructor(
    private readonly influxService: InfluxDBService,
    private readonly stockService: StockService
  ) {}

  async listStocks(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;

      const allStocks = await this.stockService.listStocks();
      // An administrator is not a member of every tenant; they skip the filter.
      const accessibleStocks =
        user.role === 'admin'
          ? allStocks
          : allStocks.filter((s) => hasStockAccess(user, s));

      const stocks = accessibleStocks.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        hasGrainSensors: s.hasGrainSensors,
        fanControlEnabled: fanControlAvailable(s),
        active: s.active,
      }));

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

      const metadata = await this.stockService.getStock(stockId);
      if (!metadata) {
        throw new NotFoundError(`Stock not found: ${stockId}`);
      }

      // Stocks without grain thermometers only report outdoor conditions.
      const [readings, outdoorReading] = await Promise.all([
        metadata.hasGrainSensors
          ? this.influxService.getLatestReadings(metadata.deviceGroup)
          : Promise.resolve([]),
        this.influxService.getOutdoorReading(metadata.deviceGroup),
      ]);

      const offlineThreshold = Date.now() - offlineAfterMs();

      const latestTimestamp = readings.reduce((latest, reading) => {
        if (!reading.measurementTime) return latest;
        if (!latest) return reading.measurementTime;
        return new Date(reading.measurementTime) > new Date(latest)
          ? reading.measurementTime
          : latest;
      }, null as string | null);

      const devices = readings
        .map((reading) => ({
          device: reading.device,
          temperature: {
            top: reading.tempTop,
            mid: reading.tempMid,
            bottom: reading.tempBottom,
          },
          humidity: reading.humidity,
          batteryMV: reading.battery,
          lastMeasurement: reading.measurementTime,
          offline: isOffline(reading.measurementTime, offlineThreshold),
        }))
        .sort((a, b) => a.device.localeCompare(b.device, 'en', { numeric: true }));

      res.status(200).json({
        stockId,
        stockName: metadata.name,
        timestamp: latestTimestamp,
        devices,
        hasGrainSensors: metadata.hasGrainSensors,
        outdoor: buildOutdoorConditions(outdoorReading, offlineThreshold),
        fanControlEnabled: fanControlAvailable(metadata),
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
      // Validated upstream by validateQuery(historyQuerySchema) in routes/stocks.routes.ts.
      const resolution = (req.query as { resolution: Resolution }).resolution;

      const metadata = await this.stockService.getStock(stockId);
      if (!metadata) {
        throw new NotFoundError(`Stock not found: ${stockId}`);
      }

      const range = getRange(resolution, new Date());

      // Stocks without grain thermometers have no history to plot.
      if (!metadata.hasGrainSensors) {
        res.status(200).json({
          stockId,
          stockName: metadata.name,
          resolution,
          from: range.fromUtc.toISOString(),
          to: range.toUtc.toISOString(),
          intervalSeconds: range.intervalSeconds,
          devices: [],
          // Same shape as the normal path: humidity present exactly when the
          // stock is configured for it, so consumers need no special case.
          series: {
            temperature: { top: [], mid: [], bottom: [] },
            ...(metadata.hasHumidity ? { humidity: [] } : {}),
          },
        });
        return;
      }

      const readings = await this.influxService.getHistory(
        metadata.deviceGroup,
        range.fromUtc,
        range.toUtc,
        range.intervalSeconds,
        metadata.hasHumidity
      );

      // Every device the group actually reported in the range, rather than a
      // list synthesised from configuration: how many probes a stock has is
      // whatever the data says.
      const devices = [
        ...new Set([
          ...readings.temperature.top.keys(),
          ...readings.temperature.mid.keys(),
          ...readings.temperature.bottom.keys(),
          ...(readings.humidity?.keys() ?? []),
        ]),
      ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

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
