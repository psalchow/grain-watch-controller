# Stock Detail Page — Current Sensor Temperatures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show colour-coded average temperatures per sensor when user clicks an active stock in the overview.

**Architecture:** New route `/stocks/:stockId` renders a `StockDetailPage` that fetches data via existing `getLatestReadings` API. Sensor grid uses responsive CSS grid (5 cols desktop, 3 cols mobile). Temperature colour logic extracted to utility. `SensorCard` component renders each device.

**Tech Stack:** React 19, React Router 7, TypeScript, Tailwind CSS 4, Axios (existing), Vitest (new — for utility tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/temperature.ts` | Create | `getTemperatureColour()` utility + `formatRelativeTime()` |
| `frontend/src/lib/temperature.test.ts` | Create | Tests for temperature utilities |
| `frontend/src/components/SensorCard.tsx` | Create | Single sensor card — average, layers, timestamp, colour |
| `frontend/src/pages/StockDetailPage.tsx` | Create | Page component — fetch, loading, error, header, grid |
| `frontend/src/App.tsx` | Modify | Add `/stocks/:stockId` route |
| `frontend/src/pages/HomePage.tsx` | Modify | Wire stock click to navigate, disable inactive |
| `frontend/src/components/StockCard.tsx` | Modify | Disable click + mute styling for inactive stocks |
| `frontend/src/types/api.ts` | Modify | Allow `null` on DeviceReading temperature fields |
| `frontend/package.json` | Modify | Add vitest dev dependency |
| `frontend/vitest.config.ts` | Create | Vitest config with path aliases |

---

### Task 1: Set Up Vitest in Frontend

Frontend has no test framework. Add vitest so we can TDD the temperature utility.

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run from monorepo root:
```bash
cd frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create vitest config**

Create `frontend/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `frontend/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest works**

Run: `cd frontend && npm test`
Expected: vitest runs, finds no tests, exits clean (0 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "chore: add vitest to frontend"
```

---

### Task 2: Temperature Utility — TDD

Pure functions: colour lookup by temperature, relative time formatting, average calculation.

**Files:**
- Create: `frontend/src/lib/temperature.ts`
- Create: `frontend/src/lib/temperature.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/lib/temperature.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  getTemperatureColour,
  calculateAverage,
  formatRelativeTime,
} from './temperature';

describe('getTemperatureColour', () => {
  it('returns green for temperatures below 13°C', () => {
    expect(getTemperatureColour(0)).toBe('#22c55e');
    expect(getTemperatureColour(12.9)).toBe('#22c55e');
  });

  it('returns yellow for temperatures from 13°C to below 22°C', () => {
    expect(getTemperatureColour(13)).toBe('#eab308');
    expect(getTemperatureColour(21.9)).toBe('#eab308');
  });

  it('returns orange for temperatures from 22°C to below 30°C', () => {
    expect(getTemperatureColour(22)).toBe('#f97316');
    expect(getTemperatureColour(29.9)).toBe('#f97316');
  });

  it('returns red for temperatures 30°C and above', () => {
    expect(getTemperatureColour(30)).toBe('#ef4444');
    expect(getTemperatureColour(45)).toBe('#ef4444');
  });

  it('handles negative temperatures as green', () => {
    expect(getTemperatureColour(-5)).toBe('#22c55e');
  });
});

describe('calculateAverage', () => {
  it('averages three layer values', () => {
    expect(calculateAverage(9, 12, 15)).toBe(12);
  });

  it('excludes null values from average', () => {
    expect(calculateAverage(10, null, 20)).toBe(15);
  });

  it('handles single non-null value', () => {
    expect(calculateAverage(null, 18, null)).toBe(18);
  });

  it('returns null when all values are null', () => {
    expect(calculateAverage(null, null, null)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(calculateAverage(10, 11, 12)).toBeCloseTo(11, 1);
    expect(calculateAverage(10.1, 10.2, 10.3)).toBeCloseTo(10.2, 1);
  });
});

describe('formatRelativeTime', () => {
  it('shows "just now" for less than 60 seconds ago', () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe('just now');
  });

  it('shows minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinAgo.toISOString())).toBe('5 min ago');
  });

  it('shows hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe('2 h ago');
  });

  it('shows days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe('3 d ago');
  });

  it('returns "unknown" for null input', () => {
    expect(formatRelativeTime(null)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — module `./temperature` not found.

- [ ] **Step 3: Implement temperature utilities**

Create `frontend/src/lib/temperature.ts`:
```typescript
export function getTemperatureColour(avgTemp: number): string {
  if (avgTemp < 13) return '#22c55e';
  if (avgTemp < 22) return '#eab308';
  if (avgTemp < 30) return '#f97316';
  return '#ef4444';
}

export function calculateAverage(
  bottom: number | null,
  mid: number | null,
  top: number | null
): number | null {
  const values = [bottom, mid, top].filter(
    (v): v is number => v !== null
  );
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'unknown';

  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} d ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/temperature.ts frontend/src/lib/temperature.test.ts
git commit -m "feat: add temperature colour, average, and relative time utilities"
```

---

### Task 3: Fix DeviceReading Types for Nullable Fields

Backend can return `null` for temperature fields when a sensor has no data. Current types don't reflect this.

**Files:**
- Modify: `frontend/src/types/api.ts:40-49`

- [ ] **Step 1: Update DeviceReading interface**

In `frontend/src/types/api.ts`, replace the `DeviceReading` interface (lines 40-49):

```typescript
export interface DeviceReading {
  device: string;
  temperature: {
    top: number | null;
    mid: number | null;
    bottom: number | null;
  };
  humidity: number | null;
  batteryMV: number | null;
  lastMeasurement: string | null; // ISO 8601
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (existing code doesn't narrow these fields yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "fix: make DeviceReading fields nullable to match API"
```

---

### Task 4: SensorCard Component

Presentational component. Receives one `DeviceReading`, renders card with average, layers, timestamp, colour.

**Files:**
- Create: `frontend/src/components/SensorCard.tsx`

- [ ] **Step 1: Create SensorCard component**

Create `frontend/src/components/SensorCard.tsx`:
```tsx
import { DeviceReading } from '@/types/api';
import { getTemperatureColour, calculateAverage, formatRelativeTime } from '@/lib/temperature';

interface SensorCardProps {
  reading: DeviceReading;
}

export function SensorCard({ reading }: SensorCardProps) {
  const { temperature, lastMeasurement, device } = reading;
  const avg = calculateAverage(temperature.bottom, temperature.mid, temperature.top);
  const colour = avg !== null ? getTemperatureColour(avg) : undefined;

  return (
    <div
      className="rounded-lg bg-card p-3 text-center"
      style={{ borderTop: `3px solid ${colour ?? 'var(--color-border)'}` }}
    >
      <div className="text-xs text-muted-foreground mb-1">
        Sensor {device}
      </div>

      {avg !== null ? (
        <>
          <div
            className="text-2xl font-bold mb-1.5"
            style={{ color: colour }}
          >
            {avg.toFixed(1)}°C
          </div>
          <div className="flex justify-center gap-1.5 text-[10px] text-muted-foreground">
            <span>↓{temperature.bottom?.toFixed(1) ?? '–'}</span>
            <span>●{temperature.mid?.toFixed(1) ?? '–'}</span>
            <span>↑{temperature.top?.toFixed(1) ?? '–'}</span>
          </div>
        </>
      ) : (
        <div className="text-2xl font-bold mb-1.5 text-muted-foreground">
          N/A
        </div>
      )}

      <div className="text-[9px] text-muted-foreground/60 mt-1.5">
        {formatRelativeTime(lastMeasurement)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SensorCard.tsx
git commit -m "feat: add SensorCard component for temperature display"
```

---

### Task 5: StockDetailPage

Page component. Fetches latest readings, renders header + sensor grid. Handles loading/error.

**Files:**
- Create: `frontend/src/pages/StockDetailPage.tsx`

- [ ] **Step 1: Create StockDetailPage**

Create `frontend/src/pages/StockDetailPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { SensorCard } from '@/components/SensorCard';
import { Button } from '@/components/ui/button';
import { stocksApi } from '@/api';
import { LatestReadingsResponse } from '@/types/api';

export default function StockDetailPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LatestReadingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (showRefreshing = false) => {
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
  };

  useEffect(() => {
    loadData();
  }, [stockId]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-screen-xl px-4 py-6">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
          >
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
              onClick={() => loadData(true)}
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

        {/* Content */}
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
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
            {data.devices.map((device) => (
              <SensorCard key={device.device} reading={device} />
            ))}
          </div>
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

- [ ] **Step 2: Verify typecheck passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/StockDetailPage.tsx
git commit -m "feat: add StockDetailPage with sensor temperature grid"
```

---

### Task 6: Routing and Navigation Wiring

Add route, wire stock click to navigate, disable inactive stock clicks.

**Files:**
- Modify: `frontend/src/App.tsx:1-64`
- Modify: `frontend/src/pages/HomePage.tsx:84-95`
- Modify: `frontend/src/components/StockCard.tsx:6-18`

- [ ] **Step 1: Add route in App.tsx**

In `frontend/src/App.tsx`, add the import at line 4:
```typescript
import StockDetailPage from './pages/StockDetailPage';
```

Then add a new route after the home route (after line 59, before the catch-all):
```tsx
      <Route
        path="/stocks/:stockId"
        element={
          <ProtectedRoute>
            <StockDetailPage />
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 2: Wire stock click in HomePage**

In `frontend/src/pages/HomePage.tsx`, add import at line 1:
```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
```

Add inside the component function (after line 9):
```typescript
const navigate = useNavigate();
```

Replace the stock card rendering (lines 86-93):
```tsx
              <StockCard
                key={stock.id}
                stock={stock}
                onClick={stock.active ? () => navigate(`/stocks/${stock.id}`) : undefined}
              />
```

- [ ] **Step 3: Update StockCard styling for inactive stocks**

In `frontend/src/components/StockCard.tsx`, update the Card className (lines 14-16):
```tsx
      className={cn(
        'transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        !onClick && 'opacity-60'
      )}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Verify app builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/HomePage.tsx frontend/src/components/StockCard.tsx
git commit -m "feat: wire stock detail navigation and disable inactive stock clicks"
```

---

### Task 7: Manual Smoke Test

Verify the full flow works end-to-end.

- [ ] **Step 1: Start dev servers**

Run: `npm run dev` (from monorepo root)

- [ ] **Step 2: Verify overview page**

1. Open `http://localhost:5173`
2. Log in (admin / changeme123)
3. Verify: active stocks are clickable (cursor pointer, hover effect)
4. Verify: inactive stocks are muted and not clickable

- [ ] **Step 3: Verify detail page**

1. Click an active stock
2. Verify: navigates to `/stocks/{stockId}`
3. Verify: shows stock name, active badge, back button, refresh button
4. Verify: 5 sensor cards in one row on desktop
5. Verify: each card shows average temperature (colour-coded), layer breakdown, last measurement time
6. Verify: colour thresholds are correct (green < 13, yellow < 22, orange < 30, red ≥ 30)

- [ ] **Step 4: Verify responsive layout**

1. Resize browser to tablet/mobile width (<1024px)
2. Verify: grid switches to 3 columns (3+2 layout)

- [ ] **Step 5: Verify navigation**

1. Click "Back" button — returns to overview
2. Refresh the detail page URL — loads correctly (route works directly)

- [ ] **Step 6: Run all checks**

```bash
cd frontend && npm run lint && npx tsc --noEmit && npm test
```
Expected: All pass.

- [ ] **Step 7: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: smoke test fixes for stock detail page"
```
