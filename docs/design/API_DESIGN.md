# API Design

All endpoints use RESTful conventions and return JSON.

## Authentication Endpoints

### POST /api/v1/auth/login
Authenticate user and receive JWT token.

**Request:**
```json
{
  "username": "admin",
  "password": "secret123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "user": {
    "id": "usr_001",
    "username": "admin",
    "role": "admin",
    "stockAccess": ["*"]
  }
}
```

**Errors:**
- 401: Invalid credentials
- 400: Missing username/password

### POST /api/v1/auth/refresh
Refresh JWT token (optional, for extended sessions).

**Headers:**
```
Authorization: Bearer <current-token>
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

---

## Data Query Endpoints

All data endpoints require authentication via JWT.

### GET /api/v1/stocks
List all grain stocks accessible to the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "stocks": [
    {
      "id": "corn-watch-1",
      "name": "Grain Stock 1",
      "description": "Main storage facility",
      "deviceCount": 5,
      "active": true
    },
    {
      "id": "corn-watch-2",
      "name": "Grain Stock 2",
      "description": "Secondary storage",
      "deviceCount": 5,
      "active": true
    }
  ],
  "total": 2
}
```

**Notes:**
- Admins see all stocks
- Viewers see only assigned stocks from their `stockAccess` array

---

### GET /api/v1/stocks/{stockId}/latest
Get the most recent readings for all devices in a grain stock.

**Parameters:**
- `stockId`: Grain stock identifier (e.g., `corn-watch-1`)

**Response (200):**
```json
{
  "stockId": "corn-watch-1",
  "stockName": "Grain Stock 1",
  "timestamp": "2026-01-16T09:04:10Z",
  "devices": [
    {
      "device": "1.1",
      "temperature": {
        "top": 10.13,
        "mid": 11.13,
        "bottom": 9.38
      },
      "humidity": 89,
      "batteryMV": 436,
      "lastMeasurement": "2026-01-16T08:48:28Z"
    },
    {
      "device": "1.2",
      "temperature": {
        "top": 6.0,
        "mid": 9.63,
        "bottom": 8.88
      },
      "humidity": 54,
      "batteryMV": 429,
      "lastMeasurement": "2026-01-16T08:49:10Z"
    }
    // ... devices 1.3, 1.4, 1.5
  ]
}
```

**Errors:**
- 403: User not authorised to access this stock
- 404: Stock not found

---

### GET /api/v1/stocks/{stockId}/temperature
Get temperature time series data.

**Parameters:**
- `stockId`: Grain stock identifier

**Query Parameters:**
- `start` (required): ISO 8601 timestamp (e.g., `2026-01-15T00:00:00Z`)
- `end` (required): ISO 8601 timestamp
- `layer` (optional): `top`, `mid`, or `bottom` (default: all layers)
- `device` (optional): Specific device (e.g., `1.1`) or omit for all devices
- `window` (optional): Aggregation window (e.g., `15m`, `1h`, `1d`) (default: `15m`)

**Example Request:**
```
GET /api/v1/stocks/corn-watch-1/temperature?start=2026-01-15T00:00:00Z&end=2026-01-16T00:00:00Z&layer=top&window=1h
```

**Response (200):**
```json
{
  "data": [
    {
      "timestamp": "2026-01-15T00:00:00Z",
      "device": "1.1",
      "value": 10.5
    },
    {
      "timestamp": "2026-01-15T00:00:00Z",
      "device": "1.2",
      "value": 6.2
    },
    {
      "timestamp": "2026-01-15T01:00:00Z",
      "device": "1.1",
      "value": 10.3
    }
    // ... more data points
  ],
  "meta": {
    "stockId": "corn-watch-1",
    "stockName": "Grain Stock 1",
    "layer": "top",
    "period": {
      "start": "2026-01-15T00:00:00Z",
      "end": "2026-01-16T00:00:00Z"
    },
    "window": "1h",
    "count": 120
  }
}
```

**Errors:**
- 400: Invalid date format or missing required parameters
- 403: User not authorised to access this stock

---

### GET /api/v1/stocks/{stockId}/humidity
Get humidity time series data.

**Parameters:**
- `stockId`: Grain stock identifier

**Query Parameters:**
- `start` (required): ISO 8601 timestamp
- `end` (required): ISO 8601 timestamp
- `device` (optional): Specific device (e.g., `1.1`) or omit for all devices
- `window` (optional): Aggregation window (default: `15m`)

**Response (200):**
```json
{
  "data": [
    {
      "timestamp": "2026-01-15T00:00:00Z",
      "device": "1.1",
      "value": 89
    },
    {
      "timestamp": "2026-01-15T00:00:00Z",
      "device": "1.2",
      "value": 54
    }
    // ... more data points
  ],
  "meta": {
    "stockId": "corn-watch-1",
    "stockName": "Grain Stock 1",
    "period": {
      "start": "2026-01-15T00:00:00Z",
      "end": "2026-01-16T00:00:00Z"
    },
    "window": "1h",
    "count": 120
  }
}
```

---

### GET /api/v1/stocks/{stockId}/summary
Get aggregated statistics for a time period.

**Parameters:**
- `stockId`: Grain stock identifier

**Query Parameters:**
- `period` (optional): `24h`, `7d`, `30d` (default: `24h`)
- `layer` (optional): `top`, `mid`, `bottom` (default: all layers)

**Response (200):**
```json
{
  "stockId": "corn-watch-1",
  "stockName": "Grain Stock 1",
  "period": "24h",
  "summary": {
    "temperature": {
      "top": {
        "min": 6.0,
        "max": 10.5,
        "avg": 8.9,
        "current": 10.13
      },
      "mid": {
        "min": 9.1,
        "max": 11.5,
        "avg": 10.2,
        "current": 11.13
      },
      "bottom": {
        "min": 7.5,
        "max": 9.8,
        "avg": 8.7,
        "current": 9.38
      }
    },
    "humidity": {
      "min": 54,
      "max": 89,
      "avg": 68,
      "current": 73
    }
  },
  "deviceStatus": [
    {
      "device": "1.1",
      "batteryMV": 436,
      "batteryStatus": "good",
      "lastSeen": "2026-01-16T09:04:10Z"
    },
    {
      "device": "1.2",
      "batteryMV": 429,
      "batteryStatus": "good",
      "lastSeen": "2026-01-16T09:04:10Z"
    }
    // ... all devices
  ]
}
```

---

### GET /api/v1/stocks/{stockId}/battery
Get battery status for all devices in a stock.

**Parameters:**
- `stockId`: Grain stock identifier

**Response (200):**
```json
{
  "stockId": "corn-watch-1",
  "stockName": "Grain Stock 1",
  "devices": [
    {
      "device": "1.1",
      "battery": 4.36,
      "batteryStatus": "good",
      "lastSeen": "2026-01-16T09:04:10Z"
    },
    {
      "device": "1.2",
      "battery": 3.29,
      "batteryStatus": "low",
      "lastSeen": "2026-01-16T09:04:10Z"
    }
    // ... all devices
  ],
  "alerts": [
    {
      "device": "1.2",
      "message": "Low battery: 3.29V"
    }
  ]
}
```

**Battery Status Thresholds:**
- `good`: > 3.70V
- `low`: 3.40-3.70V
- `critical`: < 3.40V

---

## Admin Endpoints

Require `admin` role.

### GET /api/v1/admin/users
List all users.

**Response (200):**
```json
{
  "users": [
    {
      "id": "usr_001",
      "username": "admin",
      "email": "admin@example.com",
      "role": "admin",
      "stockAccess": ["*"],
      "active": true,
      "createdAt": "2024-08-15T10:00:00Z"
    }
    // ... more users
  ]
}
```

### POST /api/v1/admin/users
Create a new user.

**Request:**
```json
{
  "username": "farmer3",
  "password": "secure123",
  "email": "farmer3@example.com",
  "role": "viewer",
  "stockAccess": ["corn-watch-1"]
}
```

**Response (201):**
```json
{
  "id": "usr_004",
  "username": "farmer3",
  "email": "farmer3@example.com",
  "role": "viewer",
  "stockAccess": ["corn-watch-1"],
  "active": true,
  "createdAt": "2026-01-16T10:00:00Z"
}
```

### PUT /api/v1/admin/users/{userId}/permissions
Update user permissions.

**Request:**
```json
{
  "role": "admin",
  "stockAccess": ["*"]
}
```

**Response (200):**
```json
{
  "id": "usr_004",
  "username": "farmer3",
  "role": "admin",
  "stockAccess": ["*"],
  "updatedAt": "2026-01-16T10:05:00Z"
}
```

### PATCH /api/v1/admin/users/{userId}
Update user status (activate/deactivate).

**Request:**
```json
{
  "active": false
}
```

---

## Standard Response Format

### Success Response
```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-01-16T10:00:00Z",
    ...
  }
}
```

### Error Response
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid credentials",
    "details": "Username or password is incorrect"
  }
}
```

### Error Codes
- `UNAUTHORIZED` (401): Authentication failed
- `FORBIDDEN` (403): User lacks permission
- `NOT_FOUND` (404): Resource not found
- `BAD_REQUEST` (400): Invalid request parameters
- `INTERNAL_ERROR` (500): Server error

---

## Notes

- All timestamps use ISO 8601 format with UTC timezone
- Temperature values in degrees Celsius
- Humidity values as percentage (0-100)
- Battery voltage in millivolts (mV)
- Stock IDs match the `device-group` tag in InfluxDB (e.g., `corn-watch-1`)
- Device IDs match the `device` tag (e.g., `1.1`, `1.2`, etc.)
