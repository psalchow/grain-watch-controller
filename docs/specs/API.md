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
| `GET` | `/stocks/:stockId/fan/automation` | Authenticated + stock access | Automation switch and parameters |
| `PUT` | `/stocks/:stockId/fan/automation` | Authenticated + stock access | Set the switch and the parameters in one call |

### Admin user management — `/api/v1/admin`

All admin endpoints require an authenticated user with the `admin` role
(401 unauthenticated, 403 otherwise).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/tenants` | List all tenants — `{ tenants: [{ id, name }] }` |
| `GET` | `/admin/users` | List all users |
| `POST` | `/admin/users` | Create user (forces `mustChangePassword=true`) |
| `PUT` | `/admin/users/:userId/permissions` | Update `role` and/or `tenantIds` |
| `PATCH` | `/admin/users/:userId` | Activate/deactivate (`{active}`); self-deactivation rejected |
| `POST` | `/admin/users/:userId/reset-password` | Set a temporary password, force change on next login (204) |

`POST /admin/users` and `PUT /admin/users/:userId/permissions` take
`tenantIds: string[]`, capped at one entry — an unknown tenant, or more than
one, answers 400. `GET /admin/users`, `POST /admin/users` and
`PUT /admin/users/:userId/permissions` all answer `tenants: [{ id, name }]` per
user, so the three agree on one shape.

Tenants are created with SQL on the NAS, exactly like hall configuration
below — the API only lists them, so an administrator can choose one when
creating a user. There is no create, rename, delete or deactivation.

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

### Fan automation

Automation is available for a stock when it has fan control **and** grain
thermometers — not a stored flag, derived the same way `fanControlEnabled`
above is: v1 implements the differential rule only, which has nothing to
compare without a grain reading. Whether automation is switched on is a
separate, stored flag, off by default.

Both endpoints sit behind `authenticate` and `requireStockAccess` only, no role
check beyond that — the same shape as `POST …/fan/command` right next to them.
That the `viewer` role can therefore write here is a known, recorded
contradiction (see `docs/BACKLOG.md`).

`GET /stocks/:stockId/fan/automation` returns the stored configuration, or the
defaults below while no row exists yet:

```json
{
  "enabled": false,
  "deltaOnK": 10,
  "deltaOffK": 2,
  "maxOutdoorHumidityPct": 80,
  "targetTempC": 12,
  "targetHysteresisK": 1,
  "minRunMinutes": 30,
  "minPauseMinutes": 30
}
```

`PUT /stocks/:stockId/fan/automation` takes the same shape and stores all
eight fields in one call — the form submits the switch and the parameters
together, so re-enabling after a self-disable is the same request as changing
a parameter. Bounds, a violation of any of which answers 400 with the usual
`VALIDATION_ERROR` envelope:

| Field | Bounds |
|-------|--------|
| `deltaOnK` | ≤ 20, and strictly greater than `deltaOffK` |
| `deltaOffK` | ≥ 2 |
| `maxOutdoorHumidityPct` | 40–100 |
| `targetTempC` | −10 to 30, or `null` to switch the target-temperature rule off |
| `targetHysteresisK` | 0–5 |
| `minRunMinutes` | 0–240, whole minutes |
| `minPauseMinutes` | 5–240, whole minutes |

`minPauseMinutes`'s lower bound of 5 rather than 0 is deliberate: below the
evaluation interval a pause cannot take effect at all, and it is the only thing
bounding the retry loop a broken monitor path produces — `watchdog_off`
deliberately does not disable automation (see `docs/BACKLOG.md`).

`PUT` writes an `automation_configured` event carrying the values before and
after, and — only when `enabled` goes from `false` to `true` — evaluates the
stock immediately rather than waiting for the next tick, so the stored state
the response carries, and any open fan page, answer "will it run" straight
away instead of for up to `FAN_AUTOMATION_INTERVAL_MS`.

Both endpoints answer 404 for one of two reasons, indistinguishable from the
outside: the stock has no fan control, or it has fan control but no grain
thermometers.

### New fan status fields

`GET /stocks/:stockId/fan`, the response of `POST …/fan/command` and every SSE
frame on `GET …/fan/stream` share one snapshot shape, `{status, events,
automation}`. Two additions to it:

- `status.contactorEngaged` (`boolean | null`) — whether the contactor's
  auxiliary contact is closed, i.e. whether the fan is actually running,
  **whoever switched it**. Fed from the Shelly's input on every monitor
  message; `null` until it has reported anything. This is deliberately not the
  relay output: the backend's own commanded state travels as `desiredOn`, and
  the two disagree exactly when the contactor was switched by hand rather than
  by the backend — a case the backend cannot end by itself (see
  `docs/BACKLOG.md`).
- `automation` — a slim object for the fan page's own card, distinct from the
  full configuration `GET …/fan/automation` returns:

  | Field | Meaning |
  |-------|---------|
  | `available` | The stock can be automated: fan control and grain thermometers |
  | `enabled` | The user has switched automation on for this stock |
  | `reason` | The last decision's reason (one of `no_data`, `condensation_risk`, `humidity_high`, `target_reached`, `delta_too_small`, `delta_ok`, `min_run_time`, `min_pause`, `hold`), or `null` before the first evaluation |
  | `evaluatedAt` | Timestamp of the last evaluation, or `null` before the first one |

  No parameters travel here — the automation panel fetches those separately
  from `GET …/fan/automation`.

`GET /stocks` gains the same two-field shape per stock, `automation:
{available, enabled}` — one additional query over the whole list rather than
one per stock, and no `reason` or `evaluatedAt`: the list has no SSE push to
keep them current.

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
