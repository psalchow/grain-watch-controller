# Automation Core v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stock's fan switches itself on and off from measured conditions, on a timer, with the decision visible in the app and recorded in the event log.

**Architecture:** A pure `evaluate` function decides; a timer service reads the same InfluxDB sources as `GET /latest`, calls it, and drives the existing `FanController` when the decision changes. Parameters live in a new `stock_automation` table, editable through one endpoint and a panel on the fan page. Manual switching, local switching at the contactor, a device fault and the withdrawal of fan control each switch automation off until the user switches it back on.

**Tech Stack:** TypeScript, Express 4, Drizzle ORM on SQLite, InfluxQL, Jest (backend), React 19 + Vitest (frontend), Vitest (simulator).

**Spec:** `docs/superpowers/specs/2026-09-29-fan-automation-core-design.md` — read it before Task 1 and keep it open; this plan gives the route, the spec gives the decisions and their reasons.

## Global Constraints

- All code, comments, commit messages and documentation in **English (UK)**; user-facing strings in the PWA in **German**.
- `DEWPOINT_MARGIN_K = 2` is a constant, not a parameter.
- Parameter bounds, exactly: `delta_on_k` > `delta_off_k` and ≤ 20; `delta_off_k` ≥ 2 and < `delta_on_k`; `max_outdoor_humidity_pct` 40–100; `target_temp_c` −10 to 30, nullable; `target_hysteresis_k` 0–5; `min_run_minutes` 0–240; `min_pause_minutes` 5–240.
- Defaults, exactly: `enabled` false, `delta_on_k` 10, `delta_off_k` 2, `max_outdoor_humidity_pct` 80, `target_temp_c` 12, `target_hysteresis_k` 1, `min_run_minutes` 30, `min_pause_minutes` 30.
- `FAN_AUTOMATION_INTERVAL_MS` default `300000`.
- The nine reasons, exactly: `no_data`, `condensation_risk`, `humidity_high`, `target_reached`, `delta_too_small`, `delta_ok`, `min_run_time`, `min_pause`, `hold`.
- The four self-disable causes, exactly: `manual_command`, `local_switch`, `fault`, `fan_control_withdrawn`.
- The four new event kinds, exactly: `auto_on`, `auto_off`, `automation_disabled`, `automation_configured`.
- Scope discipline per the root `CLAUDE.md`: findings about code this plan does not touch go to `docs/BACKLOG.md`, not into the task.

## Traps

Things that cost an hour to rediscover. Read this list before starting; each entry names the task it bites in.

1. **Migrations are generated, never hand-written** (Task 1). `npm run db:generate -w backend` produces `backend/drizzle/000N_*.sql`, a snapshot under `drizzle/meta/` and an entry in `drizzle/meta/_journal.json`. A hand-written `.sql` without the journal entry is silently skipped by `runMigrations`, and the table simply never appears.
2. **`isOffline(null)` returns `false`** (Tasks 2, 3). `backend/src/controllers/stocks.controller.ts` guards with `timestamp !== null && …`, so a device that never reported reads as *not* offline. Never reuse `isOffline` as the automation's validity predicate — build the predicate the spec §4.1 describes.
3. **`buildOutdoorConditions` returns `dewPoint: null` for two different reasons** (Tasks 2, 3): a missing input, and two fresh readings more than `INFLUXDB_OUTDOOR_MAX_SKEW` apart (`derivedUnavailableReason: 'skew'`). The second case leaves `offline: false`, so testing the inputs is not enough — rule 1 tests the dew point itself.
4. **`null` coerces to `0` in a JavaScript relational comparison** (Task 3). An unguarded `dewPoint >= grainMin - 2` with a null dew point silently becomes "is the coldest grain reading below 2 °C". Type the field `number | null` and branch on it before any comparison.
5. **The keep-alive deliberately does not persist** (Task 6). `ensureKeepAlive` publishes and logs but never calls `persistState`, and `recover()` calls `beginTurnOn(..., persist=false)`. Spec §3.3 depends on that: `fan_state.since` and `last_command_at` are the real switching times. Do not "tidy" either path.
6. **`beginTurnOff` enters `TURN_OFF_PENDING` and arms no timer** (Task 4). The only exit is a `success` message. Never route a switch-off through it that cannot be acknowledged — that is the whole point of the new no-pending rule.
7. **A `success` clears `lastWarning` and `lastAlert`** (Task 4). Overlays are not a place to keep anything that must survive.
8. **The emulator's `setSwitch` arms the follow timer unconditionally, and that is load-bearing** (Task 5). It is how the emulator models the contactor following *any* command. Removing the re-arm leaves `inputState` stuck at `true` on every ordinary switch-off and publishes a spurious `alert`. Add a "locally held" flag instead.
9. **Read `inputState`, never `switchState`** (Tasks 4, 5). In a `warning` and an `alert` the device puts `desiredInputState` — the last commanded output — into `switchState`.
10. **`sim/` is not an npm workspace** (Task 5). The root `npm run test` does not run the emulator's tests. Use `npm test --prefix sim/shelly-emulator`.
11. **`config` validates at module load, except under `NODE_ENV=test`** (Task 6). New bounds are exercised by calling `validateConfig` directly, as `backend/tests/unit/config.test.ts` does.
12. **`fanControlAvailable` is module-private in `stocks.controller.ts`** (Tasks 2, 8). Export it from the new conditions module rather than writing the predicate a second time; a second copy is how the two halves drift apart.
13. **Express handlers share the event loop with the timer** (Task 6). Two awaited InfluxDB queries sit between selecting a stock and switching it, so `enabled` must be re-read from the repository immediately before acting.
14. **`FanStatus` exists twice** (Tasks 4, 9). `backend/src/services/fan/types.ts` and `frontend/src/types/fan.ts` are separate declarations of the same wire shape. A field added to one and not the other type-checks on both sides and fails at runtime.
15. **Never index a `Record` with an unvalidated wire value** (Task 10). `frontend/src/components/FanStatusCard.tsx` carries the reasoning: a key such as `constructor` resolves through `Object.prototype`, passes a nullish guard and blanks the page. The nine reasons arrive from the wire — select by explicit comparison or keep the `?? fallback` shape `EVENT_LABEL` uses.
16. **The backend integration suite is flaky under the full parallel run** (Tasks 8, 12) — a known backlog entry, roughly one run in eight, with `Parse Error: Expected HTTP/, RTSP/ or ICE/`. Re-run the single file before believing a red result.

## File Structure

**Backend — new**

| File | Responsibility |
|---|---|
| `backend/drizzle/0006_stock_automation.sql` (+ meta) | Generated migration creating `stock_automation` |
| `backend/src/db/repositories/automation.repository.ts` | Read with defaults, upsert, list for the stock list |
| `backend/src/services/conditions/conditions.ts` | Reading preparation moved out of `stocks.controller.ts`, plus the grain summary |
| `backend/src/services/conditions/index.ts` | Re-export |
| `backend/src/services/automation/types.ts` | Parameters, readings, decision, reason, cause |
| `backend/src/services/automation/evaluate.ts` | The pure rule set |
| `backend/src/services/automation/automation.service.ts` | Timer, read-failure counting, acting, self-disable, change notification |
| `backend/src/services/automation/index.ts` | Re-export plus the module-level accessor pair |

**Backend — modified**

| File | Change |
|---|---|
| `backend/src/db/schema.ts` | `stockAutomation` table |
| `backend/src/db/repositories/index.ts` | Export the repository |
| `backend/src/config/index.ts` | `fan.automationIntervalMs` + bound |
| `backend/src/services/fan/types.ts` | `contactorEngaged`, `auto` source, new event kinds |
| `backend/src/services/fan/fan.controller.ts` | Overlay, warning path, no-pending off, interference callback |
| `backend/src/services/fan/fan.manager.ts` | Pass the callback through, disable on retirement |
| `backend/src/controllers/stocks.controller.ts` | Import from the conditions module; `automation` in the list payload |
| `backend/src/controllers/fan.controller.ts` | Disable on a manual command; automation in the snapshot; the two new handlers |
| `backend/src/routes/fan.routes.ts` | `GET`/`PUT` `…/fan/automation` |
| `backend/src/middleware/validation.middleware.ts` | Zod schema for the body |
| `backend/src/bootstrap.ts` | Build, wire and start the service; stop it on shutdown |

**Simulator — modified:** `sim/shelly-emulator/src/shelly.ts`.

**Frontend — modified:** `src/types/fan.ts`, `src/api/fan.ts`, `src/components/FanStatusCard.tsx`, `src/components/StockCard.tsx`, `src/pages/FanControlPage.tsx`, `src/api/stocks.ts`.
**Frontend — new:** `src/components/FanAutomationPanel.tsx`.

**Docs — modified:** `docs/specs/API.md`, `docs/BACKLOG.md`, `backend/.env.example`.

---

### Task 1: `stock_automation` table and repository

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/0006_stock_automation.sql` and its `meta/` companions (generated)
- Create: `backend/src/db/repositories/automation.repository.ts`
- Modify: `backend/src/db/repositories/index.ts`
- Test: `backend/tests/db/repositories/automation.repository.test.ts`

**Interfaces:**
- Consumes: `Db` from `backend/src/db/types`, the existing repository style (synchronous, `better-sqlite3`).
- Produces:
  - `AUTOMATION_DEFAULTS: AutomationConfig` — the single source for both the DDL defaults and the read fallback. It is declared in **`schema.ts`**, beside the table, the way `DEFAULT_TENANT_ID` already is, and the repository imports it. Not the other way round: repositories import the schema and never the reverse, and `drizzle.config.ts` loads `schema.ts` directly to generate the migration, so a schema importing a repository would drag the repository layer into the generator.
  - `interface AutomationConfig { enabled: boolean; deltaOnK: number; deltaOffK: number; maxOutdoorHumidityPct: number; targetTempC: number | null; targetHysteresisK: number; minRunMinutes: number; minPauseMinutes: number }`
  - `class AutomationRepository { get(stockId: string): AutomationConfig; upsert(stockId: string, config: AutomationConfig): void; getMany(stockIds: string[]): Map<string, AutomationConfig> }`

- [ ] **Step 1: Write the failing tests.** In the repository test, against an in-memory database built the way the other repository tests build theirs: `get` on an unknown stock returns `AUTOMATION_DEFAULTS` without writing a row; `upsert` then `get` round-trips every field including a null `targetTempC`; a second `upsert` overwrites rather than duplicating; `getMany` returns defaults for stocks with no row and stored values for the rest; deleting the stock removes the row (cascade).
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/db/repositories/automation.repository.test.ts` — expect a module-not-found error.
- [ ] **Step 3: Declare the table** in `schema.ts` with the columns, types, defaults and the `ON DELETE CASCADE` reference from the spec §3.1. Export `DbStockAutomation`.
- [ ] **Step 4: Generate the migration.** `npm run db:generate -w backend -- --name=stock_automation`, then read the generated SQL and confirm it creates the table with the defaults and the foreign key. Without `--name` drizzle-kit invents a random two-word name; every existing migration carries a deliberate one, and the name lands in `_journal.json` where changing it afterwards is not free. Trap 1 applies: the journal entry and the snapshot are part of the change.
- [ ] **Step 5: Write the repository.** `get` reads one row and falls back to `AUTOMATION_DEFAULTS`; `upsert` uses `onConflictDoUpdate` on `stock_id` as `FanStateRepository.upsert` does; `getMany` reads with an `inArray` filter and fills the gaps with defaults.
- [ ] **Step 6: Run the tests and the type check.** `npm test -w backend -- tests/db/repositories/automation.repository.test.ts` and `npm run typecheck -w backend` — both pass.
- [ ] **Step 7: Commit.** `feat(backend): add the stock_automation table and its repository`

---

### Task 2: Extract the reading preparation, add the grain summary

**Files:**
- Create: `backend/src/services/conditions/conditions.ts`, `backend/src/services/conditions/index.ts`
- Modify: `backend/src/controllers/stocks.controller.ts`
- Test: `backend/tests/unit/services/conditions.test.ts`

**Interfaces:**
- Consumes: `DeviceReading`, `OutdoorReading` from `backend/src/services/influx`; `config.influxdb`.
- Produces:
  - `offlineAfterMs(): number`, `isOffline(timestamp: string | null, threshold: number): boolean`, `buildOutdoorConditions(reading: OutdoorReading, offlineThreshold: number): OutdoorConditions` — moved unchanged.
  - `fanControlAvailable(stock: { id: string; fanControlEnabled: boolean }): boolean` — moved unchanged (Trap 12).
  - `summariseGrain(readings: DeviceReading[], offlineThreshold: number): { meanC: number | null; minC: number | null; validValues: number }`.

- [ ] **Step 1: Write the failing tests for `summariseGrain`.** The cases that matter: three layers of one fresh device average correctly and report `validValues: 3`; a null layer value is excluded from both figures and from the count; a device whose `measurementTime` is older than the threshold contributes nothing; **a device whose `measurementTime` is null contributes nothing** (Trap 2 — this is the case a naive `!isOffline(...)` gets backwards); an empty list and an all-invalid list both yield `{ meanC: null, minC: null, validValues: 0 }`; the minimum comes from the coldest single layer, not from the coldest device average.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/unit/services/conditions.test.ts`.
- [ ] **Step 3: Move the four existing functions** out of `stocks.controller.ts` into `conditions.ts` with their doc comments intact, and re-import them in the controller. Change nothing about them — a behaviour change here would show up as a failing integration test, not as a new feature.
- [ ] **Step 4: Write `summariseGrain`** over `(device, layer)` values per spec §4.1.
- [ ] **Step 5: Run the new tests, then the whole backend suite.** `npm test -w backend` — the existing `tests/integration/stocks.test.ts` is what proves the move was behaviour-neutral. Trap 16 applies to a red integration run.
- [ ] **Step 6: Commit.** `refactor(backend): move the reading preparation into a service, add the grain summary`

---

### Task 3: The pure rule set

**Files:**
- Create: `backend/src/services/automation/types.ts`, `backend/src/services/automation/evaluate.ts`
- Test: `backend/tests/unit/services/automation/evaluate.test.ts`

**Interfaces:**
- Consumes: `AutomationConfig` (Task 1).
- Produces:
  - `type AutomationReason = 'no_data' | 'condensation_risk' | 'humidity_high' | 'target_reached' | 'delta_too_small' | 'delta_ok' | 'min_run_time' | 'min_pause' | 'hold'`
  - `interface AutomationReadings { outdoorTempC: number | null; outdoorHumidityPct: number | null; dewPointC: number | null; outdoorOffline: boolean; grainMeanC: number | null; grainMinC: number | null }`
  - `interface FanTimingState { desiredOn: boolean; since: string | null; lastCommandAt: string | null }`
  - `interface Decision { desiredOn: boolean | null; reason: AutomationReason }` — `null` means hold.
  - `const DEWPOINT_MARGIN_K = 2`
  - `function evaluate(readings: AutomationReadings, parameters: AutomationConfig, state: FanTimingState, now: Date): Decision`

- [ ] **Step 1: Write the failing tests, one group per rule.** Rule 1: a null outdoor temperature, a null humidity, `outdoorOffline`, a null grain mean, and — separately named, because it is the case the rule table used to miss — **a null dew point with a fresh temperature and humidity** each yield `{ desiredOn: false, reason: 'no_data' }` (Traps 3 and 4). Rule 2: dew point exactly at `grainMinC - 2` switches off, one tenth below it does not. Rule 3: humidity one above the limit switches off, exactly at the limit does not. Rule 4: with the fan on and the mean at the target, off with `target_reached`; with the fan off and the mean below `target + hysteresis`, hold with `target_reached`; with the mean above it, the delta rules decide; with `targetTempC` null, rule 4 is skipped entirely. Rule 5: ΔT one below `delta_off_k` switches off. Rule 6: ΔT exactly at `delta_on_k` switches on, one tenth below holds. Rule 7: ΔT between the two bounds holds with `hold`. Precedence: a condensation risk wins over a satisfied rule 6. Minimum times: a fan running for less than `min_run_minutes` turns rule 4a and rule 5 into a hold with `min_run_time`, while rules 1–3 still switch off; a pause shorter than `min_pause_minutes` turns rule 6 into a hold with `min_pause`; a null `since` or `lastCommandAt` counts as elapsed.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/unit/services/automation/evaluate.test.ts`.
- [ ] **Step 3: Write the types**, then `evaluate` as the rule table of spec §4 with the minimum-time filter of §4.2 applied to the result.
- [ ] **Step 4: Run the tests.** All pass. If any rule needed a second look at the spec, note it — the spec is the normative text, not this plan.
- [ ] **Step 5: Commit.** `feat(backend): add the automation rule set`

---

### Task 4: `FanController` — contactor overlay, local switching, no unreachable pending state

**Files:**
- Modify: `backend/src/services/fan/types.ts`, `backend/src/services/fan/fan.controller.ts`
- Test: `backend/tests/unit/services/fan.controller.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `FanStatus.contactorEngaged: boolean | null`
  - `type InterferenceCause = 'local_switch' | 'fault'`
  - `FanControllerDeps.onInterference?: (cause: InterferenceCause) => void`
  - `FanEventKind` gains `auto_on`, `auto_off`, `automation_disabled`, `automation_configured`; the `source` unions gain `auto`, and the switch-off path additionally accepts `shelly`.

- [ ] **Step 1: Write the failing tests.** `contactorEngaged` starts null and follows `inputState` through a `success`, a `warning` and an `alert` (Trap 9: assert it does not follow `switchState`). A `warning` while the desired state is false publishes exactly one `off`, leaves `desiredOn` false, writes a `command` row with source `shelly`, calls `onInterference('local_switch')`, notifies the status listeners, and reports state `ON` when the warning carried `inputState: true` — **never `TURN_OFF_PENDING`** (Trap 6). The same with `inputState: false` reports `OFF`. A `warning` while the fan was on clears the keep-alive, so no further `on` is published after the keep-alive interval. An `alert` and a `safety_shutoff` each call `onInterference('fault')`. A `watchdog_off` does **not** call it. A user `off` while the desired state is already false publishes, persists and logs but leaves the reported state unchanged. Ordinary switching is untouched: the existing tests must all still pass.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/unit/services/fan.controller.test.ts`.
- [ ] **Step 3: Add the overlay** and feed it from `handleShellyMessage` for all four message types before the existing per-type handling.
- [ ] **Step 4: Add the switch-off path that does not enter a pending state**, and route both the `warning` case and an `off` with `desiredOn` already false through it. Spec §5.6 governs what is reported instead: unchanged in general, `inputState` on the warning path.
- [ ] **Step 5: Add the callback** and call it from the `warning`, `alert` and `safety_shutoff` branches. Not from `armWatchdog` — spec §5.5 explains why, and a test asserts it.
- [ ] **Step 6: Widen the unions** in `types.ts` and the two `source` parameters.
- [ ] **Step 7: Run the fan tests, then the whole backend suite.** `npm test -w backend`.
- [ ] **Step 8: Commit.** `feat(backend): report the contactor state and stand down on local switching`

---

### Task 5: Make the emulator behave like the device script

**Files:**
- Modify: `sim/shelly-emulator/src/shelly.ts`
- Test: the emulator's existing test file alongside it

**Interfaces:**
- Consumes: nothing.
- Produces: no exported change; `ShellySnapshot` may gain the flag if that is the natural place for it.

- [ ] **Step 1: Write the failing tests.** Engaging the contactor by hand while the output is off publishes a `warning`; a subsequent `setSwitch(false)` publishes **no** `alert` and leaves `inputState` true (Trap 8). Releasing it by hand afterwards publishes a `success` with `inputState: false`, not a `warning`. Opening the contactor by hand while the output is on publishes a `warning`, and the following `setSwitch(false)` resolves to a `success`. The ordinary paths are unchanged: `setSwitch(true)` → contactor follows → `success`; `setSwitch(false)` → `success`; `wontEngage` → `alert` then `safety_shutoff`.
- [ ] **Step 2: Run them and watch them fail.** `npm test --prefix sim/shelly-emulator` (Trap 10 — the root test script does not reach this package).
- [ ] **Step 3: Add the "locally held" flag**, set and cleared in `manualContactorToggle`, and consult it in `setSwitch` before arming the follow timer. Do not remove the re-arm.
- [ ] **Step 4: Only arm the grace timer when the output actually changes**, as the device script's status handler does.
- [ ] **Step 5: Publish `success` rather than `warning`** when a manual toggle brings the input to the state that was last commanded.
- [ ] **Step 6: Run the emulator tests and its type check.** `npm test --prefix sim/shelly-emulator` and `npm run typecheck --prefix sim/shelly-emulator`.
- [ ] **Step 7: Commit.** `fix(sim): follow the device script for local contactor switching`

---

### Task 6: The automation service

**Files:**
- Create: `backend/src/services/automation/automation.service.ts`, `backend/src/services/automation/index.ts`
- Modify: `backend/src/config/index.ts`, `backend/.env.example`
- Test: `backend/tests/unit/services/automation/automation.service.test.ts`, `backend/tests/unit/config.test.ts` (extend)

**Interfaces:**
- Consumes: `evaluate`, `AutomationRepository`, `FanStateRepository` (the `FanTimingState` comes from `fan_state`: `desiredOn`, `since`, `lastCommandAt` — spec §3.3, Trap 5), `FanEventsRepository`, `summariseGrain`, `buildOutdoorConditions`, `offlineAfterMs`, `fanControlAvailable`, `InfluxDBService`, a `getController(stockId): FanController | null` function, and a `listStocks(): Promise<Stock[]>` function.
- Produces:
  - `interface AutomationState { enabled: boolean; reason: AutomationReason | null; evaluatedAt: string | null }`
  - `type DisableCause = 'manual_command' | 'local_switch' | 'fault' | 'fan_control_withdrawn'`
  - `class AutomationService` with `start(): void`, `stop(): void`, `evaluateStock(stockId: string): Promise<void>`, `disable(stockId: string, cause: DisableCause): void`, `notifyChanged(stockId: string): void`, `getState(stockId: string): AutomationState`, `onChange(stockId: string, listener: (s: AutomationState) => void): () => void`
  - `disable` is for the four self-disable causes and writes `automation_disabled`. `notifyChanged` is what the `PUT` calls when the user switched automation off: no event of its own — the handler writes `automation_configured` — just the push to open streams (spec §7.1).

**Two decisions this task must not leave open.**

*Where the stock rows come from.* The two InfluxDB reads are keyed on the
**device group**, not the stock id, and both the tick's selection and `available`
need `fanControlEnabled` and `hasGrainSensors` from the row. The service takes a
`listStocks()` closure over `StockRepository` — the shape `bootstrap.ts` already
uses for the manager's `fanEnabledStockIds` — and **re-reads it every tick**, so
a row edited underneath the process takes effect without a restart, as
`FanControlManager.reconcile` does. Reading it once at construction would make
the service stale in exactly the way spec §3.2 warns about.

*Why the snapshot the API sends is not what the service returns.* `available`
needs a stock row, and every route to one at this layer is asynchronous, while
the push path has to be synchronous — a listener firing inside an evaluation
cannot await. So the service answers only what it holds itself (`enabled` from
the repository, which is synchronous, plus the reason and the timestamp of its
last evaluation), and the HTTP layer composes `AutomationSnapshot = { available,
...state }` from the row it has fetched anyway. A cache would not do: a stock
with automation disabled is never evaluated, and `available: false` is precisely
the case the panel needs answered.
  - `setAutomationService(s: AutomationService | null): void`, `getAutomationService(): AutomationService | null` — the accessor pair `services/fan/index.ts` already models.
  - `config.fan.automationIntervalMs: number`

- [ ] **Step 1: Write the failing config test.** `validateConfig` rejects an interval below the lower bound with a named message, and accepts the default. Trap 11: call `validateConfig` directly.
- [ ] **Step 2: Write the failing service tests.** With a fake controller, a fake reading source, a fake repository and an injected clock: a decision differing from `controller.getStatus().desiredOn` issues `command(action, 'auto')` and writes `auto_on` / `auto_off` with the payload of spec §3.4; an agreeing decision and a hold issue nothing; three consecutive read failures switch off with `no_data` while the first two do not, and a success in between resets the counter; a stock whose `getController` returns `null` is skipped without a read; **automation disabled between the read and the action performs no command** (Trap 13); `disable` flips the flag, writes `automation_disabled` with the cause, and is a no-op the second time; `start` evaluates once immediately; enabling a stock through `evaluateStock` evaluates it without waiting for the interval; `onChange` fires after every evaluation, not only on a changed reason; a stock without fan control and one without grain thermometers are both left out of the tick entirely; a `listStocks` that returns a row edited since the last tick is honoured on the next one.
- [ ] **Step 3: Run both and watch them fail.** `npm test -w backend -- tests/unit/services/automation tests/unit/config.test.ts`.
- [ ] **Step 4: Add the configuration** value, its bound in `validateConfig` and the line in `.env.example`.
- [ ] **Step 5: Write the service** to spec §5.2 to §5.5: timer plus immediate first run, per-stock sequential processing with per-stock error containment, the failure counter, the re-read of `enabled` before acting, the decision comparison against the controller, the event writing, the listener registry.
- [ ] **Step 6: Run the tests.** All pass.
- [ ] **Step 7: Commit.** `feat(backend): add the automation service`

---

### Task 7: Wiring

**Files:**
- Modify: `backend/src/services/fan/fan.manager.ts`, `backend/src/bootstrap.ts`, `backend/src/controllers/fan.controller.ts`
- Test: `backend/tests/unit/services/fan.manager.test.ts` (extend), `backend/tests/unit/bootstrap.test.ts` (extend)

**Interfaces:**
- Consumes: `AutomationService`, `FanControllerDeps.onInterference`.
- Produces: `FanManagerDeps.onInterference?: (stockId: string, cause: InterferenceCause) => void` — the manager forwards its controllers' callbacks with the stock id attached, so it never learns the automation service's type.

- [ ] **Step 1: Write the failing tests.** The manager passes a callback into every controller it builds, and an interference reported by one controller reaches the manager's dependency with that controller's stock id. `retireController` calls the disable dependency with `fan_control_withdrawn` before it switches off. A manual command through `FanHttpController.sendCommand` disables automation with `manual_command` — and does so for a stock whose automation is already disabled without writing a second event (that assertion belongs to the service, but the controller must still call it unconditionally rather than reading the flag itself).
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/unit/services/fan.manager.test.ts tests/unit/bootstrap.test.ts`.
- [ ] **Step 3: Thread the callback** through `FanManagerDeps` into each `FanController`.
- [ ] **Step 4: Call the disable dependency** from `retireController`.
- [ ] **Step 5: Wire it in `bootstrap.ts`, in this order** — the order is load-bearing:
  1. construct the `AutomationService`, its `getController` reading through `getFanManager()` and its `listStocks` over a fresh `StockRepository`, both as closures;
  2. construct the `FanControlManager` with the interference callback, which calls `automation.disable(stockId, cause)`;
  3. `manager.init()`;
  4. `setFanManager(manager)`;
  5. `setAutomationService(service)`;
  6. `service.start()`.

  Starting before step 4 makes the immediate first evaluation resolve every `getController` to `null`, so §5.2 skips every stock without an event and the first real decision is `FAN_AUTOMATION_INTERVAL_MS` away — losing exactly what that evaluation was added for. Starting before step 3 computes decisions against desired states `recover()` has not resumed yet, so a fan that was running before the restart reads as off.

  Both closures are evaluated at call time, which is what lets the two objects reference each other at all: building either dependency eagerly hands the other a null.

  `initFanControl` returns early three times — no fan-enabled stocks, and a missing MQTT or fan configuration. On those paths the service is neither constructed nor started, and `getAutomationService()` stays null; every caller already has to handle that.

  Stop the service in `shutdownFanControl`. Both directions stay anonymous per spec §5.5 — neither class imports the other's type.
- [ ] **Step 6: Call `disable(stockId, 'manual_command')`** from `sendCommand`, before the command.
- [ ] **Step 7: Run the whole backend suite.** `npm test -w backend`.
- [ ] **Step 8: Commit.** `feat(backend): wire automation into the fan control lifecycle`

---

### Task 8: API

**Files:**
- Modify: `backend/src/middleware/validation.middleware.ts`, `backend/src/middleware/index.ts`, `backend/src/routes/fan.routes.ts`, `backend/src/controllers/fan.controller.ts`, `backend/src/controllers/stocks.controller.ts`
- Test: `backend/tests/integration/fan.test.ts` (extend), `backend/tests/integration/stocks.test.ts` (extend)

**Interfaces:**
- Consumes: `AutomationRepository`, `AutomationService`, `fanControlAvailable` (Task 2).
- Produces:
  - `GET /api/v1/stocks/:stockId/fan/automation` → `{ enabled, deltaOnK, deltaOffK, maxOutdoorHumidityPct, targetTempC, targetHysteresisK, minRunMinutes, minPauseMinutes }`
  - `PUT /api/v1/stocks/:stockId/fan/automation` — same body, same response.
  - `interface AutomationSnapshot extends AutomationState { available: boolean }` — composed here, not in the service: `available` is `fanControlAvailable(stock) && stock.hasGrainSensors` and needs the row this layer has already fetched (see Task 6).
  - The SSE and `GET …/fan` snapshot gain `status.contactorEngaged` and `automation: AutomationSnapshot`.
  - `GET /api/v1/stocks` gains `automation: { available: boolean; enabled: boolean }` per stock.

- [ ] **Step 1: Write the failing integration tests.** `GET` returns the defaults for a stock with no row. `PUT` stores and echoes, and a second `GET` returns the stored values. Each bound from the Global Constraints rejects with 400 — including the two cross-field ones, `delta_off_k` below 2 and `delta_off_k` not below `delta_on_k`. A null `targetTempC` is accepted. Both endpoints answer 404 for a stock without fan control and for one without grain thermometers, and 403 for a user outside the stock's tenant. `PUT` writes `automation_configured` with before and after values. Switching automation **on** triggers an evaluation; switching it **off** emits the change to an open stream (spec §7.1). The fan snapshot carries `contactorEngaged` and `automation`. `GET /stocks` carries `automation` for every stock, and `available: true` implies `fanControlEnabled: true` in the same payload — never the reverse: a stock with fan control but **no** grain thermometers reports `fanControlEnabled: true` beside `available: false`, which is the half of spec §3.2 a literal equality assertion would quietly delete.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w backend -- tests/integration/fan.test.ts tests/integration/stocks.test.ts`.
- [ ] **Step 3: Add the Zod schema** next to `fanCommandSchema`, with the bounds and the two cross-field refinements.
- [ ] **Step 4: Add the two handlers** to `FanHttpController` and the two routes with the existing middleware chain — `authenticate`, `validateParams(stockIdParamsSchema)`, `requireStockAccess`, and `validateBody` on the `PUT`. The `PUT` reads the current configuration first, writes the new one, writes `automation_configured` with both, and then — per spec §5.2 and §7.1 — calls `evaluateStock` when `enabled` went false → true and `notifyChanged` when it went true → false.
- [ ] **Step 5: Compose the snapshot**: the SSE handler subscribes to the controller's `onChange` and the service's `onChange` and sends the merged object; both unsubscribes belong in the existing teardown.
- [ ] **Step 6: Add the list field** in `stocks.controller.ts` using `getMany` — one query for the whole list, not one per stock.
- [ ] **Step 7: Run the whole backend suite.** Trap 16 applies.
- [ ] **Step 8: Commit.** `feat(backend): expose the automation configuration and state`

---

### Task 9: Frontend — types, client, status card, button selection

**Files:**
- Modify: `frontend/src/types/fan.ts`, `frontend/src/api/fan.ts`, `frontend/src/components/FanStatusCard.tsx`, `frontend/src/pages/FanControlPage.tsx`
- Test: `frontend/src/components/FanStatusCard.test.tsx`, `frontend/src/pages/FanControlPage.test.tsx` (extend)

**Interfaces:**
- Consumes: the wire shapes from Task 8.
- Produces: `FanStatus.contactorEngaged`, `FanSnapshot.automation`, `AutomationConfig` and `AutomationSnapshot` on the frontend side; `fanApi.getAutomation(stockId)`, `fanApi.putAutomation(stockId, config)`.

- [ ] **Step 1: Write the failing tests.** `FanStatusCard` shows the local-run notice for `contactorEngaged && !desiredOn` and does not show it when the backend is driving the fan. `FanControlPage` offers **no** switch-off button in that state, offers "Ausschalten" when `desiredOn`, "Erneut einschalten" on `FAULT`, "Einschalten" otherwise, and keeps the spinner for the two pending states. The order is the one in spec §8.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w frontend`.
- [ ] **Step 3: Extend the frontend types** — Trap 14: this is a second declaration of the backend's shape, keep the field names identical.
- [ ] **Step 4: Add the two API calls.**
- [ ] **Step 5: Add the notice** to `FanStatusCard` and rewrite `renderButton` to select on `desiredOn` and `contactorEngaged`.
- [ ] **Step 6: Run the frontend tests and type check.** `npm test -w frontend` and `npm run typecheck -w frontend`.
- [ ] **Step 7: Commit.** `feat(frontend): show a locally switched fan and pick the button from the desired state`

---

### Task 10: Frontend — the automation panel

**Files:**
- Create: `frontend/src/components/FanAutomationPanel.tsx`, `frontend/src/components/FanAutomationPanel.test.tsx`
- Modify: `frontend/src/pages/FanControlPage.tsx`

**Interfaces:**
- Consumes: `fanApi.getAutomation`, `fanApi.putAutomation`, `FanSnapshot.automation`.
- Produces: `<FanAutomationPanel stockId={string} snapshot={AutomationSnapshot} />`.

- [ ] **Step 1: Write the failing tests.** The panel loads the configuration and fills the fields. The switch submits `enabled` with the current parameters. A value outside a bound shows the field error from the 400 response rather than a generic failure. The current reason renders in German for each of the nine values, and an unknown value falls back to the raw string rather than crashing (Trap 15). The time of the last evaluation renders, and renders as "noch nicht ausgewertet" when it is null. The panel does not render at all when `available` is false.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w frontend`.
- [ ] **Step 3: Write the panel** with the nine German reason texts from spec §4.3, the number fields for the seven parameters, and one save action.
- [ ] **Step 4: Mount it** in `FanControlPage` and add the four new kinds to `EVENT_LABEL`.
- [ ] **Step 5: Run the frontend tests and type check.**
- [ ] **Step 6: Commit.** `feat(frontend): add the automation panel to the fan page`

---

### Task 11: Frontend — the overview card

**Files:**
- Modify: `frontend/src/api/stocks.ts`, `frontend/src/components/StockCard.tsx`
- Test: `frontend/src/components/StockCard.test.tsx` (extend)

**Interfaces:**
- Consumes: the `automation` field from `GET /stocks` (Task 8).
- Produces: nothing further.

- [ ] **Step 1: Write the failing tests.** A stock with `automation.available && automation.enabled` shows the marker; available but disabled shows the disabled form; unavailable shows nothing at all. The existing fan glyph and its accessible name are unchanged.
- [ ] **Step 2: Run them and watch them fail.** `npm test -w frontend`.
- [ ] **Step 3: Extend the stock type and the card**, following the icon-plus-`sr-only`-name pattern the card already uses for the thermometer and the fan.
- [ ] **Step 4: Run the frontend tests and type check.**
- [ ] **Step 5: Commit.** `feat(frontend): mark automation on the stock card`

---

### Task 12: Documentation and backlog

**Files:**
- Modify: `docs/specs/API.md`, `docs/BACKLOG.md`

- [ ] **Step 1: Document the two endpoints** in `docs/specs/API.md` in the style of the neighbouring fan endpoints: path, roles, body, response, the bounds, and the two 404 conditions.
- [ ] **Step 2: Document the new fields** — `status.contactorEngaged` with the note that it is the contactor's auxiliary contact and not the relay output (spec §6), `automation` in the fan snapshot, and `automation` in the stock list.
- [ ] **Step 3: Move the two deferred items** out of concept §11 into `docs/BACKLOG.md`: the retention of automation decisions, and the absent record of a start a blocking rule prevented. Add the five entries listed in spec §11 that do not exist yet, and extend the `viewer` entry by the two new endpoints.
- [ ] **Step 4: Run the whole suite one last time.** `npm run test`, `npm run lint`, `npm run typecheck` from the root, plus `npm test --prefix sim/shelly-emulator`.
- [ ] **Step 5: Commit.** `docs: document the automation endpoints and move the deferred items`

---

## Done when

- A stock with fan control, grain thermometers and automation enabled switches its fan on and off from the rules, and the fan page shows why.
- Switching by hand — in the app or at the contactor — switches automation off, and the app says so.
- `npm run test`, `npm run lint` and `npm run typecheck` pass from the root, and the emulator's own suite passes.
- Nothing in the fan control's existing behaviour changed except the two points spec §5.6 names.
