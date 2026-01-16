# InfluxDB Query Examples (InfluxQL)

This document contains example InfluxQL queries for querying grain stock measurement data.

**Important**:
- All configuration values (database, measurement) must come from environment variables
- Use parameterised queries to prevent injection attacks
- Never concatenate user input directly into queries

## Query Language: InfluxQL

InfluxQL is the SQL-like query language for InfluxDB. It's simpler and more familiar than Flux for traditional time-series queries.

## Query Patterns

### 1. Get Latest Readings for All Devices in a Stock

```sql
-- Get the most recent value for each field, grouped by device
SELECT
  LAST("temp-top") AS "temp_top",
  LAST("temp-mid") AS "temp_mid",
  LAST("temp-bottom") AS "temp_bottom",
  LAST("humidity") AS "humidity",
  LAST("batteryMV") AS "battery",
  LAST("measurementTimeS") AS "measurement_time"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time > now() - 1h
GROUP BY "device"
```

### 2. Get Temperature Time Series (Like Grafana Example)

```sql
-- Get mean temperature for specific layer over time
-- Based on your Grafana query
SELECT mean("temp-top")
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
GROUP BY time(15m), "device"
FILL(null)
```

**With parameters (TypeScript):**
```typescript
const query = `
  SELECT mean("temp-${layer}")
  FROM "${measurement}"
  WHERE "device-group" = $deviceGroup
    AND time >= $startTime
    AND time <= $endTime
  GROUP BY time($window), "device"
  FILL(null)
`;
```

### 3. Get Temperature by Layer (All Devices)

```sql
-- Get temperature readings for specific layer
SELECT "temp-top"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
```

### 4. Get Humidity Time Series

```sql
-- Get mean humidity over time for all devices
SELECT mean("humidity")
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
GROUP BY time(15m), "device"
FILL(null)
```

### 5. Get Specific Device Data

```sql
-- Get all fields for a specific device
SELECT *
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND "device" = '1.1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
```

### 6. Get Battery Status for All Devices

```sql
-- Get latest battery level for each device
SELECT LAST("batteryMV") AS "battery"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time > now() - 1h
GROUP BY "device"
```

### 7. Get Summary Statistics

```sql
-- Get min, max, mean for a time period
SELECT
  MIN("temp-top") AS "min",
  MAX("temp-top") AS "max",
  MEAN("temp-top") AS "avg"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time >= now() - 24h
GROUP BY "device"
```

### 8. Get All Available Grain Stocks (Device Groups)

```sql
-- Show all unique device-group tag values
SHOW TAG VALUES FROM "Temp" WITH KEY = "device-group"
```

### 9. Get All Devices in a Stock

```sql
-- Show all unique device tag values for a stock
SHOW TAG VALUES FROM "Temp" WITH KEY = "device"
WHERE "device-group" = 'corn-watch-1'
```

### 10. Get Temperature with Multiple Layers

```sql
-- Get all temperature layers in one query
SELECT
  mean("temp-top") AS "top",
  mean("temp-mid") AS "mid",
  mean("temp-bottom") AS "bottom"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
GROUP BY time(1h), "device"
FILL(null)
```

### 11. Filter by Actual Measurement Time

```sql
-- Get distinct measurements based on measurementTimeS
-- Useful to avoid duplicate transmitted values
SELECT
  "temp-top",
  "temp-mid",
  "temp-bottom",
  "humidity",
  "measurementTimeS"
FROM "Temp"
WHERE "device-group" = 'corn-watch-1'
  AND "device" = '1.1'
  AND time >= '2026-01-15T00:00:00Z'
  AND time <= '2026-01-16T00:00:00Z'
```

## TypeScript Service Example

```typescript
import { InfluxDB } from '@influxdata/influxdb-client';

interface InfluxQLQueryOptions {
  database: string;
  query: string;
  params?: Record<string, string | number>;
}

class InfluxDBService {
  private influxDB: InfluxDB;
  private database: string;
  private measurement: string;

  constructor() {
    // All values from environment variables - NEVER hardcoded
    this.influxDB = new InfluxDB({
      url: process.env.INFLUX_URL!,
      token: process.env.INFLUX_TOKEN!,
    });
    this.database = process.env.INFLUX_DATABASE || 'cornwatch';
    this.measurement = process.env.INFLUX_MEASUREMENT || 'Temp';
  }

  /**
   * Execute InfluxQL query
   * InfluxDB 2.x supports InfluxQL via the v1 compatibility API
   */
  private async executeQuery(query: string): Promise<any[]> {
    const queryApi = this.influxDB.getQueryApi('');

    // Use v1 compatibility query format
    const influxQLQuery = `
      from(bucket: "${this.database}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "${this.measurement}")
    `;

    // Note: For proper InfluxQL support, you may need to use
    // the InfluxDB v1 client or the v1 compatibility endpoint
    // depending on your InfluxDB version

    const result = await queryApi.collectRows(query);
    return result;
  }

  async getLatestReadings(deviceGroup: string): Promise<any[]> {
    const query = `
      SELECT
        LAST("temp-top") AS "temp_top",
        LAST("temp-mid") AS "temp_mid",
        LAST("temp-bottom") AS "temp_bottom",
        LAST("humidity") AS "humidity",
        LAST("batteryMV") AS "battery",
        LAST("measurementTimeS") AS "measurement_time"
      FROM "${this.measurement}"
      WHERE "device-group" = '${this.escapeString(deviceGroup)}'
        AND time > now() - 1h
      GROUP BY "device"
    `;

    return this.executeQuery(query);
  }

  async getTemperatureTimeSeries(
    deviceGroup: string,
    layer: 'top' | 'mid' | 'bottom',
    startTime: string,
    endTime: string,
    windowDuration: string = '15m'
  ): Promise<any[]> {
    const field = `temp-${layer}`;

    const query = `
      SELECT mean("${field}") AS "value"
      FROM "${this.measurement}"
      WHERE "device-group" = '${this.escapeString(deviceGroup)}'
        AND time >= '${startTime}'
        AND time <= '${endTime}'
      GROUP BY time(${windowDuration}), "device"
      FILL(null)
    `;

    return this.executeQuery(query);
  }

  async getHumidityTimeSeries(
    deviceGroup: string,
    startTime: string,
    endTime: string,
    windowDuration: string = '15m'
  ): Promise<any[]> {
    const query = `
      SELECT mean("humidity") AS "value"
      FROM "${this.measurement}"
      WHERE "device-group" = '${this.escapeString(deviceGroup)}'
        AND time >= '${startTime}'
        AND time <= '${endTime}'
      GROUP BY time(${windowDuration}), "device"
      FILL(null)
    `;

    return this.executeQuery(query);
  }

  async getDeviceGroups(): Promise<string[]> {
    const query = `SHOW TAG VALUES FROM "${this.measurement}" WITH KEY = "device-group"`;
    const result = await this.executeQuery(query);
    return result.map((row: any) => row.value);
  }

  async getSummaryStats(
    deviceGroup: string,
    layer: 'top' | 'mid' | 'bottom',
    hours: number = 24
  ): Promise<any[]> {
    const field = `temp-${layer}`;

    const query = `
      SELECT
        MIN("${field}") AS "min",
        MAX("${field}") AS "max",
        MEAN("${field}") AS "avg",
        LAST("${field}") AS "current"
      FROM "${this.measurement}"
      WHERE "device-group" = '${this.escapeString(deviceGroup)}'
        AND time >= now() - ${hours}h
      GROUP BY "device"
    `;

    return this.executeQuery(query);
  }

  /**
   * Escape string values to prevent injection
   * InfluxQL uses single quotes for string literals
   */
  private escapeString(value: string): string {
    return value.replace(/'/g, "\\'");
  }
}
```

## Alternative: Using InfluxDB v1 Client

For better InfluxQL support, consider using the v1-compatible client:

```typescript
import { InfluxDB } from 'influx';

class InfluxDBService {
  private client: InfluxDB;
  private database: string;
  private measurement: string;

  constructor() {
    this.database = process.env.INFLUX_DATABASE || 'cornwatch';
    this.measurement = process.env.INFLUX_MEASUREMENT || 'Temp';

    this.client = new InfluxDB({
      host: process.env.INFLUX_HOST || 'localhost',
      port: parseInt(process.env.INFLUX_PORT || '8086'),
      database: this.database,
      username: process.env.INFLUX_USERNAME,
      password: process.env.INFLUX_PASSWORD,
    });
  }

  async getTemperatureTimeSeries(
    deviceGroup: string,
    layer: 'top' | 'mid' | 'bottom',
    startTime: string,
    endTime: string,
    windowDuration: string = '15m'
  ) {
    const field = `temp-${layer}`;

    const query = `
      SELECT mean("${field}") AS "value"
      FROM "${this.measurement}"
      WHERE "device-group" = $deviceGroup
        AND time >= $startTime
        AND time <= $endTime
      GROUP BY time(${windowDuration}), "device"
      FILL(null)
    `;

    return this.client.query(query, {
      placeholders: {
        deviceGroup,
        startTime,
        endTime,
      },
    });
  }
}
```

## Time Format Notes

InfluxQL supports various time formats:

- **Relative**: `now()`, `now() - 1h`, `now() - 7d`
- **Absolute**: `'2026-01-16T00:00:00Z'` (RFC3339/ISO 8601)
- **Unix timestamp**: `1642291200000000000` (nanoseconds)

## Aggregation Functions

Common aggregation functions in InfluxQL:
- `MEAN()` - Average value
- `SUM()` - Sum of values
- `MIN()` - Minimum value
- `MAX()` - Maximum value
- `FIRST()` - First value chronologically
- `LAST()` - Last value chronologically
- `COUNT()` - Number of values
- `MEDIAN()` - Median value
- `STDDEV()` - Standard deviation

## GROUP BY Time Intervals

- `time(15m)` - 15 minutes
- `time(1h)` - 1 hour
- `time(1d)` - 1 day
- `time(1w)` - 1 week

## Security Notes

- **Always use parameterised queries** when accepting user input
- **Escape string values** properly with `escapeString()`
- **Validate** time ranges, device groups, and field names against allowlists
- **Never concatenate** user input directly into SQL queries
- **Use environment variables** for all database configuration
