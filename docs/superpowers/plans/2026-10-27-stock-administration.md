# Stock Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator creates, edits and deletes stocks from the
application, and a changed fan configuration takes effect without restarting
the backend.

**Architecture:** Four admin endpoints on the existing admin router, backed by
`StockService` (id generation, invariants, stand-down on delete) over a
`StockRepository` that gains `create`/`update`/`delete`. `FanControlManager`
stops being a build-once object: its reconciliation tick compares the desired
wiring against the live one and builds, re-wires or retires accordingly. The
front end gets one admin page and one form dialog.

**Tech Stack:** Express 5, Drizzle ORM over better-sqlite3, Zod, Jest
(backend); React 19, Vite, Tailwind 4, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-10-27-stock-administration-design.md`

## Global Constraints

- **Language:** all code, comments, commit messages and documentation in
  English (UK). German only in user-facing UI strings, matching the existing
  pages.
- **No implementation in this plan.** Per the root `CLAUDE.md`, a plan names
  files, order and decisions; code appears only where the exact value *is* the
  requirement. Test bodies are described by their assertions, not written out.
- **TDD.** Test first, watch it fail, implement, watch it pass, commit.
- **Branch:** work on `main` directly (root `CLAUDE.md`, "Branching").
- **Scope:** findings outside the code a task touches go to `docs/BACKLOG.md`,
  not into the task.
- **Backend strictness:** `exactOptionalPropertyTypes` is on. Optional fields
  are assigned conditionally, never set to `undefined`.
- **Verification commands:**
  - backend, one file: `npm run test --workspace=backend -- <path>`
  - backend, all: `npm run test --workspace=backend`
  - frontend, one file: `npm run test --workspace=frontend -- <path>`
  - everything: `npm run test && npm run lint && npm run typecheck` from the root
- **Known flake:** the backend integration suite fails roughly one run in eight
  under the full parallel run with `Parse Error: Expected HTTP/, RTSP/ or ICE/`
  (backlog entry). Re-run the file alone before investigating.

---

## File Structure

**Backend — created**

| File | Responsibility |
|------|----------------|
| `backend/drizzle/0008_stock_admin.sql` | Drop `device_prefix`, make `device_group` nullable |
| `backend/tests/setup/stocks.ts` | Test fixture: a stock builder and the two reference stocks the suites used to take from the seed |
| `backend/tests/integration/admin.stocks.test.ts` | The four admin endpoints end to end |

**Backend — modified**

| File | Change |
|------|--------|
| `src/db/schema.ts` | `devicePrefix` removed, `deviceGroup` nullable |
| `src/db/types.ts` | `Stock.devicePrefix` removed, `deviceGroup` optional |
| `src/db/repositories/stock.repository.ts` | `upsertMany` out; `create`, `update`, `delete` in |
| `src/db/seed.ts` | **deleted** |
| `src/services/stock/stock.service.ts` | Create/update/delete with id generation, invariants, fan stand-down |
| `src/controllers/admin.controller.ts` | Four handlers |
| `src/routes/admin.routes.ts` | Four routes |
| `src/middleware/validation.middleware.ts` | `createStockSchema`, `updateStockSchema` |
| `src/services/mqtt/mqtt.service.ts` | `unsubscribe` on `MqttClientLike` and `MqttService` |
| `src/services/fan/fan.manager.ts` | Builder extracted; `reconcile` builds, re-wires, retires; unsubscribe on retire |
| `src/bootstrap.ts` | Manager built without fan stocks; wiring supplier instead of id set; `seedStocks` call removed |
| `src/controllers/stocks.controller.ts` | Two nullable-`deviceGroup` guards |
| `src/services/automation/automation.service.ts` | One nullable-`deviceGroup` guard |

**Frontend — created**

| File | Responsibility |
|------|----------------|
| `src/pages/AdminStocksPage.tsx` | List, active toggle, delete, dialog orchestration |
| `src/pages/AdminStocksPage.test.tsx` | Page behaviour |
| `src/components/StockFormDialog.tsx` | The ten-field form, its dependencies and its warning |
| `src/components/StockFormDialog.test.tsx` | Field dependencies, validation, warning |

**Frontend — modified**

| File | Change |
|------|--------|
| `src/types/api.ts` | `AdminStock`, request types, `AdminStocksResponse` |
| `src/api/admin.ts` | `listStocks`, `createStock`, `updateStock`, `deleteStock` |
| `src/App.tsx` | `/admin/stocks` route under `AdminRoute` |
| `src/components/Header.tsx` | Link in the desktop bar and the mobile menu |

**Docs — modified**

`docs/specs/API.md`, `docs/DEPLOYMENT.md`, `docs/BACKLOG.md`.

---

## Task 1: Migration and schema

**Files:**
- Create: `backend/drizzle/0008_stock_admin.sql`
- Modify: `backend/src/db/schema.ts`, `backend/src/db/types.ts`,
  `backend/src/db/repositories/stock.repository.ts`,
  `backend/src/db/seed.ts`, `backend/src/controllers/stocks.controller.ts:86`
  and `:169`, `backend/src/services/automation/automation.service.ts:367`
- Test: `backend/tests/db/migrations.test.ts`

**Interfaces:**
- Produces: `Stock` without `devicePrefix` and with `deviceGroup?: string`.
  Every later task depends on this shape.

- [ ] **Step 1: Write the failing migration test**

In `tests/db/migrations.test.ts`, following the file's existing pattern: a
database migrated to head has no `device_prefix` column on `stocks`, has a
nullable `device_group` (assert via `PRAGMA table_info(stocks)`), and a row
inserted before the migration keeps its `device_group` value. Use the raw
sqlite handle so the assertion does not depend on the Drizzle schema.

- [ ] **Step 2: Run it and watch it fail**

`npm run test --workspace=backend -- tests/db/migrations.test.ts`
Expected: fails because `device_prefix` still exists.

- [ ] **Step 3: Write the migration**

`backend/drizzle/0008_stock_admin.sql`, exactly this statement order — it is
load-bearing, and each statement is separated by drizzle's
`--> statement-breakpoint` marker as in `0005_tenants.sql`:

```sql
ALTER TABLE `stocks` DROP COLUMN `device_prefix`;
ALTER TABLE `stocks` ADD COLUMN `device_group_tmp` text;
UPDATE `stocks` SET `device_group_tmp` = `device_group`;
ALTER TABLE `stocks` DROP COLUMN `device_group`;
ALTER TABLE `stocks` ADD COLUMN `device_group` text;
UPDATE `stocks` SET `device_group` = `device_group_tmp`;
ALTER TABLE `stocks` DROP COLUMN `device_group_tmp`;
```

Do **not** generate this with `drizzle-kit generate`: it emits a twelve-step
table rebuild for the nullability change, which cannot work here (see Traps).
Write the file by hand and add its entry to `drizzle/meta/_journal.json` in the
same shape as the 0007 entry.

- [ ] **Step 4: Update the schema and the type**

`schema.ts`: delete the `devicePrefix` column and its doc comment; change
`deviceGroup` to `text('device_group')` without `.notNull()`.
`db/types.ts`: delete `devicePrefix`; make `deviceGroup` optional, keeping its
doc comment and adding that it is absent for a stock without grain
thermometers.

- [ ] **Step 5: Close the three nullable readers**

All three already sit behind `hasGrainSensors`, but TypeScript does not narrow
through the flag:
- `stocks.controller.ts:86` — the latest-readings ternary also requires
  `metadata.deviceGroup`
- `stocks.controller.ts:169` — the early return for "no grain thermometers"
  also covers a missing `deviceGroup`
- `automation.service.ts:367` — a missing `deviceGroup` yields no grain
  readings, which rule 1 then treats as missing data and switches off. Match
  the shape of the `outdoorDevice` branch directly below it, comment included.

- [ ] **Step 6: Drop `devicePrefix` from the remaining literals**

`src/db/seed.ts` and every test fixture that sets it. Find them with
`grep -rn "devicePrefix" backend/src backend/tests`.

- [ ] **Step 7: Full backend suite and typecheck**

`npm run test --workspace=backend && npm run typecheck --workspace=backend`
Expected: green.

- [ ] **Step 8: Commit**

```
feat(backend): drop device_prefix and allow a stock without a device group
```

---

## Task 2: Repository CRUD, seed removal, test fixture

**Files:**
- Create: `backend/tests/setup/stocks.ts`
- Modify: `backend/src/db/repositories/stock.repository.ts`,
  `backend/src/bootstrap.ts:26`
- Delete: `backend/src/db/seed.ts`, `backend/tests/db/seed.test.ts`
- Test: `backend/tests/db/repositories/stock.repository.test.ts`

**Interfaces:**
- Consumes: the `Stock` shape from Task 1.
- Produces:
  - `StockRepository.create(stock: Stock): Promise<void>`
  - `StockRepository.update(id: string, patch: StockPatch): Promise<boolean>` —
    `false` when no row matched. `StockPatch` is exported beside `Stock` in
    `src/db/types.ts`: every editable field optional, and the four nullable ones
    (`description`, `deviceGroup`, `outdoorDevice`, `fanTopicPrefix`) typed
    `string | null` rather than `string | undefined`, because `null` is a value
    here and `undefined` means "not in this patch"
  - `StockRepository.delete(id: string): Promise<boolean>` — `false` when no row matched
  - `tests/setup/stocks.ts`: `makeStock(overrides?: Partial<Stock>): Stock` and
    `insertStock(db: Db, overrides?: Partial<Stock>): Promise<Stock>`

A `null` in a `patch` field clears the column; an absent key leaves it alone.
That distinction is what lets `PATCH` clear a description without clearing
everything else, so `update` must not collapse `null` and `undefined`.

- [ ] **Step 1: Write the failing repository tests**

Extend `tests/db/repositories/stock.repository.test.ts`: `create` then
`findById` round-trips every field including the optional ones; `update` with a
single key changes only that column; `update` with an explicit `null` clears a
nullable column; `update` of an unknown id answers `false`; `delete` removes the
row and answers `true`, an unknown id answers `false`; deleting a stock that has
`fan_state`, `fan_events` and `stock_automation` rows removes those too (insert
them through their own repositories first, then assert the tables are empty).

- [ ] **Step 2: Run and watch them fail**

`npm run test --workspace=backend -- tests/db/repositories/stock.repository.test.ts`
Expected: fails, the methods do not exist.

- [ ] **Step 3: Implement the three methods**

In `stock.repository.ts`, beside the existing `toStock`. Keep the
conditional-assignment style for optional fields. Delete `upsertMany`.

- [ ] **Step 4: Run and watch them pass**

Same command. Expected: green.

- [ ] **Step 5: Write the test fixture**

`tests/setup/stocks.ts` exports `makeStock` (sensible defaults: id
`stk_test_1`, name `Halle 8`, `deviceGroup: 'corn-watch-1'`,
`outdoorDevice: 'corn-watch-1'`, humidity and thermometers on, active, fan
control off, `fanSwitchId: 0`, `tenantId: DEFAULT_TENANT_ID`, a fixed
`createdAt`) and `insertStock`, which writes one through `create`.

- [ ] **Step 6: Remove the seed**

Delete `src/db/seed.ts` and `tests/db/seed.test.ts`; remove the `seedStocks`
import and call from `bootstrap.ts`. Adjust `tests/unit/bootstrap.test.ts` to
match. Then replace every remaining `SEED_STOCKS` / `seedStocks` / `upsertMany`
use with the fixture — `grep -rn "SEED_STOCKS\|seedStocks\|upsertMany" backend`
finds them; expect roughly ten test files. Where a suite relies on two distinct
stocks, build both with `makeStock`.

- [ ] **Step 7: Full backend suite**

`npm run test --workspace=backend`
Expected: green. A fresh database now holds no stocks; any test that assumed
otherwise must create its own.

- [ ] **Step 8: Commit**

```
feat(backend): create, update and delete stocks in the repository
```

---

## Task 3: Stock service — generation, invariants, stand-down

**Files:**
- Modify: `backend/src/services/stock/stock.service.ts`
- Test: `backend/tests/services/stock.service.test.ts`

**Interfaces:**
- Consumes: `StockRepository.create/update/delete` from Task 2.
- Produces:
  - `StockService.createStock(input: CreateStockInput): Promise<Stock>`
  - `StockService.updateStock(id: string, patch: UpdateStockInput): Promise<Stock>`
  - `StockService.deleteStock(id: string): Promise<void>`
  - `StockServiceError` with a `code` of `'not_found' | 'conflict' | 'invalid'`,
    mirroring `UserServiceError` in `src/services/auth/user.service.ts`
  - `CreateStockInput` / `UpdateStockInput`, exported from
    `src/services/stock/stock.service.ts`

Decisions this task encodes:

- **Id generation.** `stk_001`, `stk_002`…, by the same scan-and-increment as
  `UserService.generateUserId` (`user.service.ts:312-324`): read all stocks,
  match `/^stk_(\d+)$/`, take the maximum, add one, pad to three digits. Ids
  that do not match — `grain-watch-1` — are ignored.
- **`createdAt`** is set here, ISO 8601, like the user service does.
- **`tenantId`** is always `DEFAULT_TENANT_ID`; it is not an input.
- **Invariants**, checked on create and on the merged result of an update, both
  raising `StockServiceError('invalid')`:
  - `fanControlEnabled` requires a non-empty `fanTopicPrefix`
  - `hasGrainSensors` requires a non-empty `deviceGroup`
- **Delete** raises `conflict` while `active` is true. Otherwise it stands the
  fan controller down first — `getFanManager()?.retireController(id)`, which
  already publishes the final `off`, stops the timers and writes the
  `stand_down` row — and only then deletes. The cascade removes that row again;
  the command and the unsubscribe are the point.
- **Reconciliation trigger.** After a successful create or update,
  `void getFanManager()?.reconcile()` so the change does not wait out the 60 s
  tick. Not awaited: the HTTP response must not hang on MQTT work, and the tick
  is the safety net. Delete awaits nothing extra — `retireController` is
  synchronous.

- [ ] **Step 1: Write the failing service tests**

Extend `tests/services/stock.service.test.ts` with a real in-memory database
(`createTestDb`) and a stub fan manager injected through `setFanManager`:
generated id is `stk_001` on an empty database and `stk_002` after one create;
an existing `grain-watch-1` does not disturb the sequence; `createdAt` is an ISO
string; `tenantId` is `tnt_default`; fan control without a prefix raises
`invalid`; grain thermometers without a device group raises `invalid`; an update
that would produce either state raises `invalid` even when the offending field
is the one *not* in the patch; updating an unknown id raises `not_found`;
deleting an active stock raises `conflict`; deleting an inactive one calls
`retireController` before the row disappears; create and update each trigger
`reconcile`.

- [ ] **Step 2: Run and watch them fail**

`npm run test --workspace=backend -- tests/services/stock.service.test.ts`

- [ ] **Step 3: Implement the service**

Import `getFanManager` from `../fan` — the registry is a module-level
singleton, so the service imports no manager type and tests can swap it.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Commit**

```
feat(backend): stock service with generated ids and configuration invariants
```

---

## Task 4: Admin endpoints

**Files:**
- Create: `backend/tests/integration/admin.stocks.test.ts`
- Modify: `backend/src/middleware/validation.middleware.ts`,
  `backend/src/controllers/admin.controller.ts`,
  `backend/src/routes/admin.routes.ts`, `docs/specs/API.md`

**Interfaces:**
- Consumes: `StockService` from Task 3, `getStockService()` from
  `src/services/index.ts`.
- Produces: the four endpoints under `/api/v1/admin/stocks`, and
  `createStockSchema` / `updateStockSchema` exported from the validation
  middleware.

Endpoint contract (spec §3):

| Method | Success | Errors |
|--------|---------|--------|
| `GET /admin/stocks` | 200 `{ stocks: [...] }` | — |
| `POST /admin/stocks` | 201, the created stock | 400 |
| `PATCH /admin/stocks/:stockId` | 200, the updated stock | 400, 404 |
| `DELETE /admin/stocks/:stockId` | 204 | 404, 409 |

Field bounds, copied from spec §2.2 — these exact values are the requirement:
`name` 1–100; `description` ≤500, nullable, empty string stored as `null`;
`deviceGroup` ≤64, nullable; `outdoorDevice` ≤64, nullable; `fanTopicPrefix`
≤200, nullable, rejected if it contains `#` or `+` or ends in `/`;
`fanSwitchId` integer 0–9; the four booleans plain.

`updateStockSchema` is the create schema made partial, minus nothing — every
editable field may appear alone. Reject an empty body, as
`updatePermissionsSchema` does.

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/admin.stocks.test.ts`, modelled on
`tests/integration/admin.test.ts`: admin lists, creates (201, generated id in
the body), patches a single field, and deletes an inactive stock (204); a
`viewer` token gets 403 on all four; no token gets 401; `DELETE` on an active
stock gets 409; `PATCH` on an unknown id gets 404; `POST` with
`fanControlEnabled` and no prefix gets 400; `POST` with `hasGrainSensors` and no
device group gets 400; `POST` with a prefix containing `#` gets 400; an empty
`PATCH` body gets 400.

- [ ] **Step 2: Run and watch them fail**

`npm run test --workspace=backend -- tests/integration/admin.stocks.test.ts`

- [ ] **Step 3: Add the schemas**

In `validation.middleware.ts`, beside `createUserSchema`, with the same
doc-comment style and `z.infer` type exports.

- [ ] **Step 4: Add the controller handlers**

Four methods on `AdminController`, following the existing handlers: try/catch
into `next(error)`, JSDoc with an example response. Map `StockServiceError`
codes onto the HTTP statuses — reuse whatever `admin.controller.ts` already
does for `UserServiceError` rather than inventing a second mapping.

The controller needs a `StockService`; add it as a third constructor argument
and pass `getStockService()` where the router builds the controller.

- [ ] **Step 5: Add the routes**

In `createAdminRouter`, after the user routes, with the same JSDoc block per
route. `validateParams(stockIdParamsSchema)` already exists for `:stockId`.

- [ ] **Step 6: Run and watch them pass**

- [ ] **Step 7: Document the endpoints**

`docs/specs/API.md`, a new subsection under "Admin user management" — or beside
it, renamed if the heading no longer fits. State the four endpoints, the two
invariants, that deletion requires an inactive stock, and that ids are
generated.

- [ ] **Step 8: Commit**

```
feat(backend): admin endpoints for stock administration
```

---

## Task 5: MQTT unsubscribe

**Files:**
- Modify: `backend/src/services/mqtt/mqtt.service.ts`,
  `backend/src/services/mqtt/index.ts`
- Test: `backend/tests/unit/services/mqtt.service.test.ts`

**Interfaces:**
- Produces: `MqttClientLike.unsubscribe(topic: string): void` and
  `MqttService.unsubscribe(topic: string): void`.

- [ ] **Step 1: Write the failing test**

`MqttService.unsubscribe` forwards the topic to the client, matching the
existing `subscribe` test in the same file.

- [ ] **Step 2: Run and watch it fail**

`npm run test --workspace=backend -- tests/unit/services/mqtt.service.test.ts`

- [ ] **Step 3: Implement**

Add the method to the interface and the class. Check `src/services/mqtt/index.ts`
— whatever adapts the real `mqtt.js` client to `MqttClientLike` needs the method
too; `mqtt.js` has `unsubscribe(topic)` with the same shape as `subscribe`.

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Commit**

```
feat(backend): let the MQTT service unsubscribe a topic
```

---

## Task 6: The manager reconciles

**Files:**
- Modify: `backend/src/services/fan/fan.manager.ts`
- Test: `backend/tests/unit/services/fan.manager.test.ts`

**Interfaces:**
- Consumes: `unsubscribe` from Task 5.
- Produces: `FanManagerDeps.fanWiring: () => Promise<Array<{ stockId: string; topicPrefix: string; switchId: number }>>`,
  replacing `fanEnabledStockIds`. `FanManagerDeps.mqtt` gains `unsubscribe`.
  Task 7 supplies the new dependency.

What `reconcile` does per tick, against the live map:

1. read the desired wiring; on a throw, log and keep the current wiring, as today
2. present but absent from the desired set, or marked `retiring` → retire
3. present and desired, but `topicPrefix` or `switchId` differs → retire, then
   build. The retirement publishes `off` on the **old** prefix: the device being
   disconnected must not keep running
4. desired but not present → build

Building a controller means what the constructor does today — command and
status topics, the `FanController` with its `onInterference` wrapper, the map
entry — plus what `init` does per stock: subscribe `<prefix>/monitor/#`,
`<prefix>/status/switch:<id>` and `<prefix>/online`, then `recover()`. Extract
that into one private method and have the constructor, `init` and `reconcile`
share it, so the three paths cannot drift.

Retiring additionally unsubscribes those three topics — **but only when no
remaining wiring uses the same `topicPrefix`.** Two stocks can share a prefix
through misconfiguration, and the survivor must keep its feed.

- [ ] **Step 1: Write the failing tests**

In `fan.manager.test.ts`, using the existing `fakeMqtt` helper (extend it with
an `unsubscribed: string[]` array): a stock that appears in the wiring is built
on the next tick, subscribed to all three topics and recovered; a changed
`topicPrefix` retires the old wiring (assert the `off` goes to the *old* command
topic) and subscribes the new one; a changed `switchId` re-wires likewise; a
retired stock's topics are unsubscribed; with two wirings sharing a prefix,
retiring one unsubscribes nothing; a throwing supplier leaves the wiring
untouched.

- [ ] **Step 2: Run and watch them fail**

`npm run test --workspace=backend -- tests/unit/services/fan.manager.test.ts`

- [ ] **Step 3: Implement**

Extract the builder, swap the dependency, extend `reconcile`, add the guarded
unsubscribe to `retireController`.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Commit**

```
feat(backend): build and re-wire fan controllers on the reconciliation tick
```

---

## Task 7: Bootstrap without a fan stock

**Files:**
- Modify: `backend/src/bootstrap.ts`
- Test: `backend/tests/unit/bootstrap.test.ts`

**Interfaces:**
- Consumes: `fanWiring` from Task 6.

Two changes to `initFanControl`:

- it no longer returns early on `fanStocks.length === 0`; the manager is built
  whenever `config.mqtt` and `config.fan` are present, with a possibly empty
  stock list. The log line changes from "skipping MQTT init" to saying the
  manager is up and waiting. The guard on a missing `config.mqtt`/`config.fan`
  stays — that is what keeps unit tests from opening a socket.
- `fanEnabledStockIds` becomes `fanWiring`, returning `selectFanStocks(current)`
  itself instead of a set of its ids.

The stale-desired-state cleanup above it and the "no MQTT topic prefix" warning
both stay: the warning now fires for a row an administrator has saved in that
state only if the invariant was bypassed, but it costs nothing and covers rows
written before this feature.

- [ ] **Step 1: Write the failing test**

In `tests/unit/bootstrap.test.ts`: with `config.mqtt` and `config.fan` present
and no fan-enabled stock, `getFanManager()` is not null afterwards. Check how
the file currently stubs `config` and follow it.

- [ ] **Step 2: Run and watch it fail**

`npm run test --workspace=backend -- tests/unit/bootstrap.test.ts`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Full backend suite, lint, typecheck**

`npm run test --workspace=backend && npm run lint --workspace=backend && npm run typecheck --workspace=backend`

- [ ] **Step 6: Commit**

```
feat(backend): keep the fan manager running with no fan-enabled stock
```

---

## Task 8: Front-end API layer

**Files:**
- Modify: `frontend/src/types/api.ts`, `frontend/src/api/admin.ts`

**Interfaces:**
- Produces:
  - `AdminStock` — every field the admin endpoints return: `id`, `name`,
    `description?`, `deviceGroup?`, `outdoorDevice?`, `hasHumidity`,
    `hasGrainSensors`, `active`, `createdAt`, `fanControlEnabled`,
    `fanTopicPrefix?`, `fanSwitchId`, `tenantId`
  - `CreateStockRequest`, `UpdateStockRequest` (all fields optional, nullable
    where the column is)
  - `adminApi.listStocks()`, `.createStock()`, `.updateStock()`, `.deleteStock()`

`AdminStock` is deliberately separate from the existing `GrainStock`, which is
what `/stocks` returns to ordinary users and carries readings, not
configuration.

- [ ] **Step 1: Add the types**

`types/api.ts`, in the "Grain Stocks" region, with the doc-comment style the
file already uses.

- [ ] **Step 2: Add the four calls**

`api/admin.ts`, following `listUsers` / `createUser` / `setActive`.

- [ ] **Step 3: Typecheck**

`npm run typecheck --workspace=frontend`
Expected: clean. No test of its own — these are thin axios wrappers, and Task 9
exercises them through the page.

- [ ] **Step 4: Commit**

```
feat(frontend): admin stock API client
```

---

## Task 9: The admin screen

**Files:**
- Create: `frontend/src/components/StockFormDialog.tsx`,
  `frontend/src/components/StockFormDialog.test.tsx`,
  `frontend/src/pages/AdminStocksPage.tsx`,
  `frontend/src/pages/AdminStocksPage.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Header.tsx`

**Interfaces:**
- Consumes: `adminApi` and the types from Task 8.
- Produces: `StockFormDialog` with props
  `{ open, stock?: AdminStock, onSave, onCancel }` — `stock` absent means
  create.

**The form** (spec §5), three labelled groups:

- *Stammdaten* — name, description, active
- *Sensorik* — `deviceGroup`, "Korn-Thermometer vorhanden", "Feuchte vorhanden",
  `outdoorDevice`
- *Lüftersteuerung* — enabled, topic prefix, switch id

**Field dependencies.** `deviceGroup` and the humidity checkbox are `disabled`
unless grain thermometers are ticked. Topic prefix and switch id are `disabled`
unless fan control is ticked. A disabled field keeps its value — in the form and
in what is sent — so re-ticking restores the previous configuration.

**The withdrawal warning.** Unticking fan control on a stock that currently has
it shows, before saving: the control is being withdrawn and the fan should be
checked on site. German, matching the tone of the existing pages. This is the
backlog entry "Warn about a running fan when fan control is withdrawn".

**Validation mirrored client-side** so the messages are German — the backend's
Zod messages arrive in English (known backlog entry, not repaired here). Mirror
the bounds listed in Task 4 plus the two invariants.

**The page** follows `AdminUsersPage`: `load` callback, loading spinner, error
band, back button, create button, a row per stock showing name, id in small
type, device group, icons for thermometers / humidity / fan, an active badge,
and buttons for edit, active toggle and delete. The delete button appears only
while the stock is inactive, and its confirmation dialog names the stock and
says the switching history and automation settings go with it.

- [ ] **Step 1: Write the failing dialog tests**

`StockFormDialog.test.tsx`: the device-group input and humidity checkbox are
disabled until thermometers are ticked; the topic prefix and switch id are
disabled until fan control is ticked; a disabled field's value survives a
tick-untick-tick cycle; unticking fan control on a stock that had it renders the
on-site warning; submitting a name longer than 100 characters shows a German
error and calls nothing; a valid submit calls `onSave` with the field values.

- [ ] **Step 2: Run and watch them fail**

`npm run test --workspace=frontend -- src/components/StockFormDialog.test.tsx`

- [ ] **Step 3: Implement the dialog**

Use `components/ui/dialog`, `input` and `button`, as `AdminUsersPage` does.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Write the failing page tests**

`AdminStocksPage.test.tsx` with `adminApi` mocked: the list renders a row per
stock; the delete button is absent for an active stock and present for an
inactive one; confirming a delete calls `adminApi.deleteStock` and reloads; the
active toggle calls `adminApi.updateStock` with `{ active: … }`; a failing load
shows the error band.

- [ ] **Step 6: Run and watch them fail**

`npm run test --workspace=frontend -- src/pages/AdminStocksPage.test.tsx`

- [ ] **Step 7: Implement the page, the route and the links**

`App.tsx`: `/admin/stocks` inside `AdminRoute`, beside `/admin/users`.
`Header.tsx`: a link in the desktop bar (beside the one at `:56-63`) and a row
in the mobile menu (beside `:107-112`), both behind `isAdmin`.

- [ ] **Step 8: Run the frontend suite, lint, typecheck**

`npm run test --workspace=frontend && npm run lint --workspace=frontend && npm run typecheck --workspace=frontend`

- [ ] **Step 9: Commit**

```
feat(frontend): administer stocks from the app
```

---

## Task 10: Documentation and backlog

**Files:**
- Modify: `docs/DEPLOYMENT.md`, `docs/BACKLOG.md`, root `package.json`

- [ ] **Step 1: Rewrite "Configuring a Stock" in `docs/DEPLOYMENT.md`**

The SQL recipe is obsolete. Replace it with the screen, and keep only what the
screen cannot do: assigning a tenant, and renaming an id (which means creating a
new stock).

- [ ] **Step 2: Update `docs/BACKLOG.md`**

Remove, because this feature closes them:
- "Stock configuration cannot be edited without SQL"
- "`device_prefix` has no reader"
- "`FanControlManager.reconcile` only retires, never adds"
- "Retirement never unsubscribes the stock's MQTT topics"
- "Warn about a running fan when fan control is withdrawn"

Shorten, because only part of it survives:
- "Clear-then-re-enable inside one tick retires the controller anyway" — the
  next tick now rebuilds the controller, so no restart is needed; what remains
  is the needless off/on cycle.

Amend, because this feature changes their shape:
- the `tenant_id` entry: stocks created through the screen always land in
  `tnt_default`, so a typo is no longer the expected failure; what remains is
  SQL-assigned tenancy and the missing startup warning.

- [ ] **Step 3: Bump the version**

`npm version minor --no-git-tag-version` in the root. One product version for
PWA and BFF (root `CLAUDE.md`, "Versioning").

- [ ] **Step 4: Everything, from the root**

`npm run test && npm run lint && npm run typecheck`
Expected: green. Re-run a failing integration file alone before investigating
— see the known flake under Global Constraints.

- [ ] **Step 5: Commit**

```
docs: stock administration replaces the SQL recipe
```

and then the release commit:

```
chore: release <new version>
```

---

## Traps

From the spec's §9, plus what surfaced while writing this plan. Each of these
costs an hour to rediscover.

- **`PRAGMA foreign_keys` is a no-op inside a transaction**, and drizzle's
  migrator wraps each migration file in one. The classic twelve-step table
  rebuild therefore cannot switch foreign keys off, and dropping `stocks` would
  hit the keys in `fan_state`, `fan_events` and `stock_automation`. Hence the
  temporary-column route in Task 1 — and hence *not* using `drizzle-kit
  generate`, which emits exactly that rebuild for a nullability change.
- **`ALTER TABLE … DROP COLUMN` refuses an indexed, unique or primary-key
  column.** `device_group` is none of those. Migration 0004 already dropped a
  column this way, so the bundled SQLite is new enough.
- **`exactOptionalPropertyTypes` is on in the backend.** Optional fields are
  assigned conditionally (`if (row.x !== null) stock.x = row.x`), never set to
  `undefined`. `stock.repository.ts`'s `toStock` is the pattern to copy.
- **TypeScript does not narrow `deviceGroup` through `hasGrainSensors`.** Each
  of the three readers needs its own check even though all three already sit
  behind the flag.
- **`update` must distinguish `null` from absent.** `null` clears the column,
  an absent key leaves it alone. Collapsing them breaks clearing a description.
- **`FanControlManager.route` returns after the first matching wiring** and
  compares with a trailing `/`. A nested prefix (`/x/fan` and `/x/fan/sub`)
  still collides; do not introduce one in test fixtures expecting both to work.
- **The admin endpoints bypass the tenant filter by role**, as the user
  endpoints do. `GET /api/v1/stocks` keeps its filter — do not route the admin
  list through `StocksController`.
- **The id generator scans and increments, so it races.** Two creations in
  flight pick the same `stk_NNN` and the primary key rejects the second.
  Inherited from `usr_NNN` and accepted; do not "fix" it here.
- **A fresh database now has no stocks.** Any test that relied on the seed must
  create its own, and a first-run deployment shows an empty home page until an
  administrator creates one.
