import { Request, Response, NextFunction } from 'express';
import { InfluxDBService, SeriesPoint, StockService, OutdoorReading } from '../services';
import { getFanManager } from '../services/fan';
import { NotFoundError } from '../middleware';
import { hasStockAccess } from '../models';
import { config } from '../config';
import { getRange, Resolution } from '../utils/timeRange';
import { parseDurationMs } from '../utils/duration';
import { dewPoint, absoluteHumidity } from '../utils/psychrometrics';

interface OutdoorConditions {
  temperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  absoluteHumidity: number | null;
  lastMeasurement: string | null;
  /** True once the reading is older than the configured offline threshold. */
  offline: boolean;
  /**
   * Why the conditions count as offline: `'stale'` for an ageing reading,
   * `'partner-missing'` when one of the two measurements is absent entirely.
   * `null` whenever `offline` is false — the client must not re-derive this.
   */
  offlineReason: 'stale' | 'partner-missing' | null;
  /**
   * Why `dewPoint` and `absoluteHumidity` are absent, when the inputs alone do
   * not explain it. `'skew'` means the two measurement times lie further apart
   * than `INFLUXDB_OUTDOOR_MAX_SKEW`; `null` means there is nothing to explain.
   */
  derivedUnavailableReason: 'skew' | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Whether the fan endpoints will serve this stock.
 *
 * Mirrors what `FanHttpController` requires: the stock row still asks for fan
 * control *and* a controller exists for it. The row alone would advertise a fan
 * nothing is wired up for; the map alone would keep advertising one whose row
 * was disabled underneath the running process. It says nothing about the broker
 * being reachable — controllers are built from the wiring at startup, before any
 * connection exists. Live reachability travels as `shellyOnline` in the fan
 * status instead.
 */
const fanControlAvailable = (stock: {
  id: string;
  fanControlEnabled: boolean;
}): boolean =>
  stock.fanControlEnabled && getFanManager()?.getController(stock.id) != null;

/**
 * Rounds a derived figure, or reports it as absent when the calculation did not
 * produce a finite number (0 % relative humidity drives the dew point to
 * -Infinity, which JSON would serialise as `null` anyway — just not on purpose).
 */
const finiteOrNull = (value: number): number | null =>
  Number.isFinite(value) ? round1(value) : null;

/**
 * Age beyond which a reading counts as offline, in milliseconds.
 *
 * Read per call so tests can swap the config; the value is validated as an
 * InfluxQL duration at startup, hence the fallback is never reached in practice.
 */
const offlineAfterMs = (): number =>
  parseDurationMs(config.influxdb.offlineAfter) ?? Number.POSITIVE_INFINITY;

/**
 * Whether a reading counts as offline.
 *
 * Note the timestamp is the one the device reports, not the InfluxDB ingest
 * time that bounds the look-back window; a skewed device clock shifts the flag.
 */
function isOffline(timestamp: string | null, threshold: number): boolean {
  return timestamp !== null && new Date(timestamp).getTime() < threshold;
}

/**
 * How far outdoor temperature and humidity may drift apart and still be
 * combined, in milliseconds.
 *
 * Configurable because the two measurements are published independently (on
 * change, plus a time-based refresh), so their cadences can diverge. Pairing
 * readings hours apart yields a plausible but wrong dew point.
 */
const outdoorMaxSkewMs = (): number =>
  parseDurationMs(config.influxdb.outdoorMaxSkew) ?? Number.POSITIVE_INFINITY;

function buildOutdoorConditions(
  reading: OutdoorReading,
  offlineThreshold: number,
): OutdoorConditions {
  const { temperature, humidity } = reading;

  // Dew point and absolute humidity only mean something when both inputs
  // describe roughly the same instant; the two measurements are queried
  // separately and can drift apart.
  const skewMs =
    reading.temperatureTime !== null && reading.humidityTime !== null
      ? Math.abs(
          new Date(reading.temperatureTime).getTime() -
            new Date(reading.humidityTime).getTime(),
        )
      : Number.POSITIVE_INFINITY;

  const inputsPresent = temperature !== null && humidity !== null;
  const withinSkew = skewMs <= outdoorMaxSkewMs();
  const canDerive = inputsPresent && withinSkew;

  const times = [reading.temperatureTime, reading.humidityTime].filter(
    (t): t is string => t !== null,
  );
  // A partner that dropped out of the look-back window entirely is worse than
  // one that is merely old, so it flags too. Neither present means the stock
  // has no outdoor sensor at all — nothing to mark as stale there.
  const onlyOnePresent = times.length === 1;

  // Temperature and humidity are queried separately, so their ages differ.
  // The reported age follows the older of the two, so a fresh value cannot mask
  // a stale partner. With one partner gone entirely the surviving timestamp is
  // reported — an age is more useful than none, and the null value itself tells
  // the reader which half is missing.
  const lastMeasurement = times.reduce<string | null>(
    (oldest, t) =>
      oldest === null || new Date(t) < new Date(oldest) ? t : oldest,
    null,
  );

  const stale = isOffline(lastMeasurement, offlineThreshold);

  return {
    temperature: temperature !== null ? round1(temperature) : null,
    humidity: humidity !== null ? Math.round(humidity) : null,
    dewPoint: canDerive ? finiteOrNull(dewPoint(temperature, humidity)) : null,
    absoluteHumidity: canDerive
      ? finiteOrNull(absoluteHumidity(temperature, humidity))
      : null,
    lastMeasurement,
    offline: onlyOnePresent || stale,
    offlineReason: onlyOnePresent ? 'partner-missing' : stale ? 'stale' : null,
    derivedUnavailableReason: inputsPresent && !withinSkew ? 'skew' : null,
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
