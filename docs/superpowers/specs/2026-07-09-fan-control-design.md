# Fan Control — Design Spec

**Date:** 2026-07-09
**Status:** Approved for planning

## 1. Overview

Add per-hall ("Halle") fan control to Grainwatch, operable from the web/PWA.
A fan is switched by a Shelly 1 (Gen 3) that drives a contactor. The Shelly is
reachable over MQTT. The backend gains an MQTT connection, holds the desired fan
state, re-asserts it periodically (the Shelly auto-switches off after one hour),
consumes the Shelly's monitoring messages, watches for failed switching, and logs
the full switching history per hall. The frontend shows the current fan state on
the hall screen and provides a dedicated sub-screen for switching, with clear
in-flight states.

Whether a hall has a fan is part of its configuration. Halle 8
(`grain-watch-1`) has one. Halle 7 does not.

## 2. Hardware & MQTT Contract

### Shelly setup
- Shelly 1 Gen 3 output `switch:0` drives a contactor that starts/stops the fan.
- Output configured with **Auto OFF after 1 hour** — the backend must re-confirm
  the state periodically to keep the fan running.
- Input is **detached**; the contactor's auxiliary contact is wired to it, so the
  Shelly can verify the contactor followed the switch command.
- Shelly MQTT settings enabled: **Enable**, **Enable 'MQTT Control'**,
  **Generic status update over MQTT**. Everything else off.

### MQTT prefix
Hall-specific. Halle 8: `/corn-watch/actors/corn-watch-1/fan-control`
(note the leading `/`).

### Topics

| Direction | Topic | Payload | Purpose |
|-----------|-------|---------|---------|
| PUBLISH | `{prefix}/command/switch:0` | `on` \| `off` | Switch the output (MQTT Control) |
| SUBSCRIBE | `{prefix}/monitor/#` | see below | Monitoring script messages |
| SUBSCRIBE | `{prefix}/status/switch:0` | Shelly status JSON | Authoritative output state (Generic status update); logged + reconciled |
| SUBSCRIBE | `{prefix}/online` | `true` \| `false` (retained LWT) | Shelly online/offline overlay |

### Monitoring script messages
Source: `switch-monitoring.mjs` (shelly-script-collection). Published QoS 0,
**retain=false** — messages are lost if the backend is down when they fire.

All monitoring payloads share the shape:
```json
{ "type": "...", "message": "...", "switchState": true, "inputState": true, "timestamp": 1234567890 }
```

| `type` | Topic | Meaning | Fires on |
|--------|-------|---------|----------|
| `success` | `{prefix}/monitor/status` | Contactor followed the command | both ON and OFF — distinguish via `switchState` |
| `warning` | `{prefix}/monitor/warning` | Input changed without a switch command (manual/foreign switching) | manual actuation |
| `alert` | `{prefix}/monitor/alert` | Input did not follow within grace period (3000 ms) | contactor failed to engage |
| `safety_shutoff` | `{prefix}/monitor/status` | After an alert with desired ON, the Shelly turned the output off itself | Shelly self-protection |

**Key consequence:** `success` and `safety_shutoff` share the `.../monitor/status`
topic. Dispatch on the payload `type` field, never on the topic name. Subscribe
with the wildcard `{prefix}/monitor/#`.

Because messages are QoS 0 / non-retained, the backend cannot rely on redelivery.
The watchdog and restart recovery below are therefore essential, not optional.

## 3. Backend

### 3.1 MQTT layer (`MqttService`)
- New dependency: `mqtt`.
- One shared broker connection for the whole backend. Config via env:
  `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TLS` (added to
  `backend/src/config/index.ts` and `.env.example`). Auto-reconnect enabled.
- On connect (and reconnect), subscribe to the monitor/status/online topics for
  every hall with `fanControlEnabled = true`.
- Provides `publishCommand(prefix, on)` and an event/callback interface that
  routes inbound messages (keyed by hall) to the `FanService`.
- Broker config is backend-wide; the topic prefix and switch id are per-hall
  config (§3.2).

### 3.2 Configuration (DB `stocks` table)
Extend the existing `stocks` table (Drizzle migration + updated seed):

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `fanControlEnabled` | boolean | `false` | Whether this hall has fan control |
| `fanTopicPrefix` | text | `null` | MQTT prefix incl. leading `/` |
| `fanSwitchId` | integer | `0` | Shelly switch channel id (topic uses `switch:{id}`) |

Seed: `grain-watch-1` (Halle 8) → `fanControlEnabled = true`,
`fanTopicPrefix = '/corn-watch/actors/corn-watch-1/fan-control'`, `fanSwitchId = 0`.

### 3.3 FanService — state machine
One logical fan state per hall, held in memory and mirrored to the DB for
recovery.

Canonical states:
```
OFF ──command on──▶ TURN_ON_PENDING ──success(switchState=true)──▶ ON
 ▲                        │                                         │
 │                        ├─ watchdog 10s timeout ─▶ FAULT          │
 │                        └─ alert / safety_shutoff ─▶ FAULT        │
 │                                                                  │
 └───────── OFF ◀──success(switchState=false)── TURN_OFF_PENDING ◀──┘ (command off)

FAULT ──command on/off (user retry)──▶ TURN_ON_PENDING / TURN_OFF_PENDING
```

Independent overlays (do not change the primary state):
`lastWarning`, `lastAlert`, `shellyOnline`.

Behaviour:
- **Desired state** persisted in `fan_state` (`desiredOn`, `since`,
  `lastCommandAt`). Single source of truth; backend serialises concurrent user
  commands (last write wins).
- **Keep-alive:** while `desiredOn = true`, a `setInterval` re-publishes
  `command/switch:0 = on` every **15 minutes** (well under the Shelly's 1 h Auto
  OFF). Each re-assert resets the Shelly Auto-OFF timer.
- **Watchdog:** after publishing `on`, expect a `success` with `switchState=true`
  within **10 s**. If absent → publish `off`, set state `FAULT`, log
  `watchdog_off`.
- **Alert / safety_shutoff:** set state `FAULT`, set `desiredOn = false`, **stop
  keep-alive** (do not keep re-asserting a failing contactor). Recorded to log.
- **Warning (manual switching):** log + surface as overlay only. No corrective
  action (warn-only).
- **Status / online messages:** logged; `online` updates the `shellyOnline`
  overlay; `status` reconciles the authoritative output state.
- **Startup recovery:** on boot, read `fan_state`. If `desiredOn = true`,
  resume the keep-alive loop and immediately re-assert; log `recovery`.
- **Shutdown:** do **not** switch the fan off on a clean shutdown. The Shelly
  Auto-OFF (1 h) is the safety net; recovery resumes control after restart.

### 3.4 DB tables (Drizzle migration)
- `fan_state`: `stockId` (PK, FK stocks), `desiredOn` (bool), `since` (ts),
  `lastCommandAt` (ts), `updatedAt` (ts).
- `fan_events`: `id` (PK), `stockId` (FK), `ts`, `kind`, `payload` (json),
  `source`. `kind ∈ command | success | safety_shutoff | warning | alert |
  status | online_change | watchdog_off | recovery`. `source ∈ user | shelly |
  backend`.
- **Retention:** 90 days for `fan_events`, enforced by a periodic cleanup
  (runs alongside the keep-alive scheduler).

### 3.5 REST + SSE endpoints
All under `authenticate` + `requireStockAccess`. If the hall's
`fanControlEnabled = false`, respond `404`.

| Method | Path | Body / Response |
|--------|------|-----------------|
| GET | `/api/v1/stocks/:stockId/fan` | current state + overlays + last 50 events (newest first) |
| POST | `/api/v1/stocks/:stockId/fan/command` | `{ "action": "on" \| "off" }` → sets desired, triggers publish |
| GET | `/api/v1/stocks/:stockId/fan/stream` | SSE — pushes state changes + new events |

### 3.6 Tests (Jest)
- FanService: all state transitions, watchdog timeout, keep-alive re-assert,
  alert/safety_shutoff → FAULT + stop, warn-only, startup recovery.
- MQTT message parsing/dispatch by `type` (with a mock MQTT client), including
  `success` vs `safety_shutoff` on the shared topic.
- Route auth + `fanControlEnabled=false` → 404.

## 4. Frontend

### 4.1 Hall screen (`StockDetailPage`)
- Add a compact `FanStatusCard` (only when the hall has fan control):
  current state, plus warning/error badge. Display only + link to the sub-screen.
  No switching controls here.

### 4.2 Fan sub-screen (new route `/stocks/:stockId/fan`)
- Large status display; On/Off buttons; warning/error display; switching history
  (last 50 events).
- Buttons reflect the state machine:
  - `OFF` → "Einschalten" enabled.
  - `TURN_ON_PENDING` / `TURN_OFF_PENDING` → button disabled + spinner
    ("wird quittiert…") — the in-flight state.
  - `ON` → "Ausschalten" enabled.
  - `FAULT` → error shown + retry.
- Live updates via `EventSource` on the SSE endpoint.

### 4.3 API + tests
- New `frontend/src/api/fan.ts`.
- Component tests: `FanStatusCard` and the sub-screen render correctly per state
  (OFF / PENDING / ON / FAULT, with warning/alert overlays, shelly offline).

## 5. Out of scope (YAGNI)
- Scheduling / automatic fan control based on temperature or humidity.
- Multiple fans per hall.
- Configuring fan settings through an admin UI (config via migration/seed for now).

## 6. Confirmed device behaviour
Verified on the physical device with the stated settings: the Shelly accepts
`on`/`off` on `{prefix}/command/switch:0`, publishes `{prefix}/status/switch:0`
on change, and publishes a retained `{prefix}/online` LWT. The topic contract in
§2 is authoritative — no further device confirmation needed.
