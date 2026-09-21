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
| `INFLUXDB_LATEST_LOOKBACK` | `6h` in production, `26w` otherwise | Look-back window for all latest values (sensor readings and outdoor conditions); older readings are dropped |
| `INFLUXDB_OFFLINE_AFTER` | `1h` in production, `26w` otherwise, clamped to `INFLUXDB_LATEST_LOOKBACK` | Age at which a reading is flagged `offline`; an explicitly set value must not exceed the look-back window |
| `INFLUXDB_OUTDOOR_MAX_SKEW` | `30m` | How far the outdoor temperature and humidity timestamps may lie apart and still be combined into dew point and absolute humidity |

All three durations must be greater than zero; `0h` and friends are rejected at
startup rather than silently emptying every query.

`INFLUXDB_OUTDOOR_LOOKBACK` was replaced by `INFLUXDB_LATEST_LOOKBACK`; the
backend refuses to start while the old name is still set.

### Staleness of latest values

One window governs stock sensors and outdoor conditions alike:

1. Fresh reading — value and timestamp are reported, `offline` is `false`.
2. Older than `INFLUXDB_OFFLINE_AFTER` — still reported, `offline` is `true`.
   The PWA greys out the sensor card and the outdoor chip alike.
3. Older than `INFLUXDB_LATEST_LOOKBACK` — no longer reported. The sensor card
   disappears; outdoor values fall back to `–`.

A stale sensor card keeps its temperature colour: the colour is the app's only
alarm channel, and a probe in a self-heating spot tends to fall silent exactly
when that alarm matters. Dimming and the "Offline" label carry the staleness.

Stock probes measure every 15 minutes and publish every 5 minutes, so the
production defaults leave room for several missed transmissions before a card
greys out, and many more before it disappears.

Outdoor temperature and humidity are queried separately and age independently:
both `lastMeasurement` and `offline` follow the older of the two, so the
reported age matches the flag. One value present and the other missing also
counts as offline; `lastMeasurement` then reports the surviving value's age and
the missing half shows as `null`. `offlineReason` names the cause
(`'stale'` or `'partner-missing'`) so clients do not re-derive the rule. Neither present does not count as offline (the
stock simply has no outdoor sensor). When the two timestamps lie further apart than
`INFLUXDB_OUTDOOR_MAX_SKEW`, `dewPoint` and `absoluteHumidity` are reported as
`null`, because a figure derived from two different instants would be
misleading; `derivedUnavailableReason` is then `'skew'` and the PWA says so
instead of showing bare dashes. A derived value that is simply not computable
(0 % relative humidity drives the dew point to negative infinity) is reported as
`null` with no reason. The default
keeps twice the guaranteed publish interval as headroom so ordinary jitter does
not blank the values.

The two response shapes time their `offline` flag differently:

- Stock readings compare the device-reported `measurementTimeS`, not the
  InfluxDB ingest time that bounds the look-back window, so a skewed device
  clock shifts the flag. A reading without a timestamp is not flagged.
- Outdoor conditions compare the InfluxDB `time` of the `LAST()` point.

`GET /stocks/:stockId/latest` answers 200 even when no reading is current:
`devices` is then empty and `timestamp` is `null`. A 404 means the stock itself
is unknown. History is unaffected by these windows and stays available while the
sensors are silent.

`fanControlEnabled` reports whether the fan endpoints will serve the stock: the
stock row still asks for fan control **and** a controller exists for it. Those
are the same two conditions the fan endpoints check, so the field never
advertises a call that answers 404. It does not promise the broker is reachable
— controllers are built from the wiring at startup. Whether the control is
answering travels as `fanControlReachable` in the fan status.

`fanControlReachable` carries the control's last connection state as reported by
the broker: `true` while it is connected, `false` once it dropped off, `null`
until it has been heard from at all. Two limits are worth knowing. A loss
surfaces only once the broker gives up on the device, which takes a multiple of
the device's own keep-alive interval — so the field says "was answering
recently", not "is answering this second". And it tracks reports *about* the
device only: if the backend loses its own link to the broker, no report can
arrive and the last value stands unchanged (see `docs/BACKLOG.md`).

### Device rosters

Neither endpoint takes the number of probes from the stock configuration: the
latest view lists whatever the device group reported inside the look-back
window, and the history lists every device that has a point in the requested
range, in any layer. A stock where only some of the five positions are fitted
therefore shows exactly the ones that exist.

This is deliberate, and it cuts both ways: a probe that reported nothing across
the whole requested range is indistinguishable from a position that was never
fitted. It has no entry in `devices`, no series, and no legend entry in the
chart — on the year view a probe must have been silent for a year to disappear,
on the day view since midnight. Neither response carries an expected roster to
compare against, because no such roster is configured any more.

### Stocks without grain thermometers

`hasGrainSensors = false` marks a stock that only has fan control: neither
endpoint queries InfluxDB for stock sensors, `devices` and the history series
stay empty, and the PWA shows fan control and outdoor conditions only.

The column defaults to `true` and there is no admin UI for stocks yet, so it is
currently set by hand against the SQLite file:

```sql
UPDATE stocks SET has_grain_sensors = 0 WHERE id = '<stock-id>';
```

Fan controllers are built once at startup from the stock rows, so the two
directions of a hand-edit differ:

- Clearing `fan_control_enabled` takes effect within one reconciliation tick
  (`FAN_RECONCILE_INTERVAL_MS`, 60 s by default), whether or not anyone is using
  the app. The stock stops being serviceable at once — every fan endpoint
  answers 404, an open SSE stream ends with a `disabled` event, and
  `fanControlEnabled` reports `false`. The tick then stops driving the fan,
  sends one last `off` and forgets the wiring.

  That single command is deliberate. Withdrawing fan control is a rare, planned
  change with people on site, the fan is practically never running at that
  moment, and the Shelly switches itself off after one to two hours without a
  keep-alive signal — so the backend does not track acknowledgements or retry.
  A row cleared while the service was down is caught at the next startup, where
  the stale desired state is cleared so a later re-enable cannot resume the fan.

- Setting `fan_control_enabled` (or adding a `fan_topic_prefix`) needs a restart
  to build the controller. Until then the stock reports `false` and the
  endpoints answer 404.

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
| `FAN_RECONCILE_INTERVAL_MS` | `60000` | How often the stock rows are re-read to catch fan control being revoked; at least 1000 ms |
