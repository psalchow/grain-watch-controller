# Stock Administration — Design Spec

**Date:** 2026-10-27
**Status:** Approved for planning

An administrator can create, edit and delete stocks from the application
instead of editing the SQLite file on the NAS by hand. Closes the backlog entry
"Stock configuration cannot be edited without SQL", which has been waiting since
2026-09-18, and three further entries that were explicitly deferred to this
screen.

The driver is commissioning: a new fan controller should be put into service
without a shell on the NAS, and a thermometer set that moves to another stock
should be re-assigned by the person who moved it.

## 1. Decisions

| Question | Decision | Why |
|----------|----------|-----|
| Stock id on creation | Generated, `stk_001`, `stk_002`… | Must be unique across tenants and need not be readable. With `device_group`, `outdoor_device` and the topic prefix all editable, an id like `grain-watch-1` claims a relationship that no longer holds. Mirrors `usr_001` (`user.service.ts:312-324`) |
| Existing ids | Untouched | `grain-watch-1` and `grain-watch-2` keep their ids; the generator ignores anything that does not match `stk_\d+` |
| New stock takes effect | Without a restart | The fan manager learns new and changed wiring on its reconciliation tick |
| Deletion | Hard `DELETE`, cascade | `fan_state`, `fan_events` and `stock_automation` go with it. InfluxDB measurements stay — they hang off `device_group`, not off the stock |
| Deletion precondition | Inactive only | A fan controller still wired is stood down by the backend as part of the deletion |
| Thermometer move | Two ordinary edits | No dedicated move dialog and no duplicate-`device_group` check. A short state where two stocks name the same group is accepted; the move is a supervised, once-a-season change |
| `device_prefix` | Dropped | Backlog entry "`device_prefix` has no reader": written by the seed, mapped by the repository, read by nothing. Cleared while this code is open |
| `device_group` | Becomes nullable | A stock without grain thermometers has no device group. All three readers already sit behind `has_grain_sensors` |
| Seed | Removed | Stocks are created through the screen. `seedStocks` and `StockRepository.upsertMany` go with it |
| Tenant | Not selectable | Every stock is created in `tnt_default`. No tenant selection anywhere in the product yet |

## 2. Data model

### 2.1 Migration `0008`

Two changes to `stocks`:

- drop `device_prefix`
- make `device_group` nullable, keeping every existing value

SQLite cannot relax `NOT NULL` with `ALTER COLUMN`, and a full table rebuild
would collide with the foreign keys in `fan_state`, `fan_events` and
`stock_automation` (see §9). The migration therefore moves the column's values
through a temporary column; the statement order is load-bearing:

```sql
ALTER TABLE `stocks` DROP COLUMN `device_prefix`;
ALTER TABLE `stocks` ADD COLUMN `device_group_tmp` text;
UPDATE `stocks` SET `device_group_tmp` = `device_group`;
ALTER TABLE `stocks` DROP COLUMN `device_group`;
ALTER TABLE `stocks` ADD COLUMN `device_group` text;
UPDATE `stocks` SET `device_group` = `device_group_tmp`;
ALTER TABLE `stocks` DROP COLUMN `device_group_tmp`;
```

Rollback is a database restore, as it has been since migration 0004.

### 2.2 Fields

| Field | Editable | Note |
|-------|----------|------|
| `id` | no | Primary key, referenced by three tables, appears in URLs |
| `created_at` | no | Set on creation |
| `tenant_id` | no | Always `tnt_default` |
| `name` | yes | 1–100 characters |
| `description` | yes | ≤500 characters; empty input stored as `NULL` |
| `device_group` | yes | ≤64 characters, nullable |
| `outdoor_device` | yes | ≤64 characters, nullable |
| `has_grain_sensors` | yes | |
| `has_humidity` | yes | |
| `active` | yes | |
| `fan_control_enabled` | yes | |
| `fan_topic_prefix` | yes | ≤200 characters, nullable, no `#` or `+`, no trailing `/` |
| `fan_switch_id` | yes | Integer 0–9 |

### 2.3 Invariants the API enforces

Three, all of which turn a silent misconfiguration into a rejected request:

1. `fan_control_enabled = true` requires a non-empty `fan_topic_prefix`.
   Today such a row produces a `console.warn` at startup ("no MQTT topic prefix
   for …", `bootstrap.ts`) and the stock reports no fan control with nothing in
   the UI saying why.
2. `has_grain_sensors = true` requires a non-empty `device_group`. The mirror
   image of the nullable column: no group, nothing to query.
3. A stored `fan_topic_prefix` is unique across all stocks and tenants; a
   duplicate answers 409 (added 2026-10-29, after a copied prefix started the
   neighbouring stock's fan). A prefix addresses one controller, so sharing one
   switches the wrong fan and leaves the second stock without status or monitor
   (§4.3, and the "first matching prefix" trap in §7). Compared verbatim: MQTT
   topics are case-sensitive. No unique index backs it — a database that
   already holds a duplicate would fail the migration at startup, and a single
   admin writer makes the service check sufficient.

`has_humidity` is **not** constrained by `has_grain_sensors`. The form locks the
field when the thermometers are deselected, but the stored value is kept, so a
stock that gets its thermometers back does not lose the setting. A stock with
`has_humidity` and no thermometers reports an empty humidity series, which is
what `stocks.controller.ts` already does for a stock without thermometers.

### 2.4 Repository

`StockRepository` gains `create`, `update` (partial) and `delete`.
`upsertMany` is removed with the seed.

## 3. API

Under `/api/v1/admin/stocks`, in the existing admin router behind
`authenticate` and `requireRole('admin')`.

| Method | Success | Errors |
|--------|---------|--------|
| `GET /` | 200 `{ stocks: [...] }`, full configuration | — |
| `POST /` | 201, created stock | 400 |
| `PATCH /:stockId` | 200, updated stock | 400, 404 |
| `DELETE /:stockId` | 204 | 404, 409 when the stock is active |

`PATCH` rather than `PUT`: the screen sends partial changes — a rename, an
active toggle — and `PATCH /admin/users/:userId` beside it has the same shape.

**Deletion order.** Reject with 409 while `active`. Otherwise stand the fan
controller down first (one final `off`, timers stopped, topics unsubscribed),
then `DELETE`. The `stand_down` row that the stand-down writes is removed again
by the cascade a moment later; the point of the stand-down is the command and
the unsubscribe, not the record.

## 4. Runtime fan wiring

`FanControlManager` builds its controllers once, in the constructor, and
`reconcile` only ever retires. Three changes make a configuration change take
effect without a restart.

### 4.1 The manager exists even with no fan stock

`initFanControl` returns early when no stock asks for fan control, leaving no
MQTT connection and no manager — nothing that could pick up the first stock
created through the screen. It now builds the manager whenever `config.mqtt`
and `config.fan` are present, with a possibly empty stock list.

Cost: an MQTT connection on an installation with no fan control at all. Unit
tests omit both config sections and therefore still open no socket.

### 4.2 `reconcile` reconciles

The dependency changes from `fanEnabledStockIds: () => Promise<Set<string>>` to
the full wiring — exactly what `selectFanStocks` already returns
(`stockId`, `topicPrefix`, `switchId`). Per tick:

- present, no longer wanted (or marked `retiring`) → retire, as today
- present and wanted, but `topicPrefix` or `switchId` differs → retire, then
  build. The retirement publishes `off` on the **old** prefix, which is the
  point: the device that is being disconnected must not keep running
- wanted, not present → build: create the controller, subscribe `monitor/#`,
  `status/switch:N` and `online`, call `recover()`

The constructor body moves into a private builder that both the constructor and
the build path use.

### 4.3 Unsubscribing

`MqttClientLike` has no `unsubscribe`, so a retired prefix keeps being delivered
until the process ends — until now a cosmetic leak (backlog entry "Retirement
never unsubscribes the stock's MQTT topics"), but with prefixes changing at
runtime it becomes a real one. `unsubscribe` is added to `MqttClientLike` and
`MqttService`, and `retireController` calls it.

Guard: unsubscribe only when no remaining wiring uses that prefix. Two stocks
can share a prefix through misconfiguration, and the survivor must keep its
feed. Since 2026-10-29 the API refuses the duplicate (§2.3), so only rows
written before that date can still reach the guard; it stays for them.

### 4.4 Latency

The reconciliation tick defaults to 60 s, too slow for feedback in a form. A
successful `POST` or `PATCH` therefore triggers `reconcile()` without awaiting
it; `DELETE` awaits the stand-down, because it has to happen before the row
goes.

### 4.5 What needs no change

Automation. `AutomationService` resolves both the controller and the stock list
per cycle through closures (`bootstrap.ts`), so a new stock becomes
automation-capable as soon as its controller exists.

### 4.6 Backlog entries this closes

- "`FanControlManager.reconcile` only retires, never adds" — closed
- "Retirement never unsubscribes the stock's MQTT topics" — closed
- "Clear-then-re-enable inside one tick retires the controller anyway" — largely
  dissolved: the next tick rebuilds the controller instead of requiring a
  restart. The entry is shortened to what remains, the needless off/on cycle

## 5. Frontend

**Route** `/admin/stocks` under `AdminRoute`, linked from `Header` at both
places that carry `/admin/users` today — the desktop bar and the mobile menu.

**`pages/AdminStocksPage.tsx`**, following `AdminUsersPage`: load, error band,
create button, dialogs. One row per stock showing the name, the id beneath it in
small type, the device group, icons for thermometers / humidity / fan, an active
badge, and buttons for *edit*, *active toggle* and *delete*. Delete appears only
while the stock is inactive.

**`components/StockFormDialog.tsx`** as its own file — ten fields would make the
page too large. One form for create and edit, in three groups:

- *Stammdaten*: name, description, active
- *Sensorik*: `device_group`, grain thermometers present, humidity present,
  `outdoor_device`
- *Lüftersteuerung*: enabled, topic prefix, switch id

When editing, the id is shown read-only at the top.

**Field dependencies.** `device_group` and *humidity present* are enabled only
while *grain thermometers present* is ticked. Topic prefix and switch id are
enabled only while *fan control enabled* is ticked. A locked field keeps its
value — both in the form and in the database — so re-ticking restores the
previous configuration rather than demanding it be typed again.

**Two warnings, both from the backlog.**

- Unticking *fan control enabled* shows, before saving: the control is being
  withdrawn, check the fan on site. This is the backlog entry "Warn about a
  running fan when fan control is withdrawn", which was deferred to this screen.
- Deletion asks for confirmation, names the stock, and states that the switching
  history and the automation settings go with it.

**Validation is mirrored client-side** so the messages are German. The backend's
Zod messages arrive in English — a known backlog entry, not repaired here.

`api/admin.ts` gains `listStocks`, `createStock`, `updateStock`, `deleteStock`;
the types go to `types/api.ts`.

## 6. Seed removal

`src/db/seed.ts`, the `seedStocks` call in `bootstrap.ts` and
`StockRepository.upsertMany` are removed, as is `tests/db/seed.test.ts`.
`tests/setup/db.ts` gains a fixture helper that inserts stocks through the new
`create`; the ten remaining test files that use `SEED_STOCKS` as a known data
base switch to it.

A fresh database therefore holds no stocks and the home page is empty until an
administrator creates one. Existing installations notice nothing: the rows are
already there, and `onConflictDoNothing` never changed them.

## 7. Testing

Backend:

- repository: `create`, `update`, `delete`, and the cascade into `fan_state`,
  `fan_events`, `stock_automation`
- `tests/integration/admin.stocks.test.ts`: all four endpoints, 403 for
  `viewer`, 409 on an active stock, 400 for both invariants of §2.3, 404
- `fan.manager.test`: reconcile builds a missing controller, re-wires on a
  changed prefix, and unsubscribes only when no other wiring holds the prefix
- `mqtt.service.test`: `unsubscribe`
- `migrations.test`: migration 0008 keeps existing `device_group` values
- `bootstrap.test`: the manager is built with zero fan stocks

Frontend: `AdminStocksPage.test.tsx`, `StockFormDialog.test.tsx`.

## 8. Out of scope

To the backlog, not into this change:

- tenant selection, and with it the deferred startup warning about a
  `tenant_id` with no matching `tenants` row
- the `viewer` role being able to write
- translating the backend's Zod messages
- renaming a stock id

## 9. Traps

Things that would cost an hour to rediscover.

- **`PRAGMA foreign_keys` is a no-op inside a transaction.** Drizzle's migrator
  wraps each migration file in one, so the classic twelve-step table rebuild
  (create new, copy, drop, rename) cannot switch foreign keys off and would hit
  the keys in `fan_state`, `fan_events` and `stock_automation` when `stocks` is
  dropped. Hence the temporary-column route in §2.1.
- **`ALTER TABLE … DROP COLUMN` needs SQLite 3.35+** and refuses a column that
  is indexed, unique or part of the primary key. `device_group` is none of
  these, and migration 0004 already dropped a column this way, so the bundled
  version is new enough.
- **`exactOptionalPropertyTypes` is on in the backend.** `StockRepository`
  builds its `Stock` by conditionally assigning the nullable fields rather than
  passing `undefined`; `device_group` joins `description`, `outdoor_device` and
  `fan_topic_prefix` in that pattern.
- **TypeScript does not narrow `device_group` through `has_grain_sensors`.**
  All three readers (`stocks.controller.ts` latest and history,
  `automation.service.ts` `read`) already sit behind the flag, but each needs
  its own explicit check once the field is nullable.
- **The id generator scans and increments, so it races.** Two creations in
  flight could pick the same `stk_NNN`; the primary key then rejects the second.
  Inherited from `usr_NNN` and left as is — one administrator, one form — but
  the failure mode is a constraint error, not a duplicate.
- **The stock list is served to non-admins through a tenant filter.** The admin
  endpoints bypass it by role, as the user endpoints do; the existing
  `GET /api/v1/stocks` must keep its filter untouched.
- **`FanControlManager.route` returns after the first matching prefix.** A build
  path that registers a wiring whose prefix is a prefix of another stock's would
  silently starve one of them; prefixes are compared with a trailing `/` for
  that reason.
