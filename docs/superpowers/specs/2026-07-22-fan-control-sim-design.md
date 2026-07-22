# Fan Control — Local Simulation Setup — Design Spec

**Date:** 2026-07-22
**Status:** Approved for planning

## 1. Overview

Provide a self-contained local environment to try out and simulate the
fan-control feature without any real hardware and without access to the
production InfluxDB. It emulates the Shelly 1 (Gen 3) + contactor over MQTT
(faithful to `switch-monitoring.mjs`), lets the user manually switch and inject
fault conditions from a web UI, seeds a local InfluxDB with fake sensor data so
the whole frontend is usable, and orchestrates everything with a single
`docker-compose.sim.yml`.

Everything new lives under `sim/` plus `docker-compose.sim.yml`. The backend and
frontend application code is **not** modified — only environment values differ.

## 2. Goals / Non-goals

**Goals**
- Run backend + frontend + MQTT broker + Shelly emulator + InfluxDB locally, one command.
- Emulator reproduces the Shelly monitoring behaviour: grace period, detached
  input, auto-off, and the success / warning / alert / safety_shutoff messages.
- Web UI to view the physical Shelly state and to drive it: manual switching,
  "contactor won't engage", "contactor switched manually", "Shelly offline".
- Fan state visualised twice: physically in the emulator UI, logically in the
  real frontend fan screens (via SSE).
- Fake InfluxDB data so the hall screen loads and the fan card + sub-screen are
  reachable through normal navigation.

**Non-goals**
- No production-code changes. No new npm workspace. Not for CI.
- Not a full Shelly RPC emulation — only the fan-control MQTT contract.

## 3. Directory layout (new, dev-only)

```
docker-compose.sim.yml
sim/
  README.md                       # how to run, what to click, troubleshooting
  shelly-emulator/
    package.json                  # standalone (not a workspace): aedes, ws, tsx, vitest
    Dockerfile
    src/broker.ts                 # aedes MQTT broker on :1883
    src/shelly.ts                 # Shelly + contactor state machine (pure, testable)
    src/server.ts                 # HTTP static UI + WebSocket (state push + control)
    src/index.ts                  # wires broker + shelly + server
    src/shelly.test.ts            # unit tests for the state machine
    public/index.html             # emulator web UI (vanilla HTML/CSS/JS)
  influx-seed/
    package.json                  # standalone: tsx
    Dockerfile
    seed.ts                       # writes line protocol + ensures DBRP mapping
```

## 4. Components

### 4.1 MQTT broker (embedded aedes)
Runs in-process inside the emulator container via `aedes`, listening on
`:1883`. No separate broker container. Backend connects with
`MQTT_URL=mqtt://shelly-emulator:1883`.

### 4.2 Shelly emulator (`sim/shelly-emulator`)
A faithful reproduction of the fan-control side of `switch-monitoring.mjs`.

**MQTT topics** (prefix from Halle 8 seed: `/corn-watch/actors/corn-watch-1/fan-control`):
- SUBSCRIBE `{prefix}/command/switch:0` — payload `on` | `off`.
- PUBLISH `{prefix}/status/switch:0` — JSON `{ "output": <bool> }` on every output change (generic status update).
- PUBLISH `{prefix}/online` — retained `true` on start, `false` when the UI toggles offline (LWT-style).
- PUBLISH monitor messages (payload `{ type, message, switchState, inputState, timestamp }`):
  - `{prefix}/monitor/status` → `type: "success"` and `type: "safety_shutoff"`.
  - `{prefix}/monitor/warning` → `type: "warning"`.
  - `{prefix}/monitor/alert` → `type: "alert"`.

**State (`src/shelly.ts`, pure state machine):**
- `switchOutput: boolean` — the Shelly output (= the current switch status).
- `inputState: boolean` — contactor auxiliary contact (detached input; = the
  contactor/fan actually engaged).
- `desiredInputState: boolean` — expected input after a switch command.
- `online: boolean`.
- `contactorBehaviour: 'follow' | 'wontEngage'` — how the contactor reacts on
  the **next** switch command. **Default `'follow'`** (everything works, no
  fault). Set to `'wontEngage'` beforehand to arm the failure case. Stays set
  until the user changes it back.
- Config: `gracePeriodMs` (default 3000), `contactorDelayMs` (internal, default
  500 — well within grace so the normal case yields `success`), `autoOffMs`
  (default 3600000, env-configurable for faster observation).

Rationale for the pre-armed fault: the 3 s grace window is too short to react in
the UI, so faults are **not** produced by racing the timer. Instead the default
is a correctly-following contactor (→ `success`), and the failure mode is
selected in advance and takes effect on the next switch.

**Behaviour:**
- On `command on|off` (from MQTT) or a manual output switch (from the UI): set
  `switchOutput`, publish `status/switch:0`, set `desiredInputState =
  switchOutput`, start the grace timer; when turning ON, (re)arm the auto-off
  timer (a repeated ON — the backend keep-alive — resets it).
- Contactor follow: with `contactorBehaviour === 'follow'`, `inputState` follows
  `switchOutput` after `contactorDelayMs`. With `'wontEngage'`, `inputState`
  stays `false` on an ON command.
- Grace timer expiry: if `inputState === desiredInputState` → publish `success`.
  Else → publish `alert`; and if `desiredInputState` was ON (input failed to
  engage) → set output OFF, publish `status/switch:0`, publish `safety_shutoff`.
- Manual contactor switch from the UI (input toggled with no matching command)
  → publish `warning` ("Input changed without switch command").
- Auto-off expiry: set output OFF, publish `status/switch:0` (models the Shelly
  1 h Auto OFF).
- Every published/received MQTT message and every state change is pushed to the
  web UI over WebSocket.

**`src/server.ts`:** serves `public/index.html`; a WebSocket pushes the current
emulator state and receives control commands (manual switch, toggle
fault-mode, manual contactor toggle, toggle online, set delays).

### 4.3 Web UI (`public/index.html`, served on `:8080`)
Vanilla HTML/CSS/JS, one WebSocket to the emulator. No build step.

**Display:**
- **Schalt-Status (Shelly output):** current output ON/OFF, prominent, with an
  animated "fan running" indicator when ON.
- **Schütz / Lüfter (input):** whether the contactor is engaged.
- **Armed contactor behaviour** for the next switch (`follow` / `wontEngage`)
  and `online` status.
- **Last monitor message:** type + text + timestamp.
- **MQTT message log:** live, scrolling list of MQTT traffic — both received
  commands and published messages — each with direction, topic, payload and
  time.

**Controls:**
- **Shelly manuell schalten** — output ON / OFF directly (as if switched at the
  device); goes through the same path as an MQTT command.
- **Lüfter/Schütz manuell schalten** — toggles `inputState` without a matching
  command → `warning`.
- **Schütz-Verhalten beim nächsten Schalten** — selector Normal (`follow`,
  default) / "Zieht nicht an" (`wontEngage`); armed in advance so the next ON
  yields `alert` + `safety_shutoff`.
- **Shelly offline** — toggles `online` (publishes `online=false`).
- Optional numeric input for `autoOffMs` (to observe auto-off quickly).

### 4.4 InfluxDB + seeder (`sim/influx-seed`)
- **influxdb** container (`influxdb:2.7-alpine`) initialised in setup mode:
  org `grainwatch`, bucket `grainwatch`, a fixed dev admin token.
- **DBRP mapping:** the backend queries via the v1 compat API
  (`GET /query?db=grainwatch`). The seeder ensures a v1 DBRP mapping
  `db=grainwatch` → bucket `grainwatch` (default) exists (via the influx v1 API
  / CLI) so those queries resolve.
- **Seed data** (line protocol, matching `InfluxDBService` queries):
  - Measurement `Temp`, tags `device-group=corn-watch-1`, `device=1.1..1.5`;
    fields `temp-top`, `temp-mid`, `temp-bottom`, `humidity`, `batteryMV`,
    `measurementTimeS` (unix seconds). Write a recent series (e.g. every 15 min
    over the last ~24 h) so both latest readings and history render.
  - `outdoor-temperature` (field `temp`) and `outdoor-humidity` (field
    `humidity`), tag `device=corn-watch-1`, recent points.
- Runs as a one-shot container after influxdb is healthy.

### 4.5 Backend + frontend containers
- **backend:** existing image/build; env: `MQTT_URL=mqtt://shelly-emulator:1883`,
  `INFLUXDB_URL=http://influxdb:8086`, token/org/bucket matching the influx
  init, `NODE_ENV=development`, and a lowered `FAN_KEEPALIVE_INTERVAL_MS`
  (e.g. `30000`) so keep-alive re-asserts are observable within minutes. Port
  `3000` published.
- **frontend:** Vite dev server, port `5173` published,
  `VITE_API_BASE_URL=http://localhost:3000/api/v1` (browser-side URL).
- Login uses the seeded default admin `admin` / `changeme123`.

## 5. Data flow

```
Emulator UI ⇄ WS ⇄ Shelly emulator ⇄ aedes MQTT ⇄ Backend FanControlManager
                                                        │
Frontend fan screen ⇄ SSE ⇄ Backend  ← command/status ─┘
Frontend hall/history ⇄ REST ⇄ Backend ⇄ InfluxDB (seeded)
```

- User clicks "Einschalten" in the frontend → backend publishes `command … on`
  → emulator engages contactor after the delay → publishes `success` → backend
  → SSE → frontend shows ON; emulator UI shows output+contactor on.
- User enables "Schütz zieht nicht an" then switches on → no follow → emulator
  publishes `alert` + `safety_shutoff` → backend FAULT → frontend shows fault;
  and the backend watchdog is a second safety net.

## 6. Error handling
- Emulator: malformed command payloads ignored (only `on`/`off`); WS
  disconnects tolerated (UI reconnects). Broker bind failure fails fast with a
  clear log.
- Seeder: retries until influxdb healthy; exits non-zero on write failure so the
  compose run surfaces the problem.
- Backend already tolerates an unreachable InfluxDB at boot; with the seeded
  instance the data endpoints work.

## 7. Testing
- `sim/shelly-emulator/src/shelly.test.ts` (Vitest): the pure state machine —
  success on follow, alert + safety_shutoff when the contactor won't engage,
  warning on manual contactor change, auto-off expiry, keep-alive resets auto-off.
- Broker/server/seeder verified manually per the `sim/README.md` runbook
  (documented steps + expected UI/frontend outcomes).

## 8. Out of scope (YAGNI)
- Multiple emulated stocks/fans (only Halle 8 / `corn-watch-1`).
- Emulating non-fan Shelly RPC, persistence across restarts, TLS/auth on the
  local broker.
- CI integration.

## 9. Confirmed decisions
Embedded aedes broker; standalone web UI; real dockerised InfluxDB + seeder;
`docker-compose.sim.yml` orchestration; emulator is a standalone package (not an
npm workspace, own deps); frontend runs as Vite dev in the sim.
