# Backlog

Work that is known, deliberate and deferred. See the scope rules in the root
`CLAUDE.md`: anything a task merely walks past lands here instead of growing the
task.

Each entry states what it is, why it was deferred, and where the code sits, so
it can be picked up without rediscovering the context. Remove an entry when it
is done; keep the list short enough to be read before every feature.

---

## A probe that is silent for a whole range vanishes from the history

**Deferred:** 2026-09-18 — current behaviour is the decided one, documented in
`docs/specs/API.md` ("Device rosters").

The history roster is the union of devices InfluxDB returned for the requested
range, so a probe dead since before the range has no legend entry and no empty
line. A position that was never fitted looks identical to a probe that died.

If dead probes should stay visible: union the range roster with devices seen in
a wider window (or with what `/latest` reports) and emit empty series for the
extras — `backend/src/controllers/stocks.controller.ts`, history branch.

## Stock card equipment icons carry no label on touch devices

**Deferred:** 2026-09-18 — icon-only presentation was the decided design.

`frontend/src/components/StockCard.tsx` shows a thermometer and a fan glyph with
an `sr-only` name and an SVG `<title>`. The title is a pointer-only affordance;
mobile browsers do not surface it on tap, and the PWA's primary device is a
phone.

Options: a short visible label beside each icon, or a tooltip component that
responds to tap.

## No per-stock record of which outdoor measurements are expected

**Deferred:** 2026-09-18 — every stock currently has both outdoor sensors, so
the case is not reachable.

`buildOutdoorConditions` treats "one of temperature/humidity present" as offline
(`backend/src/controllers/stocks.controller.ts`). A station that only ever
publishes temperature would therefore be greyed out permanently.

If such a station appears, add a flag mirroring `hasGrainSensors` and only treat
a missing partner as offline when it was expected. A stock with no outdoor
sensor at all is expressible since 2026-10-27: `stocks.outdoor_device` is left
empty and no outdoor query runs. The gap is the half-equipped station, not the
bare one.

## Changing a user's tenancy does not close an open SSE stream

**Deferred:** 2026-09-23 — pre-existing, restated in tenant terms because the
previous entry named `user_stock_access`, a table this change drops.

`requireStockAccess` runs once when the fan stream connects. Moving a stock to
another tenant or removing a user's membership therefore stops nothing until
the client reconnects or its access token expires (`JWT_EXPIRES_IN`, 15 minutes
by default) — the feature flag *is* re-checked on each reconciliation tick; the
tenant grant is not (`backend/src/controllers/fan.controller.ts`, `stream`).

The client side of the same case: `useFanStream` aborts on a 403 without
latching `disabled`, so `FanControlPage` keeps showing the last snapshot and an
enabled switch whose command then answers 403. A separate `forbidden` flag would
let the page say "kein Zugriff" rather than borrowing the "keine
Lüftersteuerung" wording, which would be the wrong cause.

## The `viewer` role already writes

**Deferred:** 2026-09-23 — noted while introducing tenants, not caused by them.

`POST /api/v1/stocks/:stockId/fan/command` applies `authenticate` and
`requireStockAccess`, not `requireRole`. A `viewer` can therefore switch a fan,
while `backend/src/models/user.model.ts` documents the role as read-only and
`docs/specs/AUTHENTICATION.md` repeats it. Automation and ventilation profiles
will add further write endpoints for exactly that role. Renaming it to
`operator` costs a migration on `users.role`, the enum in
`updatePermissionsSchema`, the frontend strings and the two documents above.

**Extended 2026-09-30**, by the automation core: `GET`/`PUT
/api/v1/stocks/:stockId/fan/automation` (`backend/src/routes/fan.routes.ts`)
apply the same `requireStockAccess`-only shape as the command endpoint beside
them, so the `viewer` role can now also switch automation on and off and
change its parameters. Same fix, same cost, one more endpoint pair to update
when it lands.

## Per-stock grants inside a tenant are gone

**Deferred:** 2026-09-23 — accepted alongside the tenants migration
(migration 0005), which widens access for anyone who held a partial stock grant.

Tenant membership is all-or-nothing: a user reaches every stock of their
tenant, and the finer per-stock grant that `user_stock_access` used to offer has
no equivalent. Reinstating it means a filter *inside* a tenant, not a return to
the dropped table.

## A wrong `stocks.tenant_id` disappears silently

**Deferred:** 2026-09-23 — accepted; `stocks.tenant_id` carries no foreign key
(SQLite refuses `ADD COLUMN` with both `REFERENCES` and a non-null default).
Amended 2026-10-27: stocks created in the admin screen always land in
`tnt_default`, so a typo is no longer the expected failure.

What remains is SQL-assigned tenancy (`docs/DEPLOYMENT.md`, "What the screen
cannot do"): a typo there makes the stock drop out of its intended tenant's
`GET /stocks`, while an administrator — who bypasses the tenant filter by role —
still sees it.

`initFanControl` already reads every stock at startup. Warning there about a
`tenant_id` with no matching `tenants` row would turn that into a log line, for
a few lines of code.

A stock inserted by SQL without naming `tenant_id` does not error either: the
column's default is `'tnt_default'`, so it silently joins that tenant.

## The offline flag trusts the device clock

**Deferred:** 2026-09-18 — decided to leave as is; documented in
`docs/specs/API.md`.

Stock readings are flagged offline by comparing `measurementTimeS`, reported by
the device, while the look-back window filters on InfluxDB's ingest time. A
skewed device clock shifts the flag in either direction, and a reading with no
timestamp is never flagged.

Fixing it means obtaining a per-device ingest timestamp, which InfluxQL does not
return alongside a multi-field `LAST()` — it would need a second query.

## The withdrawal never reaches a client that is watching

**Deferred:** 2026-09-20 — the record survives in `fan_events`, only the live
view misses it.

`retireController` switches the fan off, which emits a status change. The SSE
guard sees the stock is already retiring, so it ends the stream with `disabled`
*instead of* pushing that last snapshot, and the `stand_down` row is written
afterwards. A user sitting on the fan page therefore sees the notice but a
history that stops before the switch-off, and the `stand_down` label in
`EVENT_LABEL` is unreachable live. Opening the page later while control is
withdrawn answers 404, so the history is empty there too — the entries only
become visible once fan control is enabled again.

Closing it: write `stand_down` first, then command off, then push one final
snapshot before ending the stream.

## A second consecutive 401 leaves the fan stream silently dead

**Deferred:** 2026-09-20 — pre-existing; the new non-stream guard would cover it
if the 401 branch did not return first.

`useFanStream` gives up after one token refresh: the second 401 only sets
`connected: false` and returns, so fetch-event-source parses the JSON error body
as a stream, reaches a clean end of body and resolves. No retry, no `onerror`,
no signal — the page sits on the last snapshot with a live-looking button.

`refreshAttempts` makes it easier to reach than it looks: it is reset only on a
successful open, never when the effect re-runs. `StockDetailPage` is not
remounted when the `:stockId` route param changes, so navigating away from a
stock that spent its refresh carries the count into the next stock, where a
single 401 then lands in the give-up branch directly.

Closing it: abort on the second 401, as the 404 and 403 branches do, surface it,
and reset the ref at the top of the effect body.

## A stray 404 latches the fan page into "no fan control"

**Deferred:** 2026-09-20 — needs a 404 from something other than the fan
endpoint, which a single proxy in front of one backend rarely produces.

`useFanStream` treats any 404 on the stream URL as fan control having been
withdrawn: it latches `disabled` and stops reconnecting. A proxy with no
matching upstream, or a changed API base path after a deploy, reads the same.
Re-enabling fan control also leaves a latched client showing the notice until
the page is reloaded.

Closing it: read the error envelope in `onopen` and latch only on the backend's
own shape, treating a bare 404 as transient.

## Shelly feedback is subscribed at QoS 0

**Deferred:** 2026-09-19 — changing it alters broker session semantics, so not a
drive-by edit.

`backend/src/services/mqtt/index.ts` subscribes to the monitor, status and
online topics without options, i.e. at QoS 0, while fan commands go out at
QoS 1. A dropped status message therefore leaves the card showing a stale state
until the next one arrives.

Subscribing at QoS 1 would make the feedback path as reliable as the command
path. Low urgency: nothing decides anything on the absence of a message.

## Error middleware writes after the response has started

**Deferred:** 2026-09-20 — pre-existing gap; the SSE stream is the first route
that can reach it.

`backend/src/middleware/error.middleware.ts` does not check `res.headersSent`
before writing its JSON envelope. `FanHttpController.stream` sends its first
snapshot after `res.writeHead(200, …)`, and that read can throw, so `next(error)`
runs with the headers already flushed. Express then destroys the socket through
its default handler and the original error is lost.

Closing it: `if (res.headersSent) return next(error);` at the top of the
middleware, after logging the error.

## MQTT client has no error listener

**Deferred:** 2026-09-20 — pre-existing, and the fan work only walks past it.

`backend/src/services/mqtt/index.ts` connects without an `'error'` listener.
`mqtt.js` emits `error` on ordinary outage paths (stream errors, connack
timeout, keepalive timeout), and an unhandled `error` event takes the whole BFF
down, not just fan control. A one-line listener that logs and lets
`reconnectPeriod` do its job closes it.

## The reachability badge affirms a reachability the backend cannot observe

**Deferred:** 2026-09-21 — weighed against the operating reality and accepted.

`fanControlReachable` moves only when an `online` LWT message is routed
(`backend/src/services/fan/fan.manager.ts`). `MqttClientLike`
(`backend/src/services/mqtt/mqtt.service.ts`) exposes `message` alone, so no
connect, close or offline event reaches the manager — the same surface as the
missing error listener above. If the backend keeps running but loses its broker
link, the last value freezes, usually `true`. The SSE stream to the browser is
unaffected, so `connected` stays true and the badge is not dimmed either: the
card states "Steuerung erreichbar" on no evidence.

Two things made this worth recording rather than ignoring. Showing the badge
permanently turned what used to be silence into a positive claim — the old card
rendered nothing for a frozen `true`. And the rename widened the promise:
`shellyOnline` reported the LWT verbatim and left the reader to draw the
conclusion, while `fanControlReachable` asserts something the data does not
cover. The field's doc comment and `docs/specs/API.md` now state that limit; the
badge label does not.

Fix when it becomes worth it: give `MqttClientLike` the connection events
mqtt.js already emits, have `MqttService` forward them, and let
`FanControlManager` reset every controller's reachability to `null` — unknown
rather than unreachable, since the device itself may be fine. The existing
dedupe in `handleReachability` and the `online_change` log entry then cover it.

## Backend integration suite is flaky under the full parallel run

**Deferred:** 2026-09-20 — pre-existing; seen repeatedly during this work.

`backend/tests/integration/*` fails roughly one run in eight when both
workspaces run in parallel, with `Parse Error: Expected HTTP/, RTSP/ or ICE/`
from supertest, on varying tests. The same files pass when run alone, so it
looks like socket contention between Jest workers rather than a logic bug.

Worth pinning down (one supertest agent per file, or a worker cap for the
integration suites) so a red run means something.

## A failing audit write blocks the MQTT command

**Deferred:** 2026-09-20 — pre-existing ordering, applies to every switch command.

`FanController.beginTurnOn`/`beginTurnOff` write the `fan_events` row before
publishing to MQTT, so a failing SQLite insert (locked database, full disk)
means the command never reaches the device. For a switch-off that is the wrong
way round: the wire action matters more than its record.

Publishing first and logging afterwards would flip it, at the cost of losing the
record when the publish throws. Worth deciding deliberately rather than in
passing.

**Extended 2026-09-30**, by the automation core: `AutomationService.act`
(`backend/src/services/automation/automation.service.ts`) issues its MQTT
command *before* writing the `auto_on`/`auto_off` event, the opposite order
from `FanController.beginTurnOn`/`beginTurnOff` above, on the same reasoning
inverted — there the audit trail is what a failing write must not cost the
switch-off; here the command is the safety-relevant action and the event is
only the record of why. The repository now carries both orderings for the same
trade-off, decided separately each time rather than once. Worth settling which
one a switch command should follow generally, now that there are two data
points.

## A failed switch-off during a fan re-wire can resume `on` on unobserved hardware

**Deferred:** 2026-10-27 — reachable only through the failing-write family
above.

If `controller.command('off')` throws before the state is persisted, the rebuilt
controller's `recover()` reads a `desiredOn` that was never cleared and
publishes `on` to the new command topic — hardware the backend has never
observed. Code: `FanControlManager.reconcile`
(`backend/src/services/fan/fan.manager.ts`) and `FanController.recover`
(`backend/src/services/fan/fan.controller.ts`). Settling the ordering question
above decides this too.

## Clear-then-re-enable inside one tick switches the fan off needlessly

**Deferred:** 2026-09-19 — needs a mistaken edit corrected within 60 s, which
the operating reality makes unlikely.

If a request marked the stock while its fan control was briefly cleared, the
next tick retires the controller (one `off`, a `stand_down` row, automation
disabled through `onControlWithdrawn`) and rebuilds it within the same tick; no
restart is needed. What remains is the needless `off`
(`FanControlManager.reconcile`, `backend/src/services/fan/fan.manager.ts`).

Closing it: retire only on `!wanted.has(stockId)`, and clear the mark when the
fresh read still contains the stock.

## Startup clears a stale desired state without an audit entry

**Deferred:** 2026-09-19 — cosmetic gap in the event log.

`initFanControl` clears `fan_state.desired_on` for rows that no longer ask for
fan control and only logs to the console, while the runtime path
(`FanControlManager.retireController`) writes a `stand_down` row to
`fan_events`. The same
event therefore appears in the fan history when it happens at runtime, and not
when it happens at startup.

## `TURN_OFF_PENDING` has no timeout

**Deferred:** 2026-09-19 — out of scope while bounding the retirement retries.

`beginTurnOff` (`backend/src/services/fan/fan.controller.ts`) publishes `off` and
arms no watchdog, so the state only leaves `TURN_OFF_PENDING` when the Shelly
answers. A silent device leaves the card showing "wird quittiert" indefinitely.
Retirement is unaffected — it is a single best-effort `off` backed by the
device's own auto-off — so this is about the user-initiated switch-off only.

Arming the watchdog on `off` as well would resolve it to `FAULT` instead. That
changes the behaviour of ordinary switching, so it wants its own look:
`FAULT` currently means "the device reported a problem", and a missing ack is a
different thing.

**Extended 2026-09-29**, while specifying the automation core. It does not take
a silent device: monitor messages are QoS 0 without retain, so an ordinary
switch-off that works exactly as designed locks the page whenever that one
packet is lost. The automation spec establishes the opposite doctrine for the
local-switching case — never enter a pending state you cannot leave — which
makes the gap here visible by contrast, and the button ordering that spec adds
to `FanControlPage` does not close it: pending is tested first, so the page
stays locked although `desiredOn` is already false and would render a usable
button. Second option alongside the watchdog: let the page fall back to
`desiredOn` once a pending state has stood for longer than the watchdog window.

## No in-app prompt when a new bundle is available

**Deferred:** 2026-09-17 — the update banner was reverted in `b68be57`.

The service worker updates itself (`registerType: 'autoUpdate'`), but until it
takes control a cached bundle can render fields the new backend no longer sends.
The `deviceCount` removal is the current example, noted in
`docs/DEPLOYMENT.md`.

## Automation: no counter on repeated `watchdog_off`

**Deferred:** 2026-09-29, in the fan automation core design (spec §5.5,
concept §11) — no evidence yet that delivery failures occur in practice.

`watchdog_off` deliberately does not disable automation
(`backend/src/services/automation/automation.service.ts`, the callback wired
in `backend/src/services/fan/fan.manager.ts`): a lost QoS-0 monitor packet must
not cost a season of ventilation. But nothing bounds how often it can recur — a
broken monitor path makes the automation retry `on` every
`min_pause_minutes`, trip the watchdog again, and write four event rows per
round indefinitely.

Add a counter, on the same idea as the `local_switch`/`fault` counting this
backlog already anticipates, once real-world data shows the trip rate worth
reacting to.

## Automation: no cause on the overview card, no event for a blocked start, short retention

**Deferred:** 2026-09-29, in the fan automation core design (spec §11, concept
§11) — three related gaps, none of them acted on in v1.

- The overview card (`frontend/src/components/StockCard.tsx`) shows no cause
  for the last self-disable. The event list already carries it in full
  (`automation_disabled` with a `cause` of `manual_command`, `local_switch`,
  `fault` or `fan_control_withdrawn`); showing it on the card needs the cause
  stored somewhere the card can read cheaply and translated for German.
- No event is written for a start a blocking rule prevented (a `min_pause` or
  `min_run_time` hold that suppressed what would otherwise have switched) —
  only realised decisions are logged. An edge-triggered event on the
  transition into that hold would close it.
- `fan_events` is swept wholesale after `FAN_EVENT_RETENTION_DAYS` (90 days by
  default), which also governs automation's own `auto_on`/`auto_off`/
  `automation_disabled`/`automation_configured` rows. A longer, separate
  retention for automation decisions was named in the concept but not
  implemented.

All three were recorded only in the concept document's §11
(`docs/superpowers/specs/2026-09-20-automatic-fan-control-concept.md`); this
entry is where they now live.

## Automation: the concept's later extensions

**Deferred:** 2026-09-29, in the fan automation core design (spec §11, concept
§10) — scoped out of sub-project C, left for D and later.

The concept's §10 names four extensions this core does not implement: a
seasonal switch (skip evaluation outside the ventilation months), a selectable
control variable (something other than the grain/outdoor temperature delta), a
trigger on the absolute outdoor temperature (needed for stocks with no grain
thermometers, since the differential rule has nothing to compare there), and
tenant-scoped automation profiles (sub-project D, which lifts the
per-stock `stock_automation` row into the tenant profile mechanism — design
spec §3.1 notes the table is already shaped for that move).

## A contactor engaged by hand cannot be opened by the backend

**Deferred:** 2026-09-29, in the fan automation core design (spec §6, §11).

Switching by hand at the contactor bypasses the Shelly's relay entirely: the
backend's `off` only releases its own relay, and the Shelly's one-hour auto-off
does not help either, because the Shelly's output was never what carried the
load. `FanStatus.contactorEngaged` (`backend/src/services/fan/types.ts`) makes
the state visible, and automation disables itself rather than pretending to
hold a safety rule it cannot enforce (design spec §6), but nothing turns the
fan off in that situation short of somebody walking back to the contactor. No
software closes this; it is worth writing down because it bounds the reach of
every safety rule this system implements, present and future.

## Backend validation messages reach the German UI in English

**Deferred:** 2026-09-30, found while implementing the fan automation core.

Zod messages from `automationConfigSchema`
(`backend/src/middleware/validation.middleware.ts`, e.g. "deltaOnK must be at
most 20") are English and travel verbatim to `FanAutomationPanel.tsx`'s field
errors. The decided approach, matching how
`frontend/src/lib/messages.ts` already translates device strings, is a lookup
table at the UI boundary — roughly ten entries for the automation schema's
messages plus a raw-string fallback for anything unmapped — keeping the API's
own text in English as every other error message does.

## The state diagram in the fan-control design no longer matches `off` from `FAULT`

**Deferred:** 2026-09-30, found while implementing the fan automation core.

`docs/superpowers/specs/2026-07-09-fan-control-design.md` §3.3 still diagrams
`FAULT ──command on/off (user retry)──▶ TURN_ON_PENDING / TURN_OFF_PENDING`. The
automation core adds the rule *never enter a pending state you cannot leave*
(design spec §5.6): a user `off` while the fan is in `FAULT` no longer enters
`TURN_OFF_PENDING`, because there is nothing to acknowledge into it. That is the
correct behaviour under the new rule, but it falsifies the older diagram, which
was never updated. Redraw the `FAULT` → `off` edge (and its label) the next
time that document is touched.

## Automation: `lastEvaluation` and the audit write are not kept in step

**Deferred:** 2026-09-30, found in the final review of the fan automation core —
both are consequences of the write order settled in "A failing audit write
blocks the MQTT command" above, and belong with it when that one is picked up.

Two ends of the same seam in `AutomationService`
(`backend/src/services/automation/automation.service.ts`):

- A throwing `eventsRepo.insert` inside `act` propagates out of `evaluateOne`
  into `evaluateSafely`, which logs it — so the trailing `emit(stock.id)` never
  runs, and an open page misses the push for the very tick that switched the
  fan. The command itself went out first and is unaffected.
- An evaluation that the `enabled` re-read (or the controller re-resolution
  beside it) blocks still records its reason in `lastEvaluation` and pushes it.
  The stock is reported as having decided something it deliberately did not
  act on.

Both are cosmetic against the plant and neither changes what the fan does.
Settling the command/audit ordering question is what decides how the emit
should be sequenced around the write.

## Automation: `runCycle` has no re-entrancy guard

**Deferred:** 2026-09-30, found in the final review of the fan automation core;
an inherited pattern rather than a new one.

`AutomationService.start` (`backend/src/services/automation/automation.service.ts`)
arms `setInterval(() => void this.runCycle(), …)` with an async body and
nothing that stops a second cycle starting while the first is still awaiting
its InfluxDB reads. At the default interval of five minutes that needs a very
slow database, but the reads are the only thing bounding it, and two cycles in
flight both touch `readFailures` — so a failure counted by one and reset by the
other can delay or bring forward the three-strike switch-off of §5.3.

`FanControlManager.reconcile` (`backend/src/services/fan/fan.manager.ts`) is
armed exactly the same way, so whatever guard is chosen (a boolean in flight,
or a self-rescheduling timeout) should be applied to both.

A `reconcile` in flight across `StockService.deleteStock` shares the gap
(2026-10-27): `fan.manager.ts` (~:161-163) rebuilds any wanted stock missing
from the map, so a tick that read its wiring before the delete rebuilds a
controller for a row that no longer exists. The next tick retires it; its
`fan_events` writes fail the foreign key (logged, not thrown). The window is one
microtask, as better-sqlite3 reads are synchronous, so it is not reachable in a
real deployment.

## `AUTOMATION_DEFAULTS` is handed out by reference

**Deferred:** 2026-09-30, found in the final review of the fan automation core;
no caller mutates it today.

`AutomationRepository.get` returns the shared `AUTOMATION_DEFAULTS` object
itself when no row exists, and `getMany` seeds every gap with the same
reference (`backend/src/db/repositories/automation.repository.ts`,
`backend/src/db/schema.ts`). Every current caller treats the result as
read-only — the service copies it into the `upsert` payload with a spread —
but one that edited a field in place would rewrite the defaults for the whole
process, and for every unconfigured stock with it. Returning `{ ...AUTOMATION_DEFAULTS }`
closes it; doing it now would be a change with no failing case behind it.

## `EVENT_LABEL` resolves a wire value through `Object.prototype`

**Deferred:** 2026-09-30, pre-existing; the automation core only added four
keys to it.

`EVENT_LABEL` in `frontend/src/pages/FanControlPage.tsx` is a plain `Record`
indexed by `ev.kind`, a value that arrives from the wire, so a kind such as
`constructor` resolves through the prototype chain instead of falling through
to the `?? ev.kind` fallback and renders a function source in the history list.
`REASON_LABEL` in `FanAutomationPanel.tsx` uses a `Map` for exactly that reason
and says so in its doc comment, as does `FanStatusCard`'s reachability lookup.
The repository therefore now carries both patterns for the same problem.
Reaching it needs the backend to write an unexpected `kind`, which only its own
code does — hence not repaired on the spot.

## `Stock.active` is not filtered out of the automation cycle

**Deferred:** 2026-09-30, found while implementing the fan automation core;
pre-existing and shared with `selectFanStocks`.

`AutomationService`'s cycle (`backend/src/services/automation/automation.service.ts`)
evaluates every stock `automationAvailable` reports true for, without checking
`Stock.active`. An inactive stock that still has fan control and grain
thermometers is evaluated and can be switched by the rules like any other.
`selectFanStocks` (`backend/src/services/fan/fan.manager.ts`) has the identical
gap for ordinary fan control, so this is not new — automation just inherits it
unchanged.

## The generic status update is logged but never reconciled

**Deferred:** 2026-10-20, found while fixing the status-message flood in the
switching history.

Design spec §3.3 says the Shelly's generic status update "reconciles the
authoritative output state". `FanController.handleStatus`
(`backend/src/services/fan/fan.controller.ts`) only writes an audit row when
`output` changes; it does not compare that output against the reported state or
the desired state, so an output the backend did not command — an auto-off that
fires without a monitor message, for instance — still shows as `ON` until the
next monitor message or the watchdog corrects it. Repairing it means deciding
what a divergence should do (correct the state, raise a fault, re-assert the
command), which is a behaviour change, not a defect in the code this task
touched.

## `StockService.applyPatch` duplicates `StockRepository.update`

**Deferred:** 2026-10-27 — found in review of stock administration.

`StockService.applyPatch` (`backend/src/services/stock/stock.service.ts`)
repeats the field-by-field patch logic of `StockRepository.update`. A field
added to `StockPatch` must be added in both, and nothing enforces that.

## `createStockSchema` accepts `""` for device selectors and topic prefix

**Deferred:** 2026-10-27 — a fix would exceed the bounds the design spec states.

`deviceGroup`, `outdoorDevice` and `fanTopicPrefix` accept an empty string
(`backend/src/middleware/validation.middleware.ts`). An empty `outdoorDevice` is
stored as a selector that matches nothing. The service's invariants treat blank
as missing, so only the stored value is odd. Closing it: `.trim().min(1)`, or
storing `""` as null.

## Fan automation spec §5.5 misdescribes when `fan_control_withdrawn` fires

**Deferred:** 2026-10-27 — documentation only.

`docs/superpowers/specs/2026-09-29-fan-automation-core-design.md` §5.5 says
`retireController` fires `fan_control_withdrawn` only on withdrawal; it now also
fires on a wiring change. Related: the same event is recorded twice in different
words — the `stand_down` row says "fan wiring changed", the `automation_disabled`
row says `fan_control_withdrawn` — unavoidable while `DisableCause` is a closed
four-value union.

## `makeStock` cannot express an absent optional

**Deferred:** 2026-10-27 — found while writing stock administration tests.

Under `exactOptionalPropertyTypes`, `makeStock` (`backend/tests/setup/stocks.ts`)
cannot leave a field out, so tests needing a stock without an `outdoorDevice`
pass a full literal to `create` instead. An `omit` option would close it.

## Leftovers of the stock administration screen

**Deferred:** 2026-10-27 — three trivial gaps, found in review.

- Neither `AdminStocksPage` nor `AdminUsersPage` (`frontend/src/pages/`)
  guards against a double click on its row actions; the second request 404s into
  the error band.
- `frontend/src/components/Header.test.tsx` has no case for the two new `Stocks`
  links; its existing counts key on `Users` and `Account`.
- `AdminStocksPage`'s Equipment cell is empty for a stock with no thermometers,
  no humidity and no fan control, where `StockCard` shows explanatory text in the
  same situation.

## `route()` dispatches a shared prefix to one stock only

**Deferred:** 2026-10-27 — pre-existing, but the stock form now makes it
reachable without a hand-edited row.

`FanControlManager.route` (`backend/src/services/fan/fan.manager.ts`, ~:296-298)
returns after the first wiring whose prefix matches. When two stocks share a
`fan_topic_prefix`, the second receives no monitor, no status and no `online`,
while the backend keeps publishing its commands. The design spec
(`docs/superpowers/specs/2026-10-27-stock-administration-design.md` §4.3) accepts
the shared prefix deliberately — the unsubscribe guard in `unsubscribeWiring`
exists for it — so this records the half that was not closed: dispatch to every
matching wiring, or refuse the duplicate in `StockService.assertInvariants`.

## The form's topic-prefix rules apply while fan control is off

**Deferred:** 2026-10-27 — only reachable on rows written by SQL before 1.6.0.

`frontend/src/components/StockFormDialog.tsx` (~:83-97) validates
`fanTopicPrefix` unconditionally, so a legacy row whose prefix ends in `/`
(nothing validated these before 1.6.0) cannot be renamed until the prefix is
corrected. Validating only while fan control is enabled would close it.

## A wiring whose recovery fails stays in the map half-activated

**Deferred:** 2026-10-27 — consequence of guarding `buildWiring`; acceptable
under the operating reality (the Shelly's own auto-off, recovery on restart).

`FanControlManager.createWiring` (`backend/src/services/fan/fan.manager.ts`)
inserts the map entry before `activateWiring` runs, so when `recover()` throws,
`buildWiring` logs it and the wiring stays: subscribed, but its desired state
not resumed. The next tick finds a matching prefix and never retries it.

Closing it: retry the activation on the next tick, or insert the map entry only
once activation has succeeded.
