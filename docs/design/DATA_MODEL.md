# Data Model

## User Storage (users.json)

```json
{
  "users": [
    {
      "id": "usr_001",
      "username": "admin",
      "passwordHash": "$2b$10$...",
      "email": "admin@example.com",
      "role": "admin",
      "stockAccess": ["*"],
      "createdAt": "2024-08-15T10:00:00Z",
      "active": true
    },
    {
      "id": "usr_002",
      "username": "farmer1",
      "passwordHash": "$2b$10$...",
      "email": "farmer1@example.com",
      "role": "viewer",
      "stockAccess": ["stock-1"],
      "createdAt": "2024-08-15T10:05:00Z",
      "active": true
    },
    {
      "id": "usr_003",
      "username": "farmer2",
      "passwordHash": "$2b$10$...",
      "email": "farmer2@example.com",
      "role": "viewer",
      "stockAccess": ["stock-2"],
      "createdAt": "2024-08-15T10:10:00Z",
      "active": true
    }
  ]
}
```

### User Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique user identifier |
| username | string | Login username (unique) |
| passwordHash | string | Bcrypt hash of password |
| email | string | User email (optional) |
| role | enum | `admin` or `viewer` |
| stockAccess | string[] | Stock IDs user can access. `["*"]` for admin = all stocks |
| createdAt | ISO8601 | Account creation timestamp |
| active | boolean | Account enabled/disabled |

## TypeScript Interfaces

### User Model
```typescript
interface User {
  id: string;
  username: string;
  passwordHash: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[]; // ['*'] for all stocks
  createdAt: string;
  active: boolean;
}

// Sanitised version (no password hash) for API responses
interface UserProfile {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
}
```

### JWT Payload
```typescript
interface JWTPayload {
  userId: string;
  username: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
  iat: number; // Issued at
  exp: number; // Expiry
}
```

### Grain Stock
```typescript
interface GrainStock {
  id: string;          // 'corn-watch-1' or 'corn-watch-2'
  name: string;        // e.g., 'Wheat Storage A'
  description?: string;
  active: boolean;
  createdAt: string;
}
```

### Temperature Reading
```typescript
interface TemperatureReading {
  timestamp: string;    // ISO8601
  stockId: string;
  layer: 'bottom' | 'mid' | 'top';
  temperature: number;  // Celsius
  deviceId: string;
}

// Aggregated response
interface TemperatureDataPoint {
  timestamp: string;
  stockId: string;
  value: number;
  deviceId: string;
}
```

### Humidity Reading
```typescript
interface HumidityReading {
  timestamp: string;    // ISO8601
  stockId: string;
  humidity: number;     // Percentage (0-100)
  temperature: number;  // Celsius
  deviceId: string;
}
```

## API Response Formats

### Stock List Response
```typescript
interface StockListResponse {
  stocks: GrainStock[];
  total: number;
}
```

### Temperature Query Response
```typescript
interface TemperatureQueryResponse {
  data: TemperatureDataPoint[];
  meta: {
    stockId: string;
    stockName: string;
    layer?: string;
    deviceId?: string;
    period: {
      start: string;
      end: string;
    };
    count: number;
  };
}
```

### Latest Readings Response
```typescript
interface LatestReadingsResponse {
  stockId: string;
  stockName: string;
  timestamp: string;
  temperature: {
    bottom: number[];  // 5 values
    mid: number[];     // 5 values
    top: number[];     // 5 values
  };
  humidity: number[];  // 5 values (mid layer)
}
```

## InfluxDB Schema (Confirmed)

**InfluxDB Configuration** (all must be environment variables):
- **Organization**: `cornwatch` → `INFLUX_ORG`
- **Bucket**: `cornwatch` → `INFLUX_BUCKET`
- **Measurement**: `Temp` → `INFLUX_MEASUREMENT` (configurable)

**Data Structure:**

```
Measurement: Temp (configurable via env)
  Tags:
    - device-group: Grain stock identifier (e.g., 'corn-watch-1')
    - device: Individual measurement spot (e.g., '1.1', '1.2', '1.3', '1.4', '1.5')
              Format: {device-group-number}.{spot-number}

  Fields:
    - temp-top (float): Temperature at top layer (°C)
    - temp-mid (float): Temperature at middle layer (°C)
    - temp-bottom (float): Temperature at bottom layer (°C)
    - temp-humidity (float): Temperature from humidity sensor, middle layer (°C)
    - humidity (uint): Relative humidity percentage (0-100)
    - batteryMV (uint): Battery voltage in centi-volts
    - measurementTimeS (uint): Actual measurement timestamp (seconds since epoch)

  Timestamp: When device sent the data (may differ from measurementTimeS)
```

**Key Notes:**
- Each device sends all temperature layers + humidity in single data point
- 5 measurement spots per grain stock (devices .1 through .5)
- Measurements taken less frequently (e.g., 15 min) but sent more frequently (e.g., 5 sec)
- Same measurement repeated until next actual reading
- Device numbering: First digit = device-group, second digit = spot number

**Example Data Point:**
```
Time: 2026-01-16T09:04:10Z
Tags: device-group=corn-watch-1, device=1.1
Fields:
  temp-top: 10.13°C
  temp-mid: 11.13°C
  temp-bottom: 9.38°C
  temp-humidity: 11.1°C
  humidity: 89%
  batteryMV: 436cV
  measurementTimeS: 1768553708
```

**Configuration Requirements:**
```env
# InfluxDB Configuration
INFLUX_URL=http://influxdb:8086
INFLUX_TOKEN=<secret-token>
INFLUX_ORG=cornwatch          # Configurable
INFLUX_BUCKET=cornwatch       # Configurable
INFLUX_MEASUREMENT=Temp       # Configurable

# NEVER hardcode these values in code
```

## Authorization Examples

```typescript
// Admin user
{
  role: 'admin',
  stockAccess: ['*']  // Can access all stocks
}

// Viewer with stock-1 access
{
  role: 'viewer',
  stockAccess: ['stock-1']  // Can only query stock-1 data
}

// Viewer with multiple stocks
{
  role: 'viewer',
  stockAccess: ['stock-1', 'stock-2']
}
```

### Authorization Check Logic

```typescript
function canAccessStock(user: User, stockId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.stockAccess.includes('*')) return true;
  return user.stockAccess.includes(stockId);
}
```
