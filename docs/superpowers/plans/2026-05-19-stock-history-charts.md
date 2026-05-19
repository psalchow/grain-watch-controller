# Stock History Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add temperature history line charts (top / mid / bottom layer, one line per device) to the Stock Detail Page with a Day/Week/Month/Year resolution selector.

**Architecture:** New backend endpoint `GET /stocks/:stockId/history` returns aggregated time-series data for all layers in a single call. Range boundaries are computed in Europe/Berlin and converted to UTC. The frontend introduces a reusable `TimeSeriesChart` component based on Recharts and a `StockHistorySection` that orchestrates fetching and rendering for the selected resolution. The page holds the resolution state and a refresh nonce.

**Tech Stack:** Backend — Node 22, Express 4, TypeScript, Zod, InfluxDB (InfluxQL v1 compat). Frontend — React 19, Vite, TypeScript, Tailwind 4, Recharts.

**Spec:** `docs/superpowers/specs/2026-05-19-stock-history-charts-design.md`

---

## File Map

### Backend

| File | Action |
|------|--------|
| `backend/src/utils/timeRange.ts` | Create — `getRange(resolution, now)` helper |
| `backend/tests/unit/utils/timeRange.test.ts` | Create — unit tests for range helper |
| `backend/src/middleware/validation.middleware.ts` | Modify — add `historyQuerySchema` |
| `backend/src/middleware/index.ts` | Modify — export new schema |
| `backend/src/services/influx/influx.service.ts` | Modify — add `getHistory` method and `HistoryReadings` types |
| `backend/tests/unit/services/influx.service.test.ts` | Modify — add tests for `getHistory` |
| `backend/src/controllers/stocks.controller.ts` | Modify — extend `STOCK_METADATA` with `hasHumidity`; add `getHistory` handler |
| `backend/src/routes/stocks.routes.ts` | Modify — register `GET /:stockId/history` |
| `backend/tests/integration/stocks.test.ts` | Modify — integration tests for the new endpoint |

### Frontend

| File | Action |
|------|--------|
| `frontend/package.json` | Modify — add `recharts` dependency |
| `frontend/src/types/api.ts` | Modify — add `Resolution`, `SeriesPoint`, `StockHistoryResponse` |
| `frontend/src/api/stocks.ts` | Modify — add `getStockHistory` |
| `frontend/src/lib/deviceColours.ts` | Create — fixed device colour palette |
| `frontend/src/lib/deviceColours.test.ts` | Create — palette tests |
| `frontend/src/lib/chartTickFormat.ts` | Create — X-axis tick format helper |
| `frontend/src/lib/chartTickFormat.test.ts` | Create — tick format tests |
| `frontend/src/components/charts/TimeSeriesChart.tsx` | Create — generic Recharts wrapper |
| `frontend/src/components/charts/TimeSeriesChart.test.tsx` | Create — chart tests |
| `frontend/src/components/HistoryRangeTabs.tsx` | Create — tab control |
| `frontend/src/components/HistoryRangeTabs.test.tsx` | Create — tab tests |
| `frontend/src/components/StockHistorySection.tsx` | Create — orchestrator |
| `frontend/src/components/StockHistorySection.test.tsx` | Create — orchestrator tests |
| `frontend/src/pages/StockDetailPage.tsx` | Modify — wire resolution state, refresh nonce, render section |
| `frontend/vitest.config.ts` | Modify — add setup file for jest-dom matchers |
| `frontend/src/test/setup.ts` | Create — Testing Library setup (jest-dom) |

---

## Task 1: Backend — `getRange` Time Helper

**Files:**
- Create: `backend/src/utils/timeRange.ts`
- Create: `backend/tests/unit/utils/timeRange.test.ts`

- [ ] **Step 1.1: Write failing tests for `getRange`**

Create `backend/tests/unit/utils/timeRange.test.ts`:

```typescript
/**
 * Unit tests for the time-range helper used by the history endpoint.
 * All input timestamps are UTC; expected outputs reflect Europe/Berlin
 * boundaries converted back to UTC.
 */

import { getRange } from '../../../src/utils/timeRange';

describe('getRange', () => {
  it('day resolution returns 30-minute buckets starting at local midnight', () => {
    // 2026-05-19T08:30:00Z = 2026-05-19T10:30 Berlin (CEST, UTC+2)
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('day', now);

    expect(range.intervalSeconds).toBe(1800);
    expect(range.toUtc.toISOString()).toBe('2026-05-19T08:30:00.000Z');
    // Local midnight Berlin = 2026-05-19T00:00 +02:00 = 2026-05-18T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-05-18T22:00:00.000Z');
  });

  it('week resolution starts on local Monday 00:00', () => {
    // 2026-05-19T08:30:00Z = Tuesday, 2026-05-19 in Berlin
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('week', now);

    expect(range.intervalSeconds).toBe(21600);
    // Monday 2026-05-18T00:00 +02:00 = 2026-05-17T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-05-17T22:00:00.000Z');
  });

  it('month resolution starts on the local 1st of the month', () => {
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('month', now);

    expect(range.intervalSeconds).toBe(43200);
    // 2026-05-01T00:00 +02:00 = 2026-04-30T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-04-30T22:00:00.000Z');
  });

  it('year resolution starts on local 1 January 00:00', () => {
    const now = new Date('2026-05-19T08:30:00Z');
    const range = getRange('year', now);

    expect(range.intervalSeconds).toBe(86400);
    // 2026-01-01T00:00 +01:00 (CET) = 2025-12-31T23:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('handles dates in winter (CET, UTC+1)', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    const range = getRange('day', now);
    // 2026-02-10T00:00 +01:00 = 2026-02-09T23:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-02-09T23:00:00.000Z');
  });

  it('handles the DST transition from CET to CEST (last Sunday of March)', () => {
    // 2026-03-30T08:00Z is the Monday after the spring DST switch (2026-03-29).
    const now = new Date('2026-03-30T08:00:00Z');
    const range = getRange('week', now);
    // Monday 2026-03-30T00:00 +02:00 = 2026-03-29T22:00 UTC
    expect(range.fromUtc.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('treats local Sunday as the last day of the ISO week', () => {
    // 2026-05-24 is a Sunday in Berlin. Week should still start Monday 2026-05-18.
    const now = new Date('2026-05-24T20:00:00Z');
    const range = getRange('week', now);
    expect(range.fromUtc.toISOString()).toBe('2026-05-17T22:00:00.000Z');
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/unit/utils/timeRange.test.ts
```

Expected: All seven cases fail with `Cannot find module '../../../src/utils/timeRange'`.

- [ ] **Step 1.3: Implement `getRange`**

Create `backend/src/utils/timeRange.ts`:

```typescript
/**
 * Time-range helper for the stock history endpoint.
 *
 * Computes the current calendar period (day / week / month / year)
 * in the configured local time zone and returns the corresponding
 * UTC instants together with the aggregation interval to use.
 */

const LOCAL_TIME_ZONE = 'Europe/Berlin';

export type Resolution = 'day' | 'week' | 'month' | 'year';

export interface TimeRange {
  /** Inclusive UTC start of the current period. */
  fromUtc: Date;
  /** UTC instant of the "now" reference passed to the helper. */
  toUtc: Date;
  /** Aggregation bucket size in seconds (30m / 6h / 12h / 1d). */
  intervalSeconds: number;
}

const INTERVALS: Record<Resolution, number> = {
  day: 1_800,
  week: 21_600,
  month: 43_200,
  year: 86_400,
};

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  weekday: number; // 1=Monday … 7=Sunday
}

/** Returns the calendar parts of `date` in the local time zone. */
function getLocalParts(date: Date): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 1,
  };
}

/** Returns the offset of the local time zone at `date`, in minutes east of UTC. */
function getLocalOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TIME_ZONE,
    timeZoneName: 'longOffset',
  });
  const value =
    formatter.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
  // value looks like 'GMT+01:00', 'GMT+02:00', or just 'GMT'
  const match = value.match(/GMT(?:([+-])(\d{2}):(\d{2}))?/);
  if (!match) return 0;
  if (!match[1]) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}

/** Returns the UTC instant for local midnight of the given local date. */
function localMidnightUtc(year: number, month: number, day: number): Date {
  // First approximation: treat the local date components as if they were UTC.
  // We then subtract the local offset to get the correct UTC instant.
  const approx = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMin = getLocalOffsetMinutes(approx);
  return new Date(approx.getTime() - offsetMin * 60_000);
}

export function getRange(resolution: Resolution, now: Date): TimeRange {
  const parts = getLocalParts(now);

  let fromUtc: Date;
  switch (resolution) {
    case 'day':
      fromUtc = localMidnightUtc(parts.year, parts.month, parts.day);
      break;
    case 'week': {
      // ISO weekday: Monday=1 … Sunday=7. Subtract (weekday - 1) days.
      const mondayDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      mondayDate.setUTCDate(mondayDate.getUTCDate() - (parts.weekday - 1));
      fromUtc = localMidnightUtc(
        mondayDate.getUTCFullYear(),
        mondayDate.getUTCMonth() + 1,
        mondayDate.getUTCDate(),
      );
      break;
    }
    case 'month':
      fromUtc = localMidnightUtc(parts.year, parts.month, 1);
      break;
    case 'year':
      fromUtc = localMidnightUtc(parts.year, 1, 1);
      break;
  }

  return {
    fromUtc,
    toUtc: new Date(now.getTime()),
    intervalSeconds: INTERVALS[resolution],
  };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/unit/utils/timeRange.test.ts
```

Expected: All seven cases pass.

- [ ] **Step 1.5: Commit**

```bash
git add backend/src/utils/timeRange.ts backend/tests/unit/utils/timeRange.test.ts
git commit -m "feat(backend): add Europe/Berlin time range helper"
```

---

## Task 2: Backend — Resolution Query Schema

**Files:**
- Modify: `backend/src/middleware/validation.middleware.ts`
- Modify: `backend/src/middleware/index.ts`
- Modify: `backend/tests/unit/middleware/validation.middleware.test.ts`

- [ ] **Step 2.1: Write failing schema tests**

Append to `backend/tests/unit/middleware/validation.middleware.test.ts` (inside the existing `describe('validation.middleware')` or at the file root — match existing structure):

```typescript
import { historyQuerySchema } from '../../../src/middleware/validation.middleware';

describe('historyQuerySchema', () => {
  it.each(['day', 'week', 'month', 'year'])(
    'accepts resolution %s',
    (resolution) => {
      const result = historyQuerySchema.safeParse({ resolution });
      expect(result.success).toBe(true);
    },
  );

  it('rejects an unknown resolution', () => {
    const result = historyQuerySchema.safeParse({ resolution: 'hour' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing resolution', () => {
    const result = historyQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/unit/middleware/validation.middleware.test.ts
```

Expected: New cases fail with `Cannot find name historyQuerySchema`.

- [ ] **Step 2.3: Add schema to `validation.middleware.ts`**

Append at the bottom of `backend/src/middleware/validation.middleware.ts` (after `userIdParamsSchema`):

```typescript
/**
 * Stock history endpoint query schema.
 */
export const historyQuerySchema = z.object({
  resolution: z.enum(['day', 'week', 'month', 'year'], {
    required_error: 'Resolution is required',
    invalid_type_error: 'Resolution must be one of: day, week, month, year',
  }),
});

/** Type inferred from historyQuerySchema */
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
```

- [ ] **Step 2.4: Re-export from middleware barrel**

Modify `backend/src/middleware/index.ts`. Add `historyQuerySchema` to the value export and `HistoryQuery` to the type export:

```typescript
export {
  validateBody,
  validateQuery,
  validateParams,
  loginSchema,
  createUserSchema,
  updateUserSchema,
  stockIdParamsSchema,
  userIdParamsSchema,
  userRoleEnum,
  historyQuerySchema,
} from './validation.middleware';

export type {
  LoginRequest,
  CreateUserRequest,
  UpdateUserRequest,
  StockIdParams,
  UserIdParams,
  UserRole,
  HistoryQuery,
} from './validation.middleware';
```

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
cd backend && npx jest tests/unit/middleware/validation.middleware.test.ts
```

Expected: All cases pass.

- [ ] **Step 2.6: Commit**

```bash
git add backend/src/middleware/validation.middleware.ts backend/src/middleware/index.ts backend/tests/unit/middleware/validation.middleware.test.ts
git commit -m "feat(backend): add history endpoint resolution schema"
```

---

## Task 3: Backend — `InfluxDBService.getHistory`

**Files:**
- Modify: `backend/src/services/influx/influx.service.ts`
- Modify: `backend/tests/unit/services/influx.service.test.ts`

- [ ] **Step 3.1: Write failing tests for `getHistory`**

Append a new `describe('getHistory')` block to `backend/tests/unit/services/influx.service.test.ts`:

```typescript
describe('getHistory', () => {
  it('issues one query per temperature layer with the requested interval', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ series: [] }] }),
    });

    await service.getHistory(
      'corn-watch-1',
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-19T08:00:00Z'),
      1800,
      false,
    );

    // 3 layer queries, no humidity
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const calls = mockFetch.mock.calls.map((c) => decodeURIComponent(c[0] as string));
    expect(calls.some((url) => url.includes('MEAN("temp-top")'))).toBe(true);
    expect(calls.some((url) => url.includes('MEAN("temp-mid")'))).toBe(true);
    expect(calls.some((url) => url.includes('MEAN("temp-bottom")'))).toBe(true);
    expect(calls.every((url) => url.includes('GROUP BY time(1800s)'))).toBe(true);
    expect(calls.every((url) => url.includes(', "device" fill(null)'))).toBe(true);
    expect(calls.every((url) => url.includes("'corn-watch-1'"))).toBe(true);
  });

  it('also issues a humidity query when requested', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ series: [] }] }),
    });

    await service.getHistory(
      'corn-watch-1',
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-19T08:00:00Z'),
      1800,
      true,
    );

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const calls = mockFetch.mock.calls.map((c) => decodeURIComponent(c[0] as string));
    expect(calls.some((url) => url.includes('MEAN("humidity")'))).toBe(true);
  });

  it('maps Influx series into per-device point arrays per layer', async () => {
    const respFor = (field: string) => ({
      ok: true,
      json: async () => ({
        results: [{
          series: [
            {
              name: 'Temp',
              tags: { device: '1.1' },
              columns: ['time', 'mean'],
              values: [
                ['2026-05-19T00:00:00Z', 12.0],
                ['2026-05-19T00:30:00Z', null],
                ['2026-05-19T01:00:00Z', 12.5],
              ],
            },
            {
              name: 'Temp',
              tags: { device: '1.2' },
              columns: ['time', 'mean'],
              values: [
                ['2026-05-19T00:00:00Z', 13.0],
                ['2026-05-19T00:30:00Z', 13.2],
                ['2026-05-19T01:00:00Z', 13.4],
              ],
            },
          ],
        }],
      }),
    });

    // Each call returns the same shape regardless of field.
    mockFetch
      .mockResolvedValueOnce(respFor('temp-top'))
      .mockResolvedValueOnce(respFor('temp-mid'))
      .mockResolvedValueOnce(respFor('temp-bottom'));

    const result = await service.getHistory(
      'corn-watch-1',
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-19T01:00:00Z'),
      1800,
      false,
    );

    expect(result.temperature.top.get('1.1')).toEqual([
      { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
      { t: '2026-05-19T00:30:00.000Z', v: null },
      { t: '2026-05-19T01:00:00.000Z', v: 12.5 },
    ]);
    expect(result.temperature.top.get('1.2')?.[1]).toEqual({
      t: '2026-05-19T00:30:00.000Z',
      v: 13.2,
    });
    expect(result.humidity).toBeUndefined();
  });

  it('escapes the device-group value in the query', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ series: [] }] }),
    });

    await service.getHistory(
      "corn-watch'1",
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-19T08:00:00Z'),
      1800,
      false,
    );

    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("'corn-watch\\'1'");
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/unit/services/influx.service.test.ts
```

Expected: New cases fail with `service.getHistory is not a function`.

- [ ] **Step 3.3: Add `getHistory` to `InfluxDBService`**

Modify `backend/src/services/influx/influx.service.ts`. Add the new exported types near the existing `DeviceReading` interface:

```typescript
/** Single aggregated data point in a series. */
export interface SeriesPoint {
  /** ISO 8601 UTC timestamp of the bucket start. */
  t: string;
  /** Mean value in the bucket, or null if no data was recorded. */
  v: number | null;
}

/** Per-layer aggregated history readings keyed by device id. */
export interface HistoryReadings {
  temperature: {
    top: Map<string, SeriesPoint[]>;
    mid: Map<string, SeriesPoint[]>;
    bottom: Map<string, SeriesPoint[]>;
  };
  /** Present only when humidity was requested. */
  humidity?: Map<string, SeriesPoint[]>;
}
```

Add this method to the `InfluxDBService` class (after `getLatestReadings`):

```typescript
  /**
   * Retrieves aggregated history for all devices in a stock.
   *
   * Runs one query per requested field in parallel. Each query
   * aggregates by the supplied interval, grouped by device, with
   * `fill(null)` to surface gaps.
   */
  async getHistory(
    deviceGroup: string,
    fromUtc: Date,
    toUtc: Date,
    intervalSeconds: number,
    includeHumidity: boolean,
  ): Promise<HistoryReadings> {
    const escapedGroup = this.escapeString(deviceGroup);
    const measurement = this.escapeMeasurement(this.measurement);
    const fromIso = fromUtc.toISOString();
    const toIso = toUtc.toISOString();
    const interval = `${intervalSeconds}s`;

    const buildQuery = (field: string): string => `
      SELECT MEAN(${this.escapeMeasurement(field)}) AS "mean"
      FROM ${measurement}
      WHERE "device-group" = '${escapedGroup}'
        AND time >= '${fromIso}'
        AND time <= '${toIso}'
      GROUP BY time(${interval}), "device" fill(null)
    `;

    const layerFields = [
      ['top', 'temp-top'],
      ['mid', 'temp-mid'],
      ['bottom', 'temp-bottom'],
    ] as const;

    const queries: Promise<Map<string, SeriesPoint[]>>[] = layerFields.map(
      ([, field]) =>
        this.executeQuery(buildQuery(field)).then((r) =>
          this.parseHistorySeries(r),
        ),
    );

    let humidityPromise: Promise<Map<string, SeriesPoint[]>> | undefined;
    if (includeHumidity) {
      humidityPromise = this.executeQuery(buildQuery('humidity')).then((r) =>
        this.parseHistorySeries(r),
      );
    }

    const [top, mid, bottom] = await Promise.all(queries);
    const humidity = humidityPromise ? await humidityPromise : undefined;

    const result: HistoryReadings = {
      temperature: { top, mid, bottom },
    };
    if (humidity) {
      result.humidity = humidity;
    }
    return result;
  }

  /** Transforms an Influx query result into a per-device map of points. */
  private parseHistorySeries(
    result: InfluxQueryResult,
  ): Map<string, SeriesPoint[]> {
    const out = new Map<string, SeriesPoint[]>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device) continue;

        const timeIdx = series.columns.indexOf('time');
        const meanIdx = series.columns.indexOf('mean');
        if (timeIdx === -1 || meanIdx === -1) continue;

        const points: SeriesPoint[] = (series.values ?? []).map((row) => {
          const rawTime = row[timeIdx];
          const rawValue = row[meanIdx];
          const t =
            typeof rawTime === 'string'
              ? new Date(rawTime).toISOString()
              : new Date(Number(rawTime)).toISOString();
          const v = typeof rawValue === 'number' ? rawValue : null;
          return { t, v };
        });

        out.set(device, points);
      }
    }

    return out;
  }
```

Re-export the new types from `backend/src/services/influx/index.ts`:

```typescript
export { InfluxDBService } from './influx.service';
export type { DeviceReading, SeriesPoint, HistoryReadings } from './influx.service';
```

And from `backend/src/services/index.ts` extend the existing `export type { DeviceReading } from './auth';` block — replace it with:

```typescript
export type { DeviceReading, SeriesPoint, HistoryReadings } from './influx';
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/unit/services/influx.service.test.ts
```

Expected: All cases pass.

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/services/influx/influx.service.ts backend/src/services/influx/index.ts backend/src/services/index.ts backend/tests/unit/services/influx.service.test.ts
git commit -m "feat(backend): query aggregated history per layer from InfluxDB"
```

---

## Task 4: Backend — Controller `getHistory` + `hasHumidity`

**Files:**
- Modify: `backend/src/controllers/stocks.controller.ts`

This task only adds code; the integration test in Task 6 validates behaviour end-to-end. No unit test for the controller in isolation (the controller is exercised via the integration tests).

- [ ] **Step 4.1: Extend `StockMetadata` with `hasHumidity`**

In `backend/src/controllers/stocks.controller.ts`, modify the interface and both metadata entries:

```typescript
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
```

- [ ] **Step 4.2: Add `getHistory` method**

Add these imports at the top of `stocks.controller.ts` (next to existing imports):

```typescript
import { getRange, Resolution } from '../utils/timeRange';
import { SeriesPoint } from '../services';
```

Add the method to `StocksController`:

```typescript
  async getHistory(
    req: Request,
    res: Response,
    next: NextFunction,
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
        metadata.hasHumidity,
      );

      const devices = Array.from(
        { length: metadata.deviceCount },
        (_, i) => `1.${i + 1}`,
      );

      const seriesFor = (
        layer: Map<string, SeriesPoint[]>,
      ): SeriesPoint[][] =>
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
```

- [ ] **Step 4.3: Type-check the backend**

```bash
cd backend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 4.4: Commit**

```bash
git add backend/src/controllers/stocks.controller.ts
git commit -m "feat(backend): add stock history controller method"
```

---

## Task 5: Backend — Register `/history` Route

**Files:**
- Modify: `backend/src/routes/stocks.routes.ts`

- [ ] **Step 5.1: Register the route**

Modify `backend/src/routes/stocks.routes.ts`:

```typescript
import { Router } from 'express';
import { StocksController } from '../controllers';
import { influxService } from '../services';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  validateQuery,
  stockIdParamsSchema,
  historyQuerySchema,
} from '../middleware';

export function createStocksRouter(): Router {
  const router = Router();
  const controller = new StocksController(influxService);

  router.get(
    '/',
    authenticate,
    (req, res, next) => controller.listStocks(req, res, next)
  );

  router.get(
    '/:stockId/latest',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getLatestReadings(req, res, next)
  );

  router.get(
    '/:stockId/history',
    authenticate,
    validateParams(stockIdParamsSchema),
    validateQuery(historyQuerySchema),
    requireStockAccess,
    (req, res, next) => controller.getHistory(req, res, next)
  );

  return router;
}

export const stocksRouter = createStocksRouter();
```

- [ ] **Step 5.2: Type-check**

```bash
cd backend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 5.3: Commit**

```bash
git add backend/src/routes/stocks.routes.ts
git commit -m "feat(backend): wire stock history route"
```

---

## Task 6: Backend — Integration Tests for `/history`

**Files:**
- Modify: `backend/tests/integration/stocks.test.ts`

- [ ] **Step 6.1: Extend the Influx mock with `getHistory`**

Find the existing `jest.mock('../../src/services/influx/influx.service', ...)` block in `backend/tests/integration/stocks.test.ts` and replace it with:

```typescript
jest.mock('../../src/services/influx/influx.service', () => {
  const mockGetLatestReadings = jest.fn();
  const mockGetHistory = jest.fn();

  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getLatestReadings: mockGetLatestReadings,
      getHistory: mockGetHistory,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    __mockGetLatestReadings: mockGetLatestReadings,
    __mockGetHistory: mockGetHistory,
  };
});
```

And in the test setup (where `mockGetLatestReadings` is pulled out), add:

```typescript
const mockGetHistory = mockedInflux.__mockGetHistory;
```

In the `beforeEach` block that calls `mockGetLatestReadings.mockReset()`, also reset `mockGetHistory`:

```typescript
beforeEach(() => {
  mockGetLatestReadings.mockReset();
  mockGetHistory.mockReset();
});
```

- [ ] **Step 6.2: Add failing tests for the history endpoint**

Append a new `describe('GET /stocks/:stockId/history', ...)` block at the end of `stocks.test.ts`, inside the outermost `describe`:

```typescript
describe('GET /stocks/:stockId/history', () => {
  beforeEach(() => {
    mockGetHistory.mockResolvedValue({
      temperature: {
        top: new Map([
          ['1.1', [
            { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
            { t: '2026-05-19T00:30:00.000Z', v: 12.4 },
          ]],
          ['1.2', [
            { t: '2026-05-19T00:00:00.000Z', v: 13.0 },
            { t: '2026-05-19T00:30:00.000Z', v: 13.2 },
          ]],
        ]),
        mid: new Map(),
        bottom: new Map(),
      },
    });
  });

  it('returns 200 with the expected response shape for resolution=day', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/grain-watch-1/history?resolution=day')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      stockId: 'grain-watch-1',
      stockName: 'Halle 8',
      resolution: 'day',
      intervalSeconds: 1800,
      devices: ['1.1', '1.2', '1.3', '1.4', '1.5'],
    });
    expect(response.body.series.temperature).toBeDefined();
    expect(response.body.series.temperature.top).toHaveLength(5);
    expect(response.body.series.temperature.top[0]).toEqual([
      { t: '2026-05-19T00:00:00.000Z', v: 12.0 },
      { t: '2026-05-19T00:30:00.000Z', v: 12.4 },
    ]);
    // Device 1.3 had no series — empty array.
    expect(response.body.series.temperature.top[2]).toEqual([]);
    // Humidity not enabled for grain-watch-1.
    expect(response.body.series.humidity).toBeUndefined();
  });

  it.each([
    ['day', 1800],
    ['week', 21600],
    ['month', 43200],
    ['year', 86400],
  ])('returns the correct intervalSeconds for resolution=%s', async (resolution, intervalSeconds) => {
    const response = await request(app)
      .get(`/api/v1/stocks/grain-watch-1/history?resolution=${resolution}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.intervalSeconds).toBe(intervalSeconds);
  });

  it('returns 400 for an unknown resolution', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/grain-watch-1/history?resolution=hour')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('returns 400 when resolution is missing', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/grain-watch-1/history')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown stock', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/unknown-stock/history?resolution=day')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('returns 403 for a viewer without access to the stock', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/grain-watch-2/history?resolution=day')
      .set('Authorization', `Bearer ${restrictedViewerToken}`);

    expect(response.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app)
      .get('/api/v1/stocks/grain-watch-1/history?resolution=day');

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 6.3: Run integration tests**

```bash
cd backend && npx jest tests/integration/stocks.test.ts
```

Expected: All new cases pass.

- [ ] **Step 6.4: Run the full backend test suite**

```bash
cd backend && npm test
```

Expected: All tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add backend/tests/integration/stocks.test.ts
git commit -m "test(backend): cover stock history endpoint with integration tests"
```

---

## Task 7: Frontend — Add Recharts Dependency

**Files:**
- Modify: `frontend/package.json` (and lockfile)

- [ ] **Step 7.1: Install Recharts**

```bash
cd frontend && npm install recharts@^2.13.0
```

- [ ] **Step 7.2: Verify the build still works**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 7.3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add recharts dependency"
```

---

## Task 8: Frontend — API Types and Client

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/stocks.ts`

- [ ] **Step 8.1: Add history types to `api.ts`**

Append to `frontend/src/types/api.ts`:

```typescript
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
```

- [ ] **Step 8.2: Add `getStockHistory` to the API client**

Modify `frontend/src/api/stocks.ts`. Add to the imports:

```typescript
import {
  StocksResponse,
  LatestReadingsResponse,
  TimeSeriesResponse,
  SummaryResponse,
  BatteryResponse,
  StockHistoryResponse,
  Resolution,
  Layer,
} from '../types/api';
```

Add this method to `stocksApi` (after `getBatteryStatus`):

```typescript
  /**
   * Get aggregated history for all layers of a stock.
   */
  async getStockHistory(
    stockId: string,
    resolution: Resolution,
  ): Promise<StockHistoryResponse> {
    const response = await axios.get<StockHistoryResponse>(
      `/stocks/${stockId}/history`,
      { params: { resolution } },
    );
    return response.data;
  },
```

- [ ] **Step 8.3: Type-check**

```bash
cd frontend && npm run build
```

Expected: Build succeeds (it includes `tsc -b`).

- [ ] **Step 8.4: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/api/stocks.ts
git commit -m "feat(frontend): add stock history API client"
```

---

## Task 9: Frontend — Vitest Setup (jest-dom matchers)

**Files:**
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/vitest.config.ts`

- [ ] **Step 9.1: Create the setup file**

Create `frontend/src/test/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 9.2: Wire it into the Vitest config**

Modify `frontend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 9.3: Sanity-check existing tests still pass**

```bash
cd frontend && npm test
```

Expected: Pre-existing tests pass.

- [ ] **Step 9.4: Commit**

```bash
git add frontend/src/test/setup.ts frontend/vitest.config.ts
git commit -m "test(frontend): wire jest-dom matchers into vitest setup"
```

---

## Task 10: Frontend — Device Colour Palette

**Files:**
- Create: `frontend/src/lib/deviceColours.ts`
- Create: `frontend/src/lib/deviceColours.test.ts`

- [ ] **Step 10.1: Write failing tests**

Create `frontend/src/lib/deviceColours.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getDeviceColour } from './deviceColours';

describe('getDeviceColour', () => {
  it.each([
    ['1.1', '#2563eb'],
    ['1.2', '#16a34a'],
    ['1.3', '#d97706'],
    ['1.4', '#9333ea'],
    ['1.5', '#db2777'],
  ])('returns the dedicated colour for device %s', (device, colour) => {
    expect(getDeviceColour(device)).toBe(colour);
  });

  it('returns a deterministic palette colour for unknown devices', () => {
    const c1 = getDeviceColour('9.9');
    const c2 = getDeviceColour('9.9');
    expect(c1).toBe(c2);
    expect(['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777']).toContain(c1);
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/lib/deviceColours.test.ts
```

Expected: Fails with module not found.

- [ ] **Step 10.3: Implement the palette**

Create `frontend/src/lib/deviceColours.ts`:

```typescript
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777'] as const;

const FIXED: Record<string, string> = {
  '1.1': '#2563eb',
  '1.2': '#16a34a',
  '1.3': '#d97706',
  '1.4': '#9333ea',
  '1.5': '#db2777',
};

export function getDeviceColour(device: string): string {
  const fixed = FIXED[device];
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < device.length; i++) {
    hash = (hash * 31 + device.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

```bash
cd frontend && npm test -- src/lib/deviceColours.test.ts
```

Expected: All cases pass.

- [ ] **Step 10.5: Commit**

```bash
git add frontend/src/lib/deviceColours.ts frontend/src/lib/deviceColours.test.ts
git commit -m "feat(frontend): add device colour palette"
```

---

## Task 11: Frontend — Chart Tick Format Helper

**Files:**
- Create: `frontend/src/lib/chartTickFormat.ts`
- Create: `frontend/src/lib/chartTickFormat.test.ts`

- [ ] **Step 11.1: Write failing tests**

Create `frontend/src/lib/chartTickFormat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatTick } from './chartTickFormat';

const iso = '2026-05-19T08:30:00Z';

describe('formatTick', () => {
  it('formats half-hour intervals as HH:mm in Europe/Berlin', () => {
    // 08:30 UTC = 10:30 Berlin (CEST)
    expect(formatTick(iso, 1800)).toBe('10:30');
  });

  it('formats six-hour intervals as weekday + HH:mm', () => {
    // 2026-05-19 is a Tuesday
    expect(formatTick(iso, 21600)).toMatch(/Tue 10:30|Di 10:30/);
  });

  it('formats twelve-hour intervals as dd.MM', () => {
    expect(formatTick(iso, 43200)).toBe('19.05');
  });

  it('formats one-day intervals as month short name', () => {
    expect(formatTick(iso, 86400)).toMatch(/May|Mai/);
  });
});
```

The regex tolerance lets the test pass on either an `en-GB` or `de-DE` runtime; the implementation pins the locale.

- [ ] **Step 11.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/lib/chartTickFormat.test.ts
```

Expected: Module not found.

- [ ] **Step 11.3: Implement the helper**

Create `frontend/src/lib/chartTickFormat.ts`:

```typescript
const TZ = 'Europe/Berlin';
const LOCALE = 'en-GB';

const HOUR_MINUTE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAY_HM = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
});

const MONTH_SHORT = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  month: 'short',
});

export function formatTick(iso: string, intervalSeconds: number): string {
  const date = new Date(iso);
  if (intervalSeconds <= 1800) {
    return HOUR_MINUTE.format(date);
  }
  if (intervalSeconds <= 21600) {
    // formatToParts so we can present "Tue 10:30" reliably across locales.
    const parts = WEEKDAY_HM.formatToParts(date);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    return `${weekday} ${hour}:${minute}`;
  }
  if (intervalSeconds <= 43200) {
    return DAY_MONTH.format(date).replace('/', '.');
  }
  return MONTH_SHORT.format(date);
}
```

- [ ] **Step 11.4: Run tests to verify they pass**

```bash
cd frontend && npm test -- src/lib/chartTickFormat.test.ts
```

Expected: All cases pass.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/src/lib/chartTickFormat.ts frontend/src/lib/chartTickFormat.test.ts
git commit -m "feat(frontend): add X-axis tick format helper"
```

---

## Task 12: Frontend — `TimeSeriesChart` Component

**Files:**
- Create: `frontend/src/components/charts/TimeSeriesChart.tsx`
- Create: `frontend/src/components/charts/TimeSeriesChart.test.tsx`

- [ ] **Step 12.1: Write failing tests**

Create `frontend/src/components/charts/TimeSeriesChart.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeSeriesChart } from './TimeSeriesChart';

const sampleSeries = [
  {
    label: 'Sensor 1.1',
    colour: '#2563eb',
    points: [
      { t: '2026-05-19T00:00:00Z', v: 12 },
      { t: '2026-05-19T00:30:00Z', v: 13 },
    ],
  },
  {
    label: 'Sensor 1.2',
    colour: '#16a34a',
    points: [
      { t: '2026-05-19T00:00:00Z', v: 11 },
      { t: '2026-05-19T00:30:00Z', v: null },
    ],
  },
];

function renderWithSize(ui: React.ReactElement) {
  return render(
    <div style={{ width: 800, height: 300 }}>{ui}</div>,
  );
}

describe('TimeSeriesChart', () => {
  it('renders the title', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(screen.getByText('Top Temperatures')).toBeInTheDocument();
  });

  it('renders a legend entry per series', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(screen.getByText('Sensor 1.1')).toBeInTheDocument();
    expect(screen.getByText('Sensor 1.2')).toBeInTheDocument();
  });

  it('renders threshold bands when supplied', () => {
    const { container } = renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
        yDomain={[0, 40]}
        thresholdBands={[
          { from: -Infinity, to: 13, colour: '#22c55e', opacity: 0.08 },
          { from: 13, to: 22, colour: '#eab308', opacity: 0.08 },
        ]}
      />,
    );
    // ReferenceArea renders an SVG rect with the supplied fill.
    const rects = container.querySelectorAll('rect[fill="#22c55e"]');
    expect(rects.length).toBeGreaterThan(0);
  });

  it('renders an empty-state placeholder when no series have points', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={[
          { label: 'Sensor 1.1', colour: '#2563eb', points: [] },
        ]}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(
      screen.getByText('No history data available for the selected range'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 12.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/components/charts/TimeSeriesChart.test.tsx
```

Expected: Module not found.

- [ ] **Step 12.3: Implement `TimeSeriesChart`**

Create `frontend/src/components/charts/TimeSeriesChart.tsx`:

```typescript
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTick } from '@/lib/chartTickFormat';

export interface TimeSeries {
  label: string;
  colour: string;
  points: { t: string; v: number | null }[];
}

export interface ThresholdBand {
  from: number;
  to: number;
  colour: string;
  opacity?: number;
}

export interface TimeSeriesChartProps {
  title: string;
  series: TimeSeries[];
  intervalSeconds: number;
  unit: string;
  yDomain?: [number, number];
  thresholdBands?: ThresholdBand[];
  height?: number;
}

interface ChartRow {
  t: string;
  [seriesLabel: string]: string | number | null;
}

function toChartRows(series: TimeSeries[]): ChartRow[] {
  const byTime = new Map<string, ChartRow>();
  for (const s of series) {
    for (const point of s.points) {
      const existing = byTime.get(point.t) ?? { t: point.t };
      existing[s.label] = point.v;
      byTime.set(point.t, existing);
    }
  }
  return Array.from(byTime.values()).sort((a, b) =>
    a.t < b.t ? -1 : a.t > b.t ? 1 : 0,
  );
}

export function TimeSeriesChart({
  title,
  series,
  intervalSeconds,
  unit,
  yDomain,
  thresholdBands,
  height = 240,
}: TimeSeriesChartProps) {
  const data = toChartRows(series);
  const isEmpty = data.length === 0;

  return (
    <div className="rounded-md border p-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {isEmpty ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          No history data available for the selected range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            {thresholdBands?.map((band, i) => (
              <ReferenceArea
                key={i}
                y1={band.from}
                y2={band.to}
                fill={band.colour}
                fillOpacity={band.opacity ?? 0.08}
                ifOverflow="extendDomain"
              />
            ))}
            <XAxis
              dataKey="t"
              tickFormatter={(value: string) => formatTick(value, intervalSeconds)}
              minTickGap={32}
            />
            <YAxis
              domain={yDomain ?? ['auto', 'auto']}
              tickFormatter={(value: number) => `${value}${unit}`}
              width={48}
            />
            <Tooltip
              labelFormatter={(value: string) => formatTick(value, intervalSeconds)}
              formatter={(value: number) =>
                value === null || value === undefined ? '—' : `${value.toFixed(1)}${unit}`
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={s.colour}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 12.4: Run tests to verify they pass**

```bash
cd frontend && npm test -- src/components/charts/TimeSeriesChart.test.tsx
```

Expected: All cases pass.

If a test fails because Recharts requires the responsive container to have a measurable size, the `renderWithSize` helper already wraps the chart in a fixed-size container. If sizes are still zero in jsdom, replace `ResponsiveContainer` width/height assertions by selecting on the SVG inside the container directly. Do not change the component — only the test wrapper if needed.

- [ ] **Step 12.5: Commit**

```bash
git add frontend/src/components/charts/TimeSeriesChart.tsx frontend/src/components/charts/TimeSeriesChart.test.tsx
git commit -m "feat(frontend): add reusable TimeSeriesChart component"
```

---

## Task 13: Frontend — `HistoryRangeTabs`

**Files:**
- Create: `frontend/src/components/HistoryRangeTabs.tsx`
- Create: `frontend/src/components/HistoryRangeTabs.test.tsx`

- [ ] **Step 13.1: Write failing tests**

Create `frontend/src/components/HistoryRangeTabs.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryRangeTabs } from './HistoryRangeTabs';

describe('HistoryRangeTabs', () => {
  it('renders the four resolution tabs', () => {
    render(<HistoryRangeTabs value="day" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Year' })).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    render(<HistoryRangeTabs value="week" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked resolution', () => {
    const handle = vi.fn();
    render(<HistoryRangeTabs value="day" onChange={handle} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(handle).toHaveBeenCalledWith('month');
  });
});
```

- [ ] **Step 13.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/components/HistoryRangeTabs.test.tsx
```

Expected: Module not found.

- [ ] **Step 13.3: Implement `HistoryRangeTabs`**

Create `frontend/src/components/HistoryRangeTabs.tsx`:

```typescript
import type { Resolution } from '@/types/api';
import { cn } from '@/lib/utils';

const TABS: { value: Resolution; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface HistoryRangeTabsProps {
  value: Resolution;
  onChange: (next: Resolution) => void;
}

export function HistoryRangeTabs({ value, onChange }: HistoryRangeTabsProps) {
  return (
    <div role="tablist" className="flex border-b border-border">
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'px-4 py-2 text-sm -mb-px border-b-2 transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 13.4: Run tests to verify they pass**

```bash
cd frontend && npm test -- src/components/HistoryRangeTabs.test.tsx
```

Expected: All cases pass.

- [ ] **Step 13.5: Commit**

```bash
git add frontend/src/components/HistoryRangeTabs.tsx frontend/src/components/HistoryRangeTabs.test.tsx
git commit -m "feat(frontend): add history range tabs"
```

---

## Task 14: Frontend — `StockHistorySection`

**Files:**
- Create: `frontend/src/components/StockHistorySection.tsx`
- Create: `frontend/src/components/StockHistorySection.test.tsx`

- [ ] **Step 14.1: Write failing tests**

Create `frontend/src/components/StockHistorySection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StockHistorySection } from './StockHistorySection';
import { stocksApi } from '@/api';
import type { StockHistoryResponse } from '@/types/api';

vi.mock('@/api', () => ({
  stocksApi: {
    getStockHistory: vi.fn(),
  },
}));

const baseResponse: StockHistoryResponse = {
  stockId: 'grain-watch-1',
  stockName: 'Halle 8',
  resolution: 'day',
  from: '2026-05-18T22:00:00.000Z',
  to: '2026-05-19T08:30:00.000Z',
  intervalSeconds: 1800,
  devices: ['1.1', '1.2', '1.3', '1.4', '1.5'],
  series: {
    temperature: {
      top: [
        [{ t: '2026-05-19T00:00:00Z', v: 12 }],
        [], [], [], [],
      ],
      mid: [
        [{ t: '2026-05-19T00:00:00Z', v: 11 }],
        [], [], [], [],
      ],
      bottom: [
        [{ t: '2026-05-19T00:00:00Z', v: 10 }],
        [], [], [], [],
      ],
    },
  },
};

beforeEach(() => {
  vi.mocked(stocksApi.getStockHistory).mockReset();
});

function renderSection(props?: Partial<{
  resolution: 'day' | 'week' | 'month' | 'year';
  refreshNonce: number;
  onResolutionChange: (r: 'day' | 'week' | 'month' | 'year') => void;
}>) {
  return render(
    <div style={{ width: 800, height: 800 }}>
      <StockHistorySection
        stockId="grain-watch-1"
        resolution={props?.resolution ?? 'day'}
        refreshNonce={props?.refreshNonce ?? 0}
        onResolutionChange={props?.onResolutionChange ?? (() => {})}
      />
    </div>,
  );
}

describe('StockHistorySection', () => {
  it('fetches history on mount and renders three temperature charts', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    renderSection();
    await waitFor(() => {
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'day');
    });
    expect(await screen.findByText('Top Temperatures')).toBeInTheDocument();
    expect(screen.getByText('Mid Temperatures')).toBeInTheDocument();
    expect(screen.getByText('Bottom Temperatures')).toBeInTheDocument();
  });

  it('re-fetches when the resolution prop changes', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const { rerender } = renderSection({ resolution: 'day' });
    await waitFor(() =>
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'day'),
    );
    rerender(
      <div style={{ width: 800, height: 800 }}>
        <StockHistorySection
          stockId="grain-watch-1"
          resolution="week"
          refreshNonce={0}
          onResolutionChange={() => {}}
        />
      </div>,
    );
    await waitFor(() =>
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'week'),
    );
  });

  it('re-fetches when the refreshNonce changes', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const { rerender } = renderSection({ refreshNonce: 0 });
    await waitFor(() => expect(stocksApi.getStockHistory).toHaveBeenCalledTimes(1));
    rerender(
      <div style={{ width: 800, height: 800 }}>
        <StockHistorySection
          stockId="grain-watch-1"
          resolution="day"
          refreshNonce={1}
          onResolutionChange={() => {}}
        />
      </div>,
    );
    await waitFor(() => expect(stocksApi.getStockHistory).toHaveBeenCalledTimes(2));
  });

  it('forwards tab clicks via onResolutionChange', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const onChange = vi.fn();
    renderSection({ onResolutionChange: onChange });
    await screen.findByText('Top Temperatures');
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('renders an error state with a retry button on fetch failure', async () => {
    vi.mocked(stocksApi.getStockHistory).mockRejectedValueOnce(new Error('boom'));
    renderSection();
    expect(
      await screen.findByText('Failed to load history. Please try again.'),
    ).toBeInTheDocument();
    vi.mocked(stocksApi.getStockHistory).mockResolvedValueOnce(baseResponse);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Top Temperatures')).toBeInTheDocument();
  });
});
```

- [ ] **Step 14.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/components/StockHistorySection.test.tsx
```

Expected: Module not found.

- [ ] **Step 14.3: Implement `StockHistorySection`**

Create `frontend/src/components/StockHistorySection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { stocksApi } from '@/api';
import type { Resolution, StockHistoryResponse, SeriesPoint } from '@/types/api';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, type ThresholdBand, type TimeSeries } from '@/components/charts/TimeSeriesChart';
import { HistoryRangeTabs } from '@/components/HistoryRangeTabs';
import { getDeviceColour } from '@/lib/deviceColours';

const TEMPERATURE_BANDS: ThresholdBand[] = [
  { from: -Infinity, to: 13, colour: '#22c55e', opacity: 0.08 },
  { from: 13, to: 22, colour: '#eab308', opacity: 0.08 },
  { from: 22, to: 30, colour: '#f97316', opacity: 0.08 },
  { from: 30, to: Infinity, colour: '#ef4444', opacity: 0.1 },
];

export interface StockHistorySectionProps {
  stockId: string;
  resolution: Resolution;
  onResolutionChange: (next: Resolution) => void;
  refreshNonce: number;
}

function buildSeries(
  devices: string[],
  layer: SeriesPoint[][],
): TimeSeries[] {
  return devices.map((device, idx) => ({
    label: `Sensor ${device}`,
    colour: getDeviceColour(device),
    points: layer[idx] ?? [],
  }));
}

export function StockHistorySection({
  stockId,
  resolution,
  onResolutionChange,
  refreshNonce,
}: StockHistorySectionProps) {
  const [data, setData] = useState<StockHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    stocksApi
      .getStockHistory(stockId, resolution)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load history. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stockId, resolution, refreshNonce]);

  return (
    <section className="mt-6">
      <HistoryRangeTabs value={resolution} onChange={onResolutionChange} />

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => onResolutionChange(resolution)}
          >
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex flex-col gap-3 mt-3">
          <TimeSeriesChart
            title="Top Temperatures"
            series={buildSeries(data.devices, data.series.temperature.top)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
          <TimeSeriesChart
            title="Mid Temperatures"
            series={buildSeries(data.devices, data.series.temperature.mid)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
          <TimeSeriesChart
            title="Bottom Temperatures"
            series={buildSeries(data.devices, data.series.temperature.bottom)}
            intervalSeconds={data.intervalSeconds}
            unit="°C"
            yDomain={[0, 40]}
            thresholdBands={TEMPERATURE_BANDS}
          />
        </div>
      )}
    </section>
  );
}
```

Note on the retry button: clicking it calls `onResolutionChange(resolution)` to force the parent to re-render with the same value. Because the parent owns `resolution`, the effect's dependency stays the same and the retry would not re-fire. To make retry trigger a re-fetch reliably, track a local retry counter in addition to `refreshNonce`:

Update the component:

```typescript
const [retryCount, setRetryCount] = useState(0);
useEffect(() => { /* ... */ }, [stockId, resolution, refreshNonce, retryCount]);
// ...
onClick={() => setRetryCount((c) => c + 1)}
```

Replace the retry button click handler accordingly.

- [ ] **Step 14.4: Run tests to verify they pass**

```bash
cd frontend && npm test -- src/components/StockHistorySection.test.tsx
```

Expected: All cases pass.

- [ ] **Step 14.5: Commit**

```bash
git add frontend/src/components/StockHistorySection.tsx frontend/src/components/StockHistorySection.test.tsx
git commit -m "feat(frontend): add stock history section orchestrator"
```

---

## Task 15: Frontend — Integrate into `StockDetailPage`

**Files:**
- Modify: `frontend/src/pages/StockDetailPage.tsx`

- [ ] **Step 15.1: Modify the page to hold resolution + nonce and render the section**

Replace the contents of `frontend/src/pages/StockDetailPage.tsx` with:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { SensorCard } from '@/components/SensorCard';
import { StockHistorySection } from '@/components/StockHistorySection';
import { Button } from '@/components/ui/button';
import { stocksApi } from '@/api';
import type { LatestReadingsResponse, Resolution } from '@/types/api';

export default function StockDetailPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LatestReadingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>('day');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadData = useCallback(async (showRefreshing = false) => {
    if (!stockId) return;
    if (showRefreshing) setRefreshing(true);
    setError(null);

    try {
      const response = await stocksApi.getLatestReadings(stockId);
      setData(response);
    } catch {
      setError('Failed to load sensor data. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stockId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    loadData(true);
    setRefreshNonce((n) => n + 1);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Back</span>
          </Button>

          {data && (
            <>
              <h1 className="text-2xl font-bold">{data.stockName}</h1>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                Active
              </span>
            </>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => loadData()}
            >
              Try again
            </Button>
          </div>
        ) : data && data.devices.length > 0 ? (
          <>
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
          <div className="text-center py-12 text-muted-foreground">
            <p>No sensor data available</p>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 15.2: Type-check the frontend**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 15.3: Run the full frontend test suite**

```bash
cd frontend && npm test
```

Expected: All tests pass.

- [ ] **Step 15.4: Commit**

```bash
git add frontend/src/pages/StockDetailPage.tsx
git commit -m "feat(frontend): show history charts on stock detail page"
```

---

## Task 16: Manual Verification

This task is not optional — it is the only check that the feature works end-to-end in the browser.

- [ ] **Step 16.1: Start the dev environment**

In separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

- [ ] **Step 16.2: Verify the Stock Detail Page**

1. Log in.
2. Navigate to `Halle 8` (`grain-watch-1`).
3. Confirm the existing sensor cards still render.
4. Confirm three new charts (Top / Mid / Bottom Temperatures) appear below the cards with the resolution tabs above them.
5. Confirm the default selected tab is `Day` and that data loads.
6. Switch to `Week`, `Month`, `Year` — each switch triggers a fresh fetch (visible in the network tab) and re-renders the charts.
7. Confirm lines are coloured per device (5 distinct colours), legend matches.
8. Confirm threshold background bands (green/yellow/orange/red) are visible behind the lines.
9. Confirm `Refresh` reloads both cards and charts.
10. If possible (e.g. by temporarily disabling the backend), confirm the inline error message + retry button.

- [ ] **Step 16.3: Lint and typecheck the whole monorepo**

```bash
npm run lint
npm run typecheck
```

Expected: Both succeed.

- [ ] **Step 16.4: Final commit (only if anything changed during verification)**

If manual testing surfaces small adjustments, commit them with descriptive messages. Otherwise nothing to do for this step.

---

## Self-Review Notes

- Every spec section is covered by at least one task (range helper → Task 1, schema → Task 2, Influx query → Task 3, controller + metadata → Task 4, route → Task 5, integration tests → Task 6, frontend types/client → Task 8, palette → Task 10, tick formatter → Task 11, chart → Task 12, tabs → Task 13, section → Task 14, page integration → Task 15, manual verification → Task 16).
- Humidity is prepared at the data layer (Task 3 supports it, Task 4 emits it conditionally) but the frontend does not yet render humidity charts. This matches the spec's "Out of Scope" entry.
- Type names stay consistent across tasks (`Resolution`, `SeriesPoint`, `StockHistoryResponse`, `TimeSeries`, `ThresholdBand`).
- All TDD steps include the failing test before the implementation, the exact command to run, and the expected output.
