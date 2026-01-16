# Technical Architecture

## System Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Web/      │────▶│  Grainwatch  │────▶│  InfluxDB   │
│   Mobile    │     │  Controller  │     │  (private)  │
│   Frontend  │◀────│  (BFF API)   │◀────│             │
└─────────────┘     └──────────────┘     └─────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ User Database│
                    │ (Auth/Authz) │
                    └──────────────┘
```

## Technology Stack

- **Runtime**: Node.js 24 LTS ('Krypton')
- **Language**: TypeScript 5.x
- **Web Framework**: Express.js
- **InfluxDB Client**: InfluxDB client with InfluxQL support
- **Query Language**: InfluxQL (SQL-like, not Flux)
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Zod or Joi
- **Testing**: Jest + Supertest
- **Build**: TypeScript compiler (tsc)
- **Process Manager**: PM2 (in Docker)
- **Deployment**: Docker container on Synology

## Project Structure

```
grainwatch-controller/
├── src/
│   ├── controllers/      # HTTP request handlers
│   ├── services/         # Business logic
│   │   ├── influx/      # InfluxDB query service
│   │   └── auth/        # Authentication service
│   ├── middleware/       # Express middleware (auth, validation, error)
│   ├── models/          # TypeScript interfaces/types
│   ├── routes/          # API route definitions
│   ├── config/          # Configuration management
│   └── utils/           # Helper functions
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docker/
│   └── Dockerfile
├── docs/
│   └── design/
├── package.json
├── tsconfig.json
└── .env.example
```

## Key Components

### 1. API Layer (Controllers + Routes)
- Handle HTTP requests/responses
- Input validation
- Route-level authorization checks

### 2. Service Layer
- **InfluxDBService**: Query temperature/humidity data
- **AuthService**: User authentication, token management
- **AuthorizationService**: Permission checks (which stocks user can access)

### 3. Middleware
- **authMiddleware**: Verify JWT tokens
- **errorHandler**: Centralized error handling
- **requestValidator**: Schema validation
- **rateLimiter**: API rate limiting

### 4. Data Models
- User
- GrainStock
- TemperatureReading
- HumidityReading
- AuthToken

## Authentication Flow

```
1. POST /api/v1/auth/login {username, password}
   ↓
2. Validate credentials
   ↓
3. Generate JWT with user claims (id, permissions)
   ↓
4. Return {token, expiresIn}

Subsequent requests:
   Authorization: Bearer <JWT>
   ↓
   Middleware validates token & extracts user context
   ↓
   Controller uses user context for authorization
```

## Data Flow (Temperature Query Example)

```
GET /api/v1/stocks/stock-1/temperature?start=2024-01-01&end=2024-01-31&layer=top
   ↓
1. authMiddleware: Verify JWT → extract user
   ↓
2. Controller: Validate query params
   ↓
3. AuthorizationService: Check user can access stock-1
   ↓
4. InfluxDBService: Query InfluxDB with filters
   ↓
5. Transform data to API response format
   ↓
6. Return JSON response
```

## Configuration

Environment variables:
```
# Server
PORT=3000
NODE_ENV=production

# InfluxDB
INFLUX_URL=http://influxdb:8086
INFLUX_TOKEN=<secret>
INFLUX_ORG=<org>
INFLUX_BUCKET=grain-monitoring

# Auth
JWT_SECRET=<secret>
JWT_EXPIRY=24h

# User Store (TBD)
# Option 1: Simple file-based
# Option 2: SQLite
# Option 3: PostgreSQL
```

## Deployment Architecture

```
Synology Docker Network:
├── influxdb (existing)
├── mqtt-broker (existing)
├── sink-service (existing)
└── grainwatch-controller (new)
    ├── Port: 3000 (internal)
    ├── Reverse Proxy: 443 → 3000 (optional)
    └── Network: Same as InfluxDB (for access)
```

## Next Design Decisions

1. **User storage mechanism** (file/SQLite/PostgreSQL)
2. **Authorization model** (user-to-stock mapping)
3. **InfluxDB schema details** (measurement names, tags, fields)
4. **API versioning strategy**
5. **Logging and monitoring approach**
