# Simplify BFF to Match New Spec — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the codebase down to match the simplified spec — remove unused InfluxDB query methods, remove extra stock endpoints, simplify models and exports, and update tests accordingly.

**Architecture:** The existing layered architecture (controllers → services → InfluxDB) stays the same. We're removing code, not restructuring. The InfluxDB service keeps `getLatestReadings`, `getDeviceGroups`, and `testConnection`. The stocks controller keeps `listStocks` and `getLatestReadings`. All other query methods, endpoints, and their associated types/tests are removed.

**Tech Stack:** TypeScript, Express.js, Jest + Supertest

---

### Task 1: Simplify InfluxDB Service

**Files:**
- Modify: `src/services/influx/influx.service.ts`
- Modify: `src/services/influx/index.ts`

- [ ] **Step 1: Remove unused query methods and types from influx.service.ts**

Keep: `DeviceReading`, `InfluxQueryResult`, `InfluxDBService` (with `executeQuery`, `escapeString`, `escapeMeasurement`, `getLatestReadings`, `getDeviceGroups`, `testConnection`).

Remove: `TimeSeriesPoint`, `SummaryStats`, `BatteryStatus`, `WindowDuration`, `isValidWindowDuration`, `validateLayer`, `validateTimeFormat`, `validateWindowDuration`, `getTemperatureTimeSeries`, `getHumidityTimeSeries`, `getSummaryStats`, `getBatteryStatus`.

The file should look like this after the change:

```typescript
import { config } from '../../config';

export interface DeviceReading {
  device: string;
  tempTop: number | null;
  tempMid: number | null;
  tempBottom: number | null;
  humidity: number | null;
  battery: number | null;
  measurementTime: string | null;
}

interface InfluxQueryResult {
  results: Array<{
    series?: Array<{
      name: string;
      columns: string[];
      values: Array<Array<string | number | null>>;
      tags?: Record<string, string>;
    }>;
  }>;
}

export class InfluxDBService {
  private readonly url: string;
  private readonly token: string;
  private readonly bucket: string;
  private readonly measurement: string;

  constructor() {
    this.url = config.influxdb.url;
    this.token = config.influxdb.token;
    this.bucket = config.influxdb.bucket;
    this.measurement = config.influxdb.measurement;
  }

  private async executeQuery(query: string): Promise<InfluxQueryResult> {
    const queryUrl = `${this.url}/query?db=${encodeURIComponent(this.bucket)}&q=${encodeURIComponent(query)}`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`InfluxDB query failed: ${response.statusText}`);
    }

    return await response.json() as InfluxQueryResult;
  }

  private escapeString(value: string): string {
    return value.replace(/'/g, "\\'");
  }

  private escapeMeasurement(name: string): string {
    return `"${name.replace(/"/g, '\\"')}"`;
  }

  async getLatestReadings(deviceGroup: string): Promise<DeviceReading[]> {
    const escapedGroup = this.escapeString(deviceGroup);

    const query = `
      SELECT
        LAST("temp-top") AS "temp_top",
        LAST("temp-mid") AS "temp_mid",
        LAST("temp-bottom") AS "temp_bottom",
        LAST("humidity") AS "humidity",
        LAST("batteryMV") AS "battery",
        LAST("measurementTimeS") AS "measurement_time"
      FROM ${this.escapeMeasurement(this.measurement)}
      WHERE "device-group" = '${escapedGroup}'
        AND time > now() - 1h
      GROUP BY "device"
    `;

    const result = await this.executeQuery(query);
    const deviceMap = new Map<string, DeviceReading>();

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        const device = series.tags?.device;
        if (!device || !series.values || series.values.length === 0) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        const row = series.values[0];
        if (!row) continue;

        const measurementTimeS = row[columnMap.get('measurement_time') ?? -1] as number | null;

        deviceMap.set(device, {
          device,
          tempTop: (row[columnMap.get('temp_top') ?? -1] as number | null) ?? null,
          tempMid: (row[columnMap.get('temp_mid') ?? -1] as number | null) ?? null,
          tempBottom: (row[columnMap.get('temp_bottom') ?? -1] as number | null) ?? null,
          humidity: (row[columnMap.get('humidity') ?? -1] as number | null) ?? null,
          battery: (row[columnMap.get('battery') ?? -1] as number | null) ?? null,
          measurementTime: measurementTimeS
            ? new Date(measurementTimeS * 1000).toISOString()
            : null,
        });
      }
    }

    return Array.from(deviceMap.values());
  }

  async getDeviceGroups(): Promise<string[]> {
    const query = `SHOW TAG VALUES FROM ${this.escapeMeasurement(this.measurement)} WITH KEY = "device-group"`;

    const result = await this.executeQuery(query);
    const groups: string[] = [];

    for (const queryResult of result.results) {
      if (!queryResult.series) continue;

      for (const series of queryResult.series) {
        if (!series.values) continue;

        const columnMap = new Map<string, number>();
        series.columns.forEach((col, idx) => columnMap.set(col, idx));

        for (const row of series.values) {
          const value = row[columnMap.get('value') ?? -1];
          if (typeof value === 'string') {
            groups.push(value);
          }
        }
      }
    }

    return groups;
  }

  async testConnection(): Promise<boolean> {
    try {
      const query = `SHOW MEASUREMENTS LIMIT 1`;
      await this.executeQuery(query);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to InfluxDB: ${message}`);
    }
  }
}
```

- [ ] **Step 2: Update influx/index.ts exports**

Replace contents with:

```typescript
export { InfluxDBService, DeviceReading } from './influx.service';
```

- [ ] **Step 3: Compile to check for errors**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Errors in files that still import removed types (stocks controller, services index, etc.) — these will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/services/influx/
git commit -m "refactor: strip InfluxDB service to getLatestReadings, getDeviceGroups, testConnection"
```

---

### Task 2: Simplify Stocks Controller

**Files:**
- Modify: `src/controllers/stocks.controller.ts`

- [ ] **Step 1: Replace stocks controller with simplified version**

Keep `listStocks` and `getLatestReadings` only. Remove `getTemperatureData`, `getHumidityData`, `getSummary`, `getBatteryData`, `determineBatteryStatus`, `BATTERY_THRESHOLDS`, `PERIOD_TO_HOURS`, and the `WindowDuration`/`isValidWindowDuration` imports.

```typescript
import { Request, Response, NextFunction } from 'express';
import { InfluxDBService } from '../services/influx';
import { NotFoundError } from '../middleware';

interface StockMetadata {
  name: string;
  description: string;
  deviceCount: number;
}

const STOCK_METADATA: Record<string, StockMetadata> = {
  'corn-watch-1': {
    name: 'Grain Stock 1',
    description: 'Main storage facility',
    deviceCount: 5,
  },
  'corn-watch-2': {
    name: 'Grain Stock 2',
    description: 'Secondary storage',
    deviceCount: 5,
  },
};

export class StocksController {
  private readonly influxService: InfluxDBService;

  constructor(influxService: InfluxDBService) {
    this.influxService = influxService;
  }

  async listStocks(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      const deviceGroups = await this.influxService.getDeviceGroups();

      const accessibleStocks = deviceGroups.filter((stockId) => {
        if (user.stockAccess.includes('*')) {
          return true;
        }
        return user.stockAccess.includes(stockId);
      });

      const stocks = accessibleStocks.map((stockId) => {
        const metadata = STOCK_METADATA[stockId];
        return {
          id: stockId,
          name: metadata?.name ?? stockId,
          description: metadata?.description ?? '',
          deviceCount: metadata?.deviceCount ?? 5,
          active: true,
        };
      });

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

      const readings = await this.influxService.getLatestReadings(stockId);

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

      const metadata = STOCK_METADATA[stockId];

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
      });
    } catch (error) {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/stocks.controller.ts
git commit -m "refactor: strip stocks controller to listStocks and getLatestReadings"
```

---

### Task 3: Simplify Stock Routes

**Files:**
- Modify: `src/routes/stocks.routes.ts`

- [ ] **Step 1: Replace stock routes with simplified version**

Remove temperature, humidity, summary, and battery routes. Remove unused imports (`stockQuerySchema`, `z`).

```typescript
import { Router } from 'express';
import { StocksController } from '../controllers';
import { influxService } from '../services';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  stockIdParamsSchema,
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

  return router;
}

export const stocksRouter = createStocksRouter();
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/stocks.routes.ts
git commit -m "refactor: strip stock routes to list and latest only"
```

---

### Task 4: Clean Up Models

**Files:**
- Modify: `src/models/measurement.model.ts`
- Modify: `src/models/api.model.ts`
- Modify: `src/models/index.ts`

- [ ] **Step 1: Simplify measurement.model.ts**

Keep only the `Layer` type (still used by the InfluxDB schema concept). Remove `TemperatureReading`, `TemperatureDataPoint`, `HumidityReading`, `HumidityDataPoint`, `RawMeasurement`.

```typescript
export type Layer = 'top' | 'mid' | 'bottom';
```

- [ ] **Step 2: Simplify api.model.ts**

Remove types that reference removed functionality: `TemperatureQueryMeta`, `TemperatureQueryResponse`, `LayeredTemperatures`, `LatestReadingsResponse`, `QueryPeriod`. Remove the `TemperatureDataPoint` import. Keep `StockListResponse`, `ErrorResponse`, `ApiResponse`, `PaginatedResponse`, `AuthTokenResponse`.

```typescript
import { GrainStock } from './stock.model';

export interface StockListResponse {
  stocks: GrainStock[];
  total: number;
}

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
  details?: unknown;
  timestamp: string;
  path?: string;
}

export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
```

- [ ] **Step 3: Update models/index.ts exports**

```typescript
export {
  User,
  UserProfile,
  UserRole,
  JWTPayload,
} from './user.model';

export {
  GrainStock,
  DeviceId,
  DeviceGroup,
  SpotNumber,
} from './stock.model';

export {
  Layer,
} from './measurement.model';

export {
  StockListResponse,
  ErrorResponse,
  ApiResponse,
  PaginatedResponse,
  AuthTokenResponse,
} from './api.model';
```

- [ ] **Step 4: Commit**

```bash
git add src/models/
git commit -m "refactor: remove unused model types for removed endpoints"
```

---

### Task 5: Clean Up Service and Middleware Exports

**Files:**
- Modify: `src/services/index.ts`
- Modify: `src/middleware/index.ts`
- Modify: `src/middleware/validation.middleware.ts`

- [ ] **Step 1: Update services/index.ts**

Remove re-exports of deleted types (`TimeSeriesPoint`, `SummaryStats`, `BatteryStatus`, `WindowDuration`, `isValidWindowDuration`).

```typescript
import { InfluxDBService } from './influx';
import { UserService, AuthService } from './auth';

export const influxService = new InfluxDBService();
export const userService = new UserService();
export const authService = new AuthService(userService);

export { InfluxDBService } from './influx';
export { UserService, AuthService, UserServiceError, AuthenticationError } from './auth';
export type {
  CreateUserData,
  UpdateUserData,
  LoginResult,
  DecodedToken,
} from './auth';
export type { DeviceReading } from './influx';
```

- [ ] **Step 2: Remove stockQuerySchema and layerEnum from validation.middleware.ts**

Remove: `layerEnum`, `Layer` type, `isoDateTimeString`, `stockQuerySchema`, `StockQueryParams`. Keep everything else (login, user CRUD schemas, stockIdParamsSchema, userIdParamsSchema, `validateBody`, `validateQuery`, `validateParams`, `formatZodErrors`, `userRoleEnum`).

The schemas to remove are at lines 192-249 of `validation.middleware.ts`. After removal, the file keeps: `validateBody`, `validateQuery`, `validateParams`, `formatZodErrors`, `loginSchema`, `userRoleEnum`, `createUserSchema`, `updateUserSchema`, `stockIdParamsSchema`, `userIdParamsSchema`.

- [ ] **Step 3: Update middleware/index.ts**

Remove `stockQuerySchema`, `layerEnum`, `StockQueryParams`, `Layer` from exports.

```typescript
export {
  authenticate,
  requireRole,
  requireStockAccess,
  setAuthService,
  getAuthService,
} from './auth.middleware';

export {
  errorHandler,
  notFoundHandler,
  ValidationError,
  HttpError,
  NotFoundError,
} from './error.middleware';

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
} from './validation.middleware';

export type {
  LoginRequest,
  CreateUserRequest,
  UpdateUserRequest,
  StockIdParams,
  UserIdParams,
  UserRole,
} from './validation.middleware';
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/index.ts src/middleware/
git commit -m "refactor: clean up service and middleware exports"
```

---

### Task 6: Update InfluxDB Service Tests

**Files:**
- Modify: `tests/unit/services/influx.service.test.ts`

- [ ] **Step 1: Remove tests for deleted methods**

Remove test blocks for: `getTemperatureTimeSeries`, `getHumidityTimeSeries`, `getSummaryStats`, `getBatteryStatus`, `isValidWindowDuration`, `validateLayer`, `validateTimeFormat`, `validateWindowDuration`.

Keep test blocks for: `constructor`, `getLatestReadings`, `getDeviceGroups`, `testConnection`, and any `escapeString`/`escapeMeasurement` tests.

Also remove the `WindowDuration` and `isValidWindowDuration` imports — only import `InfluxDBService` and `DeviceReading`.

- [ ] **Step 2: Run tests to verify**

Run: `npx jest tests/unit/services/influx.service.test.ts --verbose`

Expected: All remaining tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/services/influx.service.test.ts
git commit -m "test: remove tests for deleted InfluxDB query methods"
```

---

### Task 7: Update Stock Integration Tests

**Files:**
- Modify: `tests/integration/stocks.test.ts`

- [ ] **Step 1: Simplify mock setup and remove tests for deleted endpoints**

Remove: mock functions for `getTemperatureTimeSeries`, `getHumidityTimeSeries`, `getSummaryStats`, `getBatteryStatus`. Remove `isValidWindowDuration` from the mock. Remove describe blocks for `GET /api/v1/stocks/:stockId/temperature`, `GET /api/v1/stocks/:stockId/humidity`, `GET /api/v1/stocks/:stockId/summary`, `GET /api/v1/stocks/:stockId/battery`.

Update the mock to only expose `getDeviceGroups`, `getLatestReadings`, and `testConnection`:

```typescript
jest.mock('../../src/services/influx/influx.service', () => {
  const mockGetDeviceGroups = jest.fn();
  const mockGetLatestReadings = jest.fn();

  return {
    InfluxDBService: jest.fn().mockImplementation(() => ({
      getDeviceGroups: mockGetDeviceGroups,
      getLatestReadings: mockGetLatestReadings,
      testConnection: jest.fn().mockResolvedValue(true),
    })),
    __mockGetDeviceGroups: mockGetDeviceGroups,
    __mockGetLatestReadings: mockGetLatestReadings,
  };
});
```

Update the `beforeEach` to only set up `mockGetDeviceGroups` and `mockGetLatestReadings`. Keep all tests under `GET /api/v1/stocks` and `GET /api/v1/stocks/:stockId/latest`.

- [ ] **Step 2: Run tests to verify**

Run: `npx jest tests/integration/stocks.test.ts --verbose`

Expected: All remaining tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/stocks.test.ts
git commit -m "test: remove integration tests for deleted stock endpoints"
```

---

### Task 8: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose`

Expected: All tests pass. No references to removed types or methods.

- [ ] **Step 2: Run TypeScript compilation check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Run linter**

Run: `npx eslint src/ tests/ --ext .ts`

Expected: No new errors introduced.
