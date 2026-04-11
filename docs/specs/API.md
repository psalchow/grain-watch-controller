# API Specification

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/auth/login` | Public | Authenticate, return JWT |
| `POST` | `/api/v1/auth/refresh` | Token | Refresh access token |
| `GET` | `/api/v1/admin/users` | Admin | List all users |
| `POST` | `/api/v1/admin/users` | Admin | Create user |
| `PATCH` | `/api/v1/admin/users/:userId` | Admin | Update user |
| `DELETE` | `/api/v1/admin/users/:userId` | Admin | Delete user |
| `GET` | `/api/v1/stocks` | Authenticated | List accessible stocks |
| `GET` | `/api/v1/stocks/:stockId/latest` | Authenticated + Stock access | Latest readings for a stock |

Further data endpoints will be added as frontend needs become clear.

## InfluxDB Integration

- Uses **InfluxQL** (SQL-like syntax) via the InfluxDB 2.x v1 compatibility API
- Configuration via environment variables: URL, token, org, bucket, measurement
- One working query: fetch latest readings for all devices in a stock
- Health check query for connectivity verification
- All other query patterns to be defined based on frontend requirements

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `JWT_SECRET` | *(required in prod)* | Token signing key |
| `JWT_EXPIRES_IN` | `24h` | Token expiry duration |
| `INFLUXDB_URL` | `http://localhost:8086` | InfluxDB server URL |
| `INFLUXDB_TOKEN` | *(required)* | InfluxDB API token |
| `INFLUXDB_ORG` | `grainwatch` | InfluxDB organisation |
| `INFLUXDB_BUCKET` | `grainwatch` | InfluxDB bucket |
| `INFLUXDB_MEASUREMENT` | `Temp` | InfluxDB measurement name |
| `USERS_FILE_PATH` | `./data/users.json` | User storage file path |
