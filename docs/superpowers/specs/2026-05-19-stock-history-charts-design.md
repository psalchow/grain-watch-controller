# Stock Detail Page — Temperature History Charts

## Overview

Extend the Stock Detail Page with time-series line charts showing temperature history for each measurement layer (top, mid, bottom). Display three charts below the existing sensor cards, each containing one line per device (1.1 – 1.5). The user selects the displayed time range via a tab control (Day / Week / Month / Year) which controls all charts on the page simultaneously. Humidity history is prepared in the data model and may be added later when the stock configuration includes a humidity sensor.

## Goals

- Replace the relevant Grafana dashboards for temperature trend visualisation.
- Provide a reusable, generic chart component for further use cases (humidity, additional metrics).
- Aggregate values server-side to keep payloads small and rendering fast.
- Visualise temperature thresholds via background colour bands inside the charts.

## Out of Scope

- Historical browsing (no date pickers, no prev/next navigation).
- Humidity chart rendering — only the backend data model and stock configuration flag are prepared.
- Auto-refresh / polling.
- CSV export, chart download, zoom interactions.

## Decisions Summary

| Area | Decision |
|------|----------|
| Range model | Current calendar period (day / week / month / year) ending now |
| Aggregation function | Arithmetic mean |
| Aggregation intervals | Day = 30 min · Week = 6 h · Month = 12 h · Year = 1 d |
| Time zone for range boundaries | Europe/Berlin |
| Gap handling in lines | Lines break on `null` (`connectNulls=false`) |
| Chart library | Recharts |
| API shape | Single endpoint returns all series in one response |
| Layout | Tabs above charts, charts stacked top → mid → bottom |
| Resolution state | Held in `StockDetailPage`, passed to history section |
| Threshold bands | Coloured background bands on temperature charts |

## Backend

### Endpoint

```
GET /api/v1/stocks/:stockId/history?resolution=day|week|month|year
```

Authentication: existing `authenticate` middleware.
Authorisation: existing `requireStockAccess` middleware.
Parameter validation: existing `validateParams(stockIdParamsSchema)` plus new query schema:

```typescript
const historyQuerySchema = z.object({
  resolution: z.enum(['day', 'week', 'month', 'year']),
});
```

### Response

```typescript
interface StockHistoryResponse {
  stockId: string;
  stockName: string;
  resolution: 'day' | 'week' | 'month' | 'year';
  from: string;             // ISO 8601 UTC — start of current period in Europe/Berlin, converted to UTC
  to: string;               // ISO 8601 UTC — request time
  intervalSeconds: number;  // 1800 / 21600 / 43200 / 86400
  devices: string[];        // e.g. ['1.1','1.2','1.3','1.4','1.5'] — index aligns to series arrays
  series: {
    temperature: {
      top: SeriesPoint[][];     // outer index = device, inner array = points
      mid: SeriesPoint[][];
      bottom: SeriesPoint[][];
    };
    humidity?: SeriesPoint[][]; // present only when stock metadata has hasHumidity=true
  };
}

interface SeriesPoint {
  t: string;            // ISO 8601 UTC timestamp of the aggregation bucket start
  v: number | null;     // mean value or null if no measurement in the bucket
}
```

### Range Calculation

All boundaries are computed in `Europe/Berlin` and converted to UTC before being sent to InfluxDB.

| Resolution | from | to |
|------------|------|----|
| day | today 00:00 local | now |
| week | Monday 00:00 local (ISO week) | now |
| month | 1st of current month 00:00 local | now |
| year | 1 January 00:00 local | now |

Use a small helper, e.g. `getRange(resolution: Resolution, now: Date): { fromUtc: Date; toUtc: Date; intervalSeconds: number }`. DST transitions are handled by computing local boundaries using `Intl.DateTimeFormat` with `timeZone: 'Europe/Berlin'` or an equivalent library.

### Stock Metadata Extension

`STOCK_METADATA` in `backend/src/controllers/stocks.controller.ts` gets a new field:

```typescript
interface StockMetadata {
  name: string;
  description: string;
  deviceCount: number;
  deviceGroup: string;
  active: boolean;
  hasHumidity: boolean;   // new — defaults to false for existing stocks
}
```

The history controller uses `hasHumidity` to decide whether to query and include humidity series.

### InfluxQL Query

One query per layer, executed in parallel via `Promise.all`. Example for the top layer:

```sql
SELECT MEAN("temp-top") AS "mean"
FROM "Temp"
WHERE "device-group" = '<group>'
  AND time >= '<fromUtc>' AND time <= '<toUtc>'
GROUP BY time(<interval>), "device" fill(null)
```

- `<group>` is escaped using the existing `escapeString` helper.
- `<fromUtc>` / `<toUtc>` are RFC3339 timestamps.
- `<interval>` is one of `30m`, `6h`, `12h`, `1d`.
- `fill(null)` ensures missing buckets surface as `null` rather than being omitted.
- Measurement name comes from configuration (`config.influxdb.measurement`), escaped via `escapeMeasurement`.

For humidity (when `hasHumidity=true`), one additional query with `MEAN("humidity")` runs in parallel.

### Service Method

`backend/src/services/influx/influx.service.ts` gets a new method:

```typescript
async getHistory(
  deviceGroup: string,
  fromUtc: Date,
  toUtc: Date,
  intervalSeconds: number,
  includeHumidity: boolean,
): Promise<HistoryReadings>;

interface HistoryReadings {
  temperature: {
    top: Map<string, SeriesPoint[]>;
    mid: Map<string, SeriesPoint[]>;
    bottom: Map<string, SeriesPoint[]>;
  };
  humidity?: Map<string, SeriesPoint[]>;
}
```

The controller transforms the `Map<device, points>` structures into the array-of-arrays response shape using the `devices` list as the authoritative ordering.

### Controller

A new method `StocksController.getHistory(req, res, next)` orchestrates:

1. Look up `STOCK_METADATA[stockId]`; throw `NotFoundError` if absent.
2. Compute range via `getRange(resolution, new Date())`.
3. Call `influxService.getHistory(...)` with the metadata-derived `deviceGroup` and `metadata.hasHumidity`.
4. Build the response, ordering inner series arrays according to `metadata.deviceCount` (devices `1.1` … `1.<deviceCount>`).
5. Devices missing from the Influx result are returned as series of all-`null` points covering the time range, so the frontend can render a "no data" line.

### Routing

`backend/src/routes/stocks.routes.ts`:

```typescript
router.get(
  '/:stockId/history',
  authenticate,
  validateParams(stockIdParamsSchema),
  validateQuery(historyQuerySchema),
  requireStockAccess,
  (req, res, next) => controller.getHistory(req, res, next),
);
```

If `validateQuery` does not yet exist, add it next to the existing `validateParams` middleware following the same pattern.

## Frontend

### API Client

`frontend/src/api/stocks.ts`:

```typescript
export async function getStockHistory(
  stockId: string,
  resolution: Resolution,
): Promise<StockHistoryResponse>;

export type Resolution = 'day' | 'week' | 'month' | 'year';
```

Types added to `frontend/src/types/api.ts` mirroring the backend response.

### Generic Chart Component

`frontend/src/components/charts/TimeSeriesChart.tsx` — reusable across temperature and humidity:

```typescript
interface TimeSeriesChartProps {
  title: string;
  series: TimeSeries[];
  intervalSeconds: number;       // controls X-axis tick format
  unit: string;                  // '°C' | '%'
  yDomain?: [number, number] | 'auto';
  thresholdBands?: ThresholdBand[];
  height?: number;
}

interface TimeSeries {
  label: string;                 // 'Sensor 1.1'
  colour: string;                // hex
  points: { t: string; v: number | null }[];
}

interface ThresholdBand {
  from: number;
  to: number;
  colour: string;
  opacity?: number;              // default 0.08
}
```

Internals: Recharts `<ResponsiveContainer>` → `<LineChart>` with one `<Line connectNulls={false}>` per series, `<XAxis>` with time-based tick formatter, `<YAxis>` with the unit, `<Tooltip>`, `<Legend>` (compact, below the chart), and one `<ReferenceArea>` per threshold band using `ifOverflow="extendDomain"`.

X-axis tick format chosen from `intervalSeconds`:

- ≤ 1 800 s → `HH:mm`
- ≤ 21 600 s → `EEE HH:mm` (e.g. `Mon 06:00`)
- ≤ 43 200 s → `dd.MM`
- otherwise → `MMM` (month short name)

Use a small date formatting helper (`date-fns` is acceptable; no new heavy dependency required).

### Threshold Bands (Temperature)

The history section passes the following bands to all three temperature charts. Y-domain is fixed to `[0, 40]` so the bands are fully visible regardless of data range:

```typescript
const TEMPERATURE_BANDS: ThresholdBand[] = [
  { from: -Infinity, to: 13,        colour: '#22c55e', opacity: 0.08 },
  { from: 13,        to: 22,        colour: '#eab308', opacity: 0.08 },
  { from: 22,        to: 30,        colour: '#f97316', opacity: 0.08 },
  { from: 30,        to: Infinity,  colour: '#ef4444', opacity: 0.10 },
];
```

Recharts clamps `±Infinity` against the Y-domain, so the outer bands render correctly.

Humidity charts (future) use `yDomain='auto'` and no threshold bands.

### Range Tabs

`frontend/src/components/HistoryRangeTabs.tsx`:

```typescript
interface HistoryRangeTabsProps {
  value: Resolution;
  onChange: (next: Resolution) => void;
}
```

Four tabs labelled `Day` / `Week` / `Month` / `Year`. Active tab has a coloured bottom border and bold weight, inactive tabs muted. Tailwind styling consistent with existing shadcn-style components.

### History Section

`frontend/src/components/StockHistorySection.tsx`:

```typescript
interface StockHistorySectionProps {
  stockId: string;
  resolution: Resolution;
  onResolutionChange: (next: Resolution) => void;
  refreshNonce: number;          // bumped by parent on Refresh
}
```

Responsibilities:
- Fetches `getStockHistory(stockId, resolution)` on mount, on `resolution` change, and when `refreshNonce` changes.
- Maintains local `loading` / `error` / `data` state.
- Renders `<HistoryRangeTabs>` followed by three `<TimeSeriesChart>` instances (top, mid, bottom).
- If `data.series.humidity` is present, renders a fourth chart underneath (humidity); otherwise omits it.
- Loading state: skeleton or spinner inside the section. Cards above remain visible.
- Error state: inline error box with retry button, scoped to the section.
- Empty state: per-chart placeholder "No history data available for the selected range".

### Device Colour Palette

Fixed mapping in a shared utility `frontend/src/lib/deviceColours.ts`, applied identically across all charts so the legend stays consistent:

| Device | Colour |
|--------|--------|
| 1.1 | `#2563eb` blue |
| 1.2 | `#16a34a` green |
| 1.3 | `#d97706` orange |
| 1.4 | `#9333ea` purple |
| 1.5 | `#db2777` pink |

The mapping accepts arbitrary device identifiers; for any unknown device it falls back to a deterministic colour from the same palette.

### Integration into StockDetailPage

`StockDetailPage` holds:

```typescript
const [resolution, setResolution] = useState<Resolution>('day');
const [refreshNonce, setRefreshNonce] = useState(0);
```

- Renders `<StockHistorySection>` underneath the existing sensor grid, passing `resolution`, `setResolution` as `onResolutionChange`, and `refreshNonce`.
- The Refresh button calls `loadData(true)` (existing) **and** `setRefreshNonce(n => n + 1)`.
- Initial render fetches latest readings (existing) and history with default `resolution='day'`.

## Data Flow

```
StockDetailPage mount
  ├─ loadData() → /stocks/:id/latest → cards
  └─ <StockHistorySection resolution='day' refreshNonce=0>
        └─ fetch /stocks/:id/history?resolution=day → 3 charts

User clicks "Woche" tab
  → StockHistorySection onChange → setResolution('week') in Page
  → Section re-fetches with resolution='week'

Refresh button
  → loadData() + setRefreshNonce(n+1)
  → Cards reload AND history re-fetches with current resolution
```

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Cards fetch fails | Existing full-page error box with retry. |
| History fetch fails | Inline error box inside `<StockHistorySection>` with retry. Cards remain visible. |
| Empty time range (no points) | Per-chart placeholder "No history data available for the selected range". Tabs stay interactive. |
| Invalid `resolution` query parameter | Backend returns 400 via Zod validation. Should not occur from UI. |
| Unknown `stockId` | Backend 404. Section renders error. |
| Forbidden stock | Backend 403. Section renders error. |
| Influx unreachable | Backend 500 via existing error handler. Section renders error. |

## Performance

- Maximum payload (year resolution): ~365 days × 5 devices × 3 layers ≈ 5 475 points. Acceptable for a single response.
- Three (or four with humidity) Influx queries per request, executed in parallel via `Promise.all`.
- No client-side caching introduced in this iteration; React Query is not used by the project yet.

## Testing

### Backend

`backend/tests/controllers/stocks.controller.history.test.ts`:
- 200 response with valid resolution; asserts response keys, devices ordering, `intervalSeconds`, and `series.temperature` shape.
- 400 with invalid resolution.
- 403 without stock access.
- 404 with unknown stock id.
- Range calculation: mock system time and verify `from` for each resolution honours Europe/Berlin, including across DST boundaries (March and October).
- Humidity present only when `hasHumidity=true`.

`backend/tests/services/influx.service.history.test.ts`:
- Builds correct InfluxQL: interval token, time bounds, escaped device-group, parallel queries per layer.
- Maps Influx series → `Map<device, SeriesPoint[]>` correctly.
- Null buckets from `fill(null)` propagate as `v: null`.
- Devices missing from the Influx result still appear in the response with all-null points (controller layer responsibility).

### Frontend

`frontend/src/components/charts/TimeSeriesChart.test.tsx`:
- Renders one `<Line>` per series with the supplied colour.
- `connectNulls=false` results in broken paths around null points (DOM/SVG assertion).
- Renders one `<ReferenceArea>` per threshold band when supplied; none otherwise.
- X-axis tick format reacts to `intervalSeconds` (snapshot or formatter unit test).

`frontend/src/components/HistoryRangeTabs.test.tsx`:
- Renders four tabs.
- Click triggers `onChange` with the correct resolution.
- Active tab has the active class.

`frontend/src/components/StockHistorySection.test.tsx`:
- Fetches on mount, on resolution change, and on `refreshNonce` change.
- Loading, error, empty, and success states render correctly.
- Three temperature charts render with threshold bands and correct titles.

`frontend/src/pages/StockDetailPage.test.tsx`:
- Tab click in `<StockHistorySection>` updates parent `resolution` and triggers re-fetch.
- Refresh button bumps `refreshNonce` and reloads cards.

### Tooling

- Recharts inside `jsdom` requires `<ResponsiveContainer>` to receive an explicit size. Tests either mock `ResponsiveContainer` or wrap charts in a fixed-size container.

## Components and Files

### New Files

- `backend/src/services/influx/influx.service.ts` — extend with `getHistory`.
- `backend/src/controllers/stocks.controller.ts` — extend with `getHistory` handler and `hasHumidity` metadata field.
- `backend/src/routes/stocks.routes.ts` — register `GET /:stockId/history`.
- `backend/src/middleware/validateQuery.ts` — only if not already present.
- `backend/src/utils/timeRange.ts` — `getRange(resolution, now)` helper.
- `frontend/src/api/stocks.ts` — extend with `getStockHistory`.
- `frontend/src/types/api.ts` — extend with history types.
- `frontend/src/components/charts/TimeSeriesChart.tsx`
- `frontend/src/components/HistoryRangeTabs.tsx`
- `frontend/src/components/StockHistorySection.tsx`
- `frontend/src/lib/deviceColours.ts`

### Modified Files

- `frontend/src/pages/StockDetailPage.tsx` — wire resolution state, refresh nonce, and render history section.
- `frontend/package.json` — add `recharts` (and `date-fns` if not already a transitive dependency).

### Dependencies

- `recharts` — new dependency, frontend.
- `date-fns` — add if not present; lightweight date formatting.

## Open Questions

None at this point. The design has been validated section by section.
