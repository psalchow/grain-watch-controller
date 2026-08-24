# API Specification

All API endpoints are mounted under `/api/v1`. The health probe sits outside the
prefix at `/health`.

## Endpoints

### Authentication — `/api/v1/auth`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/login` | Public | Authenticate, return access token + set refresh cookie |
| `POST` | `/auth/refresh` | Refresh cookie | Exchange the refresh cookie for a new access token |
| `POST` | `/auth/logout` | Public | Clear the refresh cookie (always 204) |
| `POST` | `/auth/change-password` | Authenticated | Change own password, clears `mustChangePassword` (204) |

`POST /auth/change-password` takes `{currentPassword, newPassword}`; a wrong
current password returns 401, a new password outside 8–100 characters returns 400.

### Stock data — `/api/v1/stocks`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/stocks` | Authenticated | List accessible stocks |
| `GET` | `/stocks/:stockId/latest` | Authenticated + stock access | Latest readings for a stock |
| `GET` | `/stocks/:stockId/history` | Authenticated + stock access | Aggregated history; `?resolution=day\|week\|month\|year` (required) |

### Fan control — `/api/v1/stocks`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/stocks/:stockId/fan` | Authenticated + stock access | Current fan status |
| `POST` | `/stocks/:stockId/fan/command` | Authenticated + stock access | Send `{action: 'on' \| 'off'}` |
| `GET` | `/stocks/:stockId/fan/stream` | Authenticated + stock access | Server-sent events stream of fan state |

### Admin user management — `/api/v1/admin`

All admin endpoints require an authenticated user with the `admin` role
(401 unauthenticated, 403 otherwise).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/users` | List all users |
| `POST` | `/admin/users` | Create user (forces `mustChangePassword=true`) |
| `PUT` | `/admin/users/:userId/permissions` | Update `role` and/or `stockAccess` |
| `PATCH` | `/admin/users/:userId` | Activate/deactivate (`{active}`); self-deactivation rejected |
| `POST` | `/admin/users/:userId/reset-password` | Set a temporary password, force change on next login (204) |

### Operational

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | Public | Liveness probe — `{status, timestamp, version}` |

When a built PWA is bundled alongside the backend (`FRONTEND_DIST_PATH`), static
assets and an SPA fallback are served from the same origin. Requests under
`/api` and `/health` are never masked by the fallback.

## InfluxDB Integration

- Uses **InfluxQL** (SQL-like syntax) via the InfluxDB 2.x v1 compatibility API
- Configuration via environment variables: URL, token, org, bucket, measurements
- Separate measurements for stock sensors and outdoor temperature/humidity
- Health check query for connectivity verification

## Configuration

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `FRONTEND_DIST_PATH` | `/app/public` | Directory holding the built PWA; API-only when absent |
| `CORS_ALLOWED_ORIGINS` | *(none)* | Comma-separated allowed origins (production only) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(required in prod)* | Access token signing key, min 32 characters |
| `JWT_EXPIRES_IN` | `15m` | Access token expiry |
| `JWT_REFRESH_SECRET` | *(required in prod)* | Refresh token signing key; must differ from `JWT_SECRET` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token expiry |
| `COOKIE_SECURE` | `true` in production | `Secure` attribute on the refresh cookie |
| `COOKIE_SAMESITE` | `lax` | `SameSite` attribute: `lax`, `strict` or `none` |

### InfluxDB

| Variable | Default | Description |
|----------|---------|-------------|
| `INFLUXDB_URL` | `http://localhost:8086` | InfluxDB server URL |
| `INFLUXDB_TOKEN` | *(required)* | InfluxDB API token |
| `INFLUXDB_ORG` | `grainwatch` | InfluxDB organisation |
| `INFLUXDB_BUCKET` | `grainwatch` | InfluxDB bucket |
| `INFLUXDB_MEASUREMENT` | `Temp` | Stock temperature/humidity measurement |
| `INFLUXDB_OUTDOOR_TEMPERATURE_MEASUREMENT` | `outdoor-temperature` | Outdoor temperature measurement |
| `INFLUXDB_OUTDOOR_HUMIDITY_MEASUREMENT` | `outdoor-humidity` | Outdoor humidity measurement |
| `INFLUXDB_OUTDOOR_LOOKBACK` | `1h` in production, `26w` otherwise | Look-back window for the latest outdoor reading |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/grainwatch.db` | SQLite database file path |

On first startup with an empty user table, a default admin (`admin` /
`changeme123`) is seeded with `mustChangePassword=true`, so the first login is
forced through the password-change screen.

### MQTT and fan control

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_URL` | `mqtt://localhost:1883` | MQTT broker URL |
| `MQTT_USERNAME` | *(none)* | MQTT username (optional) |
| `MQTT_PASSWORD` | *(none)* | MQTT password (optional) |
| `FAN_KEEPALIVE_INTERVAL_MS` | `900000` | Keep-alive interval for a running fan |
| `FAN_WATCHDOG_TIMEOUT_MS` | `10000` | Command acknowledgement timeout |
| `FAN_EVENT_RETENTION_DAYS` | `90` | How long fan events are retained |
| `FAN_RETENTION_SWEEP_INTERVAL_MS` | `21600000` | Retention sweep interval |
