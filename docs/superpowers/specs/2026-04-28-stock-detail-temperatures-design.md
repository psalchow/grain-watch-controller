# Stock Detail Page — Current Sensor Temperatures

## Overview

When a user clicks an active grain stock in the overview, navigate to a dedicated detail page showing current average temperatures for each measurement point, colour-coded by temperature range.

## Route

`/stocks/:stockId` — new page with back navigation to home.

## Page Structure

### Header
- Back link (navigates to `/`)
- Stock name (e.g. "Halle 8")
- Active status badge
- Manual refresh button

### Sensor Grid

Responsive grid of sensor cards. All 5 sensors in one row on desktop.

**Breakpoints:**
- `≥1024px` — 5 columns (one row)
- `<1024px` — 3 columns (3+2 layout across two rows)

### Sensor Card Content

Each card displays:

1. **Sensor name** — e.g. "Sensor 1.1" (muted, small, top of card)
2. **Average temperature** — large, prominent, colour-coded. Calculated as `(bottom + mid + top) / 3`
3. **Layer breakdown** — smaller, muted row: `↓bottom ●mid ↑top` (values in °C)
4. **Last measurement** — relative timestamp (e.g. "5 min ago"), smallest text at bottom

Card has coloured top border matching temperature colour.

### Temperature Colour Thresholds

| Range | Colour |
|-------|--------|
| < 13°C | Green (`#22c55e`) |
| < 22°C | Yellow (`#eab308`) |
| < 30°C | Orange (`#f97316`) |
| ≥ 30°C | Red (`#ef4444`) |

Colour applies to: top border, average temperature text.

## Inactive Stocks

Inactive stocks in the overview are not clickable. Visually muted (already partially implemented via grey badge). No navigation occurs on click.

## Loading State

Full-page spinner while fetching data. Same pattern as existing `HomePage`.

## Error State

Error message with retry button. Same pattern as existing `HomePage`.

## Data Source

**Endpoint:** `GET /api/v1/stocks/:stockId/latest` (already exists)

**Response structure used:**
```typescript
{
  stockId: string;
  stockName: string;
  timestamp: string;
  devices: Array<{
    device: string;           // e.g. "1.1"
    temperature: {
      top: number | null;
      mid: number | null;
      bottom: number | null;
    };
    lastMeasurement: string | null;  // ISO 8601
  }>;
}
```

**No backend changes required.** All data needed is already returned by the existing endpoint.

## Average Calculation

```
average = (bottom + mid + top) / 3
```

If any layer value is `null`, exclude it from the average (divide by count of non-null values). If all three are `null`, display "N/A" instead of a temperature.

## Frontend API

`getLatestReadings(stockId)` from `src/api/stocks.ts` already exists and calls the endpoint.

## Components to Create

1. **`StockDetailPage`** — page component at `/stocks/:stockId`. Fetches data, handles loading/error states, renders header and sensor grid.
2. **`SensorCard`** — individual sensor card. Receives device reading, computes average, determines colour, renders card.
3. **`getTemperatureColour(avgTemp: number): string`** — utility function returning colour hex based on thresholds.

## Routing Changes

- Add route `/stocks/:stockId` to `App.tsx` (protected)
- `HomePage` stock card click navigates to `/stocks/${stockId}` for active stocks only

## Out of Scope

- Humidity display
- Battery status
- Historical charts / time series
- Auto-refresh / polling
- Sensor click-through to detail
