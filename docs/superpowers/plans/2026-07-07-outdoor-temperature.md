# Outdoor Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the latest outdoor temperature and humidity per grain stock, with backend-computed dew point and absolute humidity, plus how old the values are.

**Architecture:** Backend queries two InfluxDB measurements (`outdoor-temperature`, `outdoor-humidity`) filtered by the `device` tag = stock's `deviceGroup`, computes dew point + absolute humidity, and embeds an `outdoor` object into the existing `GET /stocks/:stockId/latest` response. Frontend renders a dedicated `OutdoorConditionsCard` at the top of the stock detail page.

**Tech Stack:** Backend — Express, TypeScript, InfluxQL (v1 compat API), Jest/Supertest. Frontend — React 19, TypeScript, Tailwind 4, Vitest + React Testing Library.

## Global Constraints

- All code, comments, commit messages in English (UK spelling: colour, behaviour, initialise).
- InfluxDB measurement names come from environment variables — NEVER hardcode. Field names within a measurement follow the existing convention of string literals in the query (as with `temp-top`).
- Use InfluxQL, not Flux.
- Escape all string values interpolated into InfluxQL using the existing `escapeString` / `escapeMeasurement` helpers.
- Rounding: temperature, dew point, absolute humidity → 1 decimal place; humidity → integer.
- `outdoor` field is always present in the response (placeholder semantics); individual values are `null` when data is missing.
- Run commands from `backend/` or `frontend/` as noted. Backend tests: `npm test`. Frontend tests: `npm test`.

---

### Task 1: Psychrometric calculations (backend util)

Pure functions for dew point and absolute humidity. No I/O, fully unit-tested.

**Files:**
- Create: `backend/src/utils/psychrometrics.ts`
- Test: `backend/tests/unit/psychrometrics.test.ts`

**Interfaces:**
- Produces:
  - `dewPoint(tempC: number, relHumidity: number): number` — °C
  - `absoluteHumidity(tempC: number, relHumidity: number): number` — g/m³

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/psychrometrics.test.ts`:

```typescript
import { dewPoint, absoluteHumidity } from '../../src/utils/psychrometrics';

describe('dewPoint', () => {
  it('computes the dew point for 20 °C / 50 % RH', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.26, 1);
  });

  it('computes the dew point for 10 °C / 80 % RH', () => {
    expect(dewPoint(10, 80)).toBeCloseTo(6.71, 1);
  });
});

describe('absoluteHumidity', () => {
  it('computes absolute humidity for 20 °C / 50 % RH', () => {
    expect(absoluteHumidity(20, 50)).toBeCloseTo(8.64, 1);
  });

  it('rises with temperature at constant RH', () => {
    expect(absoluteHumidity(25, 50)).toBeGreaterThan(absoluteHumidity(15, 50));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- psychrometrics`
Expected: FAIL — cannot find module `../../src/utils/psychrometrics`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/utils/psychrometrics.ts`:

```typescript
/**
 * Psychrometric calculations for outdoor air.
 *
 * Pure functions; callers must ensure inputs are present before calling.
 */

/** Magnus formula constants (WMO). */
const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12; // °C

/**
 * Dew point in °C from air temperature and relative humidity.
 *
 * @param tempC - Air temperature in °C
 * @param relHumidity - Relative humidity as a percentage (0–100)
 * @returns Dew point in °C
 */
export function dewPoint(tempC: number, relHumidity: number): number {
  const alpha =
    (MAGNUS_A * tempC) / (MAGNUS_B + tempC) + Math.log(relHumidity / 100);
  return (MAGNUS_B * alpha) / (MAGNUS_A - alpha);
}

/**
 * Absolute humidity in g/m³ from air temperature and relative humidity.
 *
 * @param tempC - Air temperature in °C
 * @param relHumidity - Relative humidity as a percentage (0–100)
 * @returns Absolute humidity in g/m³
 */
export function absoluteHumidity(tempC: number, relHumidity: number): number {
  const saturationPressure = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  return (saturationPressure * relHumidity * 2.1674) / (273.15 + tempC);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- psychrometrics`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/psychrometrics.ts backend/tests/unit/psychrometrics.test.ts
git commit -m "feat(backend): add dew point and absolute humidity calculations"
```

---

### Task 2: Outdoor config + InfluxDB query

Add configurable outdoor measurement names and a service method returning the latest outdoor reading.

**Files:**
- Modify: `backend/src/config/index.ts` (interface `InfluxDBConfig` ~line 11-26; config assembly ~line 181-187)
- Modify: `backend/src/services/influx/influx.service.ts` (add interface + constructor fields + method)
- Modify: `backend/.env.example` (InfluxDB section)
- Test: `backend/tests/unit/influx.outdoor.test.ts`

**Interfaces:**
- Consumes: `config.influxdb.outdoorTemperatureMeasurement`, `config.influxdb.outdoorHumidityMeasurement` (strings).
- Produces:
  ```typescript
  interface OutdoorReading {
    temperature: number | null;      // °C
    humidity: number | null;         // %
    temperatureTime: string | null;  // ISO 8601
    humidityTime: string | null;     // ISO 8601
  }
  // InfluxDBService.getOutdoorReading(deviceGroup: string): Promise<OutdoorReading>
  ```

- [ ] **Step 1: Add config fields**

In `backend/src/config/index.ts`, extend the `InfluxDBConfig` interface (after `measurement: string;`, ~line 25):

```typescript
  /** Measurement name for outdoor temperature data */
  outdoorTemperatureMeasurement: string;

  /** Measurement name for outdoor humidity data */
  outdoorHumidityMeasurement: string;
```

And in the config assembly `influxdb: { ... }` (after `measurement: getEnvVar('INFLUXDB_MEASUREMENT', 'Temp'),`, ~line 186):

```typescript
    outdoorTemperatureMeasurement: getEnvVar(
      'INFLUXDB_OUTDOOR_TEMPERATURE_MEASUREMENT',
      'outdoor-temperature',
    ),
    outdoorHumidityMeasurement: getEnvVar(
      'INFLUXDB_OUTDOOR_HUMIDITY_MEASUREMENT',
      'outdoor-humidity',
    ),
```

- [ ] **Step 2: Document env vars**

In `backend/.env.example`, after the `INFLUXDB_MEASUREMENT=Temp` block, add:

```bash
# Measurement name for outdoor temperature data
# Default: outdoor-temperature
INFLUXDB_OUTDOOR_TEMPERATURE_MEASUREMENT=outdoor-temperature

# Measurement name for outdoor humidity data
# Default: outdoor-humidity
INFLUXDB_OUTDOOR_HUMIDITY_MEASUREMENT=outdoor-humidity
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/unit/influx.outdoor.test.ts`. This mocks `config` and global `fetch` to verify the query targets the outdoor measurements with the `device` tag, and that parsing works.

```typescript
jest.mock('../../src/config', () => ({
  config: {
    influxdb: {
      url: 'http://influx:8086',
      token: 'test-token',
      bucket: 'testdb',
      measurement: 'Temp',
      outdoorTemperatureMeasurement: 'outdoor-temperature',
      outdoorHumidityMeasurement: 'outdoor-humidity',
    },
  },
}));

import { InfluxDBService } from '../../src/services/influx/influx.service';

describe('InfluxDBService.getOutdoorReading', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchWith(byUrl: (url: string) => unknown): void {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => byUrl(url),
    })) as unknown as typeof fetch;
  }

  it('queries both outdoor measurements filtered by device and parses values', async () => {
    const calls: string[] = [];
    mockFetchWith((url) => {
      calls.push(decodeURIComponent(url));
      if (decodeURIComponent(url).includes('outdoor-temperature')) {
        return {
          results: [
            {
              series: [
                {
                  name: 'outdoor-temperature',
                  columns: ['time', 'temp'],
                  values: [['2026-07-07T09:00:00Z', 12.4]],
                },
              ],
            },
          ],
        };
      }
      return {
        results: [
          {
            series: [
              {
                name: 'outdoor-humidity',
                columns: ['time', 'humidity'],
                values: [['2026-07-07T09:00:30Z', 78]],
              },
            ],
          },
        ],
      };
    });

    const service = new InfluxDBService();
    const reading = await service.getOutdoorReading('corn-watch-1');

    expect(reading).toEqual({
      temperature: 12.4,
      humidity: 78,
      temperatureTime: '2026-07-07T09:00:00.000Z',
      humidityTime: '2026-07-07T09:00:30.000Z',
    });
    expect(calls.some((q) => q.includes('"device" = \'corn-watch-1\''))).toBe(true);
    expect(calls.some((q) => q.includes('outdoor-temperature'))).toBe(true);
    expect(calls.some((q) => q.includes('outdoor-humidity'))).toBe(true);
  });

  it('returns nulls when a measurement has no series', async () => {
    mockFetchWith(() => ({ results: [{}] }));

    const service = new InfluxDBService();
    const reading = await service.getOutdoorReading('corn-watch-1');

    expect(reading).toEqual({
      temperature: null,
      humidity: null,
      temperatureTime: null,
      humidityTime: null,
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- influx.outdoor`
Expected: FAIL — `getOutdoorReading` is not a function.

- [ ] **Step 5: Implement the interface and method**

In `backend/src/services/influx/influx.service.ts`:

Add the interface after the `DeviceReading` interface (~line 35):

```typescript
/**
 * Latest outdoor reading for a device group.
 */
export interface OutdoorReading {
  /** Outdoor temperature in Celsius */
  temperature: number | null;

  /** Outdoor relative humidity percentage (0-100) */
  humidity: number | null;

  /** Temperature measurement timestamp (ISO 8601), or null */
  temperatureTime: string | null;

  /** Humidity measurement timestamp (ISO 8601), or null */
  humidityTime: string | null;
}
```

Add two constructor fields. Change the private field declarations (~line 77-80) and constructor body (~line 88-93):

```typescript
  private readonly url: string;
  private readonly token: string;
  private readonly bucket: string;
  private readonly measurement: string;
  private readonly outdoorTemperatureMeasurement: string;
  private readonly outdoorHumidityMeasurement: string;
```

```typescript
  constructor() {
    this.url = config.influxdb.url;
    this.token = config.influxdb.token;
    this.bucket = config.influxdb.bucket;
    this.measurement = config.influxdb.measurement;
    this.outdoorTemperatureMeasurement = config.influxdb.outdoorTemperatureMeasurement;
    this.outdoorHumidityMeasurement = config.influxdb.outdoorHumidityMeasurement;
  }
```

Add the method (e.g. after `getLatestReadings`, ~line 206):

```typescript
  /**
   * Retrieves the latest outdoor temperature and humidity for a device group.
   *
   * The two values live in separate measurements and are filtered by the
   * `device` tag. Each `LAST()` query returns the timestamp of the point in
   * its `time` column, which is used to report the reading age.
   *
   * @param deviceGroup - Device group identifier (e.g., 'corn-watch-1')
   * @returns Latest outdoor reading; individual values are null when absent
   */
  async getOutdoorReading(deviceGroup: string): Promise<OutdoorReading> {
    const escapedGroup = this.escapeString(deviceGroup);

    const buildQuery = (measurement: string, field: string): string => `
      SELECT LAST(${this.escapeMeasurement(field)}) AS "value"
      FROM ${this.escapeMeasurement(measurement)}
      WHERE "device" = '${escapedGroup}'
        AND time > now() - 26w
    `;

    const [tempResult, humidityResult] = await Promise.all([
      this.executeQuery(buildQuery(this.outdoorTemperatureMeasurement, 'temp')),
      this.executeQuery(buildQuery(this.outdoorHumidityMeasurement, 'humidity')),
    ]);

    const temp = this.parseLastPoint(tempResult);
    const humidity = this.parseLastPoint(humidityResult);

    return {
      temperature: temp.value,
      humidity: humidity.value,
      temperatureTime: temp.time,
      humidityTime: humidity.time,
    };
  }

  /**
   * Extracts the single value and timestamp from a `LAST()` query result.
   */
  private parseLastPoint(
    result: InfluxQueryResult,
  ): { value: number | null; time: string | null } {
    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        if (!series.values || series.values.length === 0) continue;

        const valueIdx = series.columns.indexOf('value');
        const timeIdx = series.columns.indexOf('time');
        const row = series.values[0];
        if (!row || valueIdx === -1) continue;

        const rawValue = row[valueIdx];
        const rawTime = timeIdx !== -1 ? row[timeIdx] : null;

        return {
          value: typeof rawValue === 'number' ? rawValue : null,
          time:
            rawTime != null ? new Date(rawTime as string).toISOString() : null,
        };
      }
    }

    return { value: null, time: null };
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd backend && npm test -- influx.outdoor && npm run typecheck`
Expected: PASS (2 tests), no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/config/index.ts backend/.env.example backend/src/services/influx/influx.service.ts backend/tests/unit/influx.outdoor.test.ts
git commit -m "feat(backend): query latest outdoor temperature and humidity"
```

---

### Task 3: Embed outdoor in the /latest response

Wire the service method + calculations into the controller and cover it with integration tests.

**Files:**
- Modify: `backend/src/controllers/stocks.controller.ts` (imports; `getLatestReadings` ~line 41-89)
- Modify: `backend/tests/integration/stocks.test.ts` (config mock ~line 30-37; influx mock ~line 41-54; mock refs ~line 74-76; default mock ~line 111-137; `/latest` describe block)

**Interfaces:**
- Consumes: `InfluxDBService.getOutdoorReading`, `OutdoorReading`, `dewPoint`, `absoluteHumidity`.
- Produces: response field `outdoor: { temperature, humidity, dewPoint, absoluteHumidity, lastMeasurement }`.

- [ ] **Step 1: Add outdoor to the influx mock (failing test setup)**

In `backend/tests/integration/stocks.test.ts`, extend the influx mock factory (~line 41-54) to include the new method:

```typescript
jest.mock('../../src/services/influx/influx.service', () => {
  const mockGetLatestReadings = jest.fn();
  const mockGetHistory = jest.fn();
  const mockGetOutdoorReading = jest.fn();

  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getLatestReadings: mockGetLatestReadings,
      getHistory: mockGetHistory,
      getOutdoorReading: mockGetOutdoorReading,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    __mockGetLatestReadings: mockGetLatestReadings,
    __mockGetHistory: mockGetHistory,
    __mockGetOutdoorReading: mockGetOutdoorReading,
  };
});
```

Add a mock reference near the existing ones (~line 74-76):

```typescript
  const mockGetOutdoorReading = mockedInflux.__mockGetOutdoorReading;
```

In `beforeEach` (~line 111-137), after resetting the other mocks, reset and give a default:

```typescript
    mockGetOutdoorReading.mockReset();
    mockGetOutdoorReading.mockResolvedValue({
      temperature: 12.4,
      humidity: 78,
      temperatureTime: '2026-01-16T09:00:00.000Z',
      humidityTime: '2026-01-16T09:00:30.000Z',
    });
```

Also add the outdoor measurement names to the mocked config (~line 30-37) for consistency:

```typescript
    influxdb: {
      url: 'http://localhost:8086',
      token: 'test-token',
      org: 'test-org',
      bucket: 'testdb',
      measurement: 'Temp',
      outdoorTemperatureMeasurement: 'outdoor-temperature',
      outdoorHumidityMeasurement: 'outdoor-humidity',
    },
```

- [ ] **Step 2: Write the failing tests**

In the `describe('GET /api/v1/stocks/:stockId/latest', ...)` block, add:

```typescript
    it('includes outdoor conditions with derived values', async () => {
      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('outdoor');
      expect(response.body.outdoor).toMatchObject({
        temperature: 12.4,
        humidity: 78,
        lastMeasurement: '2026-01-16T09:00:30.000Z',
      });
      expect(typeof response.body.outdoor.dewPoint).toBe('number');
      expect(typeof response.body.outdoor.absoluteHumidity).toBe('number');
      expect(response.body.outdoor.dewPoint).toBeCloseTo(8.7, 0);
      expect(response.body.outdoor.absoluteHumidity).toBeCloseTo(8.5, 0);
    });

    it('returns null outdoor values when no outdoor data exists', async () => {
      mockGetOutdoorReading.mockResolvedValue({
        temperature: null,
        humidity: null,
        temperatureTime: null,
        humidityTime: null,
      });

      const response = await request(app)
        .get('/api/v1/stocks/grain-watch-1/latest')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.outdoor).toEqual({
        temperature: null,
        humidity: null,
        dewPoint: null,
        absoluteHumidity: null,
        lastMeasurement: null,
      });
    });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npm test -- stocks`
Expected: FAIL — response has no `outdoor` property.

- [ ] **Step 4: Implement controller changes**

In `backend/src/controllers/stocks.controller.ts`, update the imports at the top:

```typescript
import { InfluxDBService, SeriesPoint, StockService, OutdoorReading } from '../services';
import { NotFoundError } from '../middleware';
import { hasStockAccess } from '../models';
import { getRange, Resolution } from '../utils/timeRange';
import { dewPoint, absoluteHumidity } from '../utils/psychrometrics';
```

Add a module-level helper below the imports (before the `export class StocksController`):

```typescript
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
```

Update `getLatestReadings` to fetch both readings in parallel and add `outdoor` to the response. Replace the body from the `getLatestReadings` line fetch through the `res.status(200).json(...)` call:

```typescript
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
```

- [ ] **Step 5: Verify `OutdoorReading` is exported from the services barrel**

Check `backend/src/services/index.ts` re-exports the influx service types. If `OutdoorReading` is not exported (e.g. it re-exports specific names), add `OutdoorReading` to the export list alongside `DeviceReading` / `SeriesPoint`.

Run: `cd backend && npm run typecheck`
Expected: no type errors. If `OutdoorReading` is unresolved, fix the barrel export in `backend/src/services/index.ts`, then re-run.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npm test -- stocks`
Expected: PASS, including the two new outdoor tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/stocks.controller.ts backend/tests/integration/stocks.test.ts backend/src/services/index.ts
git commit -m "feat(backend): embed outdoor conditions in latest readings response"
```

---

### Task 4: Frontend types + OutdoorConditionsCard

Add the type and a presentational component with tests.

**Files:**
- Modify: `frontend/src/types/api.ts` (after `DeviceReading` ~line 40-50; `LatestReadingsResponse` ~line 52-57)
- Create: `frontend/src/components/OutdoorConditionsCard.tsx`
- Test: `frontend/src/components/OutdoorConditionsCard.test.tsx`

**Interfaces:**
- Produces:
  ```typescript
  interface OutdoorConditions {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    absoluteHumidity: number | null;
    lastMeasurement: string | null;
  }
  // <OutdoorConditionsCard outdoor={OutdoorConditions} />
  ```

- [ ] **Step 1: Add types**

In `frontend/src/types/api.ts`, add before `LatestReadingsResponse` (~line 52):

```typescript
export interface OutdoorConditions {
  temperature: number | null; // °C
  humidity: number | null; // %
  dewPoint: number | null; // °C
  absoluteHumidity: number | null; // g/m³
  lastMeasurement: string | null; // ISO 8601
}
```

And add the field to `LatestReadingsResponse`:

```typescript
export interface LatestReadingsResponse {
  stockId: string;
  stockName: string;
  timestamp: string; // ISO 8601
  devices: DeviceReading[];
  outdoor: OutdoorConditions;
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/OutdoorConditionsCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutdoorConditionsCard } from './OutdoorConditionsCard';
import type { OutdoorConditions } from '@/types/api';

const withData: OutdoorConditions = {
  temperature: 12.4,
  humidity: 78,
  dewPoint: 8.7,
  absoluteHumidity: 8.5,
  lastMeasurement: new Date().toISOString(),
};

const empty: OutdoorConditions = {
  temperature: null,
  humidity: null,
  dewPoint: null,
  absoluteHumidity: null,
  lastMeasurement: null,
};

describe('OutdoorConditionsCard', () => {
  it('renders temperature, humidity and derived values', () => {
    render(<OutdoorConditionsCard outdoor={withData} />);
    expect(screen.getByText(/Außen/)).toBeInTheDocument();
    expect(screen.getByText('12.4°C')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText(/8\.7°C/)).toBeInTheDocument();
    expect(screen.getByText(/8\.5 g\/m³/)).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('renders placeholders when values are missing', () => {
    render(<OutdoorConditionsCard outdoor={empty} />);
    expect(screen.getByText('–°C')).toBeInTheDocument();
    expect(screen.getByText('–%')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- OutdoorConditionsCard`
Expected: FAIL — cannot resolve `./OutdoorConditionsCard`.

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/OutdoorConditionsCard.tsx`:

```tsx
import type { OutdoorConditions } from '@/types/api';
import { formatRelativeTime } from '@/lib/temperature';

interface OutdoorConditionsCardProps {
  outdoor: OutdoorConditions;
}

const fmt1 = (value: number | null): string =>
  value !== null ? value.toFixed(1) : '–';

const fmtInt = (value: number | null): string =>
  value !== null ? String(Math.round(value)) : '–';

export function OutdoorConditionsCard({ outdoor }: OutdoorConditionsCardProps) {
  const { temperature, humidity, dewPoint, absoluteHumidity, lastMeasurement } =
    outdoor;

  return (
    <div className="rounded-lg bg-card p-3">
      <div className="text-xs text-muted-foreground mb-1">Außen</div>

      <div className="flex items-baseline gap-4">
        <div className="text-2xl font-bold">{fmt1(temperature)}°C</div>
        <div className="text-lg text-muted-foreground">{fmtInt(humidity)}%</div>
      </div>

      <div className="text-[10px] text-muted-foreground mt-1.5">
        Taupunkt {fmt1(dewPoint)}°C · abs. Feuchte {fmt1(absoluteHumidity)} g/m³
      </div>

      <div className="text-[9px] text-muted-foreground/60 mt-1.5">
        {formatRelativeTime(lastMeasurement)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- OutdoorConditionsCard`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/components/OutdoorConditionsCard.tsx frontend/src/components/OutdoorConditionsCard.test.tsx
git commit -m "feat(frontend): add outdoor conditions card component"
```

---

### Task 5: Render the card on the stock detail page

Place the outdoor block above the sensor grid.

**Files:**
- Modify: `frontend/src/pages/StockDetailPage.tsx` (import ~line 5; render block ~line 99-105)

**Interfaces:**
- Consumes: `OutdoorConditionsCard`, `data.outdoor` from `LatestReadingsResponse`.

- [ ] **Step 1: Add the import**

In `frontend/src/pages/StockDetailPage.tsx`, add after the `SensorCard` import (~line 5):

```tsx
import { OutdoorConditionsCard } from '@/components/OutdoorConditionsCard';
```

- [ ] **Step 2: Render the card above the grid**

Replace the fragment that renders the grid + history (the `data && data.devices.length > 0 ? (...)` branch, ~line 99-114) so the outdoor card comes first:

```tsx
        ) : data && data.devices.length > 0 ? (
          <>
            <div className="mb-4">
              <OutdoorConditionsCard outdoor={data.outdoor} />
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
              {data.devices.map((device) => (
                <SensorCard key={device.device} reading={device} />
              ))}
            </div>
            {stockId && (
              <StockHistorySection
                stockId={stockId}
                resolution={resolution}
                onResolutionChange={setResolution}
                refreshNonce={refreshNonce}
              />
            )}
          </>
        ) : (
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no type errors (`data.outdoor` is now part of `LatestReadingsResponse`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/StockDetailPage.tsx
git commit -m "feat(frontend): show outdoor conditions on stock detail page"
```

---

### Task 6: Final verification

Full test/lint/typecheck sweep across both workspaces.

**Files:** none (verification only).

- [ ] **Step 1: Backend checks**

Run: `cd backend && npm test && npm run lint && npm run typecheck`
Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 2: Frontend checks**

Run: `cd frontend && npm test && npm run lint && npm run typecheck`
Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 3: Commit any fixes**

If lint/typecheck required changes, commit them:

```bash
git add -A
git commit -m "chore: satisfy lint and type checks for outdoor temperature"
```

---

## Self-Review Notes

- **Spec coverage:** measurement/tag query (Task 2), dew point + absolute humidity (Task 1), `/latest` embedding with rounding + placeholder nulls + `lastMeasurement` = later timestamp (Task 3), frontend types (Task 4), card with age + placeholders (Task 4), placement above grid (Task 5). All spec sections covered.
- **Config, not hardcode:** outdoor measurement names read via `getEnvVar` (Task 2), documented in `.env.example`.
- **Type consistency:** `OutdoorReading` (service) → `buildOutdoorConditions` → `OutdoorConditions` (response) mirrored by frontend `OutdoorConditions`. `getOutdoorReading` signature identical across service, mock, and controller usage.
- **Placeholder scan:** no TBD/TODO; all steps contain concrete code and commands.
