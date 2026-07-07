# Design: Outdoor Temperature

Date: 2026-07-07
Status: Approved

## Goal

Display the current (latest) outdoor temperature and outdoor humidity for each grain
stock ("Lager"/"Halle"). As small supplementary info, show the dew point and the
absolute humidity. Show how old the values are, consistent with the existing indoor
readings display. This is the first step towards later automatic ventilation control;
ventilation control itself is out of scope.

## Business Context

- A DHT sensor is mounted outside each hall, measuring temperature and humidity.
- On change, values are written to InfluxDB.
- Measurements: `outdoor-temperature` (field `temp`) and `outdoor-humidity`
  (field `humidity`).
- Values are filtered per device group via the `device` tag:
  `WHERE "device" = '<devicegroup>'`.
- The device group is the existing `stocks.deviceGroup` value already used for indoor
  readings (e.g. `corn-watch-1`).

## Data Flow

InfluxDB (`outdoor-temperature`, `outdoor-humidity`)
→ Backend query (latest per device group)
→ Backend calculation (dew point, absolute humidity)
→ embedded in existing `GET /stocks/:stockId/latest` response
→ Frontend `OutdoorConditionsCard`.

## Backend

### 1. InfluxDB query

New method `InfluxDBService.getOutdoorReading(deviceGroup: string)`.

- Two InfluxQL queries (separate measurements):
  - `SELECT LAST("temp") AS "temp", LAST("measurementTimeS") AS "time" FROM "outdoor-temperature" WHERE "device" = '<deviceGroup>' AND time > now() - 26w`
  - analogous for `outdoor-humidity` with `LAST("humidity")`.
- Reuse the existing escaping helpers (`escapeString`, `escapeMeasurement`).
- Reuse the same 26-week look-back window used by `getLatestReadings`.
- Timestamp handling: mirror the existing `measurementTimeS` (seconds → ms → ISO)
  approach used in `getLatestReadings`. If `measurementTimeS` is not present on the
  outdoor measurements, fall back to the point's own `time` column.
- Returns a plain object (nulls when a measurement has no data):
  ```ts
  interface OutdoorReading {
    temperature: number | null;      // °C
    humidity: number | null;         // %
    temperatureTime: string | null;  // ISO 8601
    humidityTime: string | null;     // ISO 8601
  }
  ```

### 2. Psychrometric calculations

New util `backend/src/utils/psychrometrics.ts` (pure functions, unit-tested):

- `dewPoint(tempC: number, relHumidity: number): number`
  - Magnus formula, WMO constants `a = 17.62`, `b = 243.12` °C.
  - `α = (a·T)/(b+T) + ln(RH/100)`; `Td = (b·α)/(a−α)`.
- `absoluteHumidity(tempC: number, relHumidity: number): number`
  - Returns g/m³:
    `AH = (6.112 · e^((17.67·T)/(T+243.5)) · RH · 2.1674) / (273.15 + T)`.
- Both callers guard: dew point / absolute humidity are `null` when temperature or
  humidity is missing.

### 3. Response shape

Extend the existing `GET /stocks/:stockId/latest` response with an `outdoor` field.
The field is always present (placeholder semantics); individual values are `null` when
data is missing.

```json
{
  "stockId": "grain-watch-1",
  "stockName": "…",
  "timestamp": "…",
  "devices": [ … ],
  "outdoor": {
    "temperature": 12.4,
    "humidity": 78,
    "dewPoint": 8.6,
    "absoluteHumidity": 8.9,
    "lastMeasurement": "2026-07-07T09:12:00Z"
  }
}
```

Rounding (applied in the controller / assembly layer):

- `temperature`, `dewPoint`, `absoluteHumidity`: 1 decimal place.
- `humidity`: integer.
- `lastMeasurement`: the more recent of `temperatureTime` and `humidityTime`
  (both usually written together by the DHT sensor). `null` when both are absent.

The controller calls `getOutdoorReading` alongside the existing latest-readings query
and computes the derived values before assembling the response.

## Frontend

### 1. Types

- New interface `OutdoorConditions` in `types/api.ts`:
  ```ts
  interface OutdoorConditions {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    absoluteHumidity: number | null;
    lastMeasurement: string | null;
  }
  ```
- Add `outdoor: OutdoorConditions` to `LatestReadingsResponse`.

### 2. Component

New `components/OutdoorConditionsCard.tsx`:

- Large: temperature (°C) and humidity (%).
- Small / muted below: `Dew point X.X°C · Abs. humidity X.X g/m³`.
- Data age via the existing `formatRelativeTime(lastMeasurement)` helper.
- Missing values rendered as `–`.
- Styling mirrors `SensorCard` (`rounded-lg bg-card p-3`).
- Labelled as outdoor ("Außen") to distinguish from indoor sensors.

### 3. Placement

Rendered as its own block near the top of `StockDetailPage`, above the `SensorCard`
grid (the outdoor value is per hall, not per device).

## Testing

- Backend unit: `psychrometrics` — dew point and absolute humidity against known
  reference values; missing-input guards.
- Backend integration: `/stocks/:stockId/latest` includes `outdoor`, both with data
  and with no outdoor data (Influx mock returns empty), verifying placeholder nulls
  and rounding.
- Frontend: `OutdoorConditionsCard` — renders values, placeholders for nulls, and the
  relative age.

## Out of Scope (YAGNI)

- Automatic ventilation control (future).
- Outdoor history charts.
- Threshold-based colour coding for outdoor values.
