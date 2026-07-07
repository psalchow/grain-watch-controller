import { Request, Response, NextFunction } from 'express';
import { InfluxDBService, SeriesPoint, StockService, OutdoorReading } from '../services';
import { NotFoundError } from '../middleware';
import { hasStockAccess } from '../models';
import { getRange, Resolution } from '../utils/timeRange';
import { dewPoint, absoluteHumidity } from '../utils/psychrometrics';

interface OutdoorConditions {
  temperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  absoluteHumidity: number | null;
  lastMeasurement: string | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function buildOutdoorConditions(reading: OutdoorReading): OutdoorConditions {
  const { temperature, humidity } = reading;
  const canDerive = temperature !== null && humidity !== null;

  const times = [reading.temperatureTime, reading.humidityTime].filter(
    (t): t is string => t !== null,
  );
  const lastMeasurement = times.reduce<string | null>(
    (latest, t) =>
      latest === null || new Date(t) > new Date(latest) ? t : latest,
    null,
  );

  return {
    temperature: temperature !== null ? round1(temperature) : null,
    humidity: humidity !== null ? Math.round(humidity) : null,
    dewPoint: canDerive ? round1(dewPoint(temperature, humidity)) : null,
    absoluteHumidity: canDerive
      ? round1(absoluteHumidity(temperature, humidity))
      : null,
    lastMeasurement,
  };
}

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
      const accessibleStocks = allStocks.filter((s) => hasStockAccess(user, s.id));

      const stocks = accessibleStocks.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        deviceCount: s.deviceCount,
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

      const [readings, outdoorReading] = await Promise.all([
        this.influxService.getLatestReadings(metadata.deviceGroup),
        this.influxService.getOutdoorReading(metadata.deviceGroup),
      ]);

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
        outdoor: buildOutdoorConditions(outdoorReading),
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

      const readings = await this.influxService.getHistory(
        metadata.deviceGroup,
        range.fromUtc,
        range.toUtc,
        range.intervalSeconds,
        metadata.hasHumidity
      );

      const devices = Array.from(
        { length: metadata.deviceCount },
        (_, i) => `${metadata.devicePrefix}.${i + 1}`,
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
