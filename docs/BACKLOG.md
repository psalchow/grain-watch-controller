# Backlog

Work that is known, deliberate and deferred. See the scope rules in the root
`CLAUDE.md`: anything a task merely walks past lands here instead of growing the
task.

Each entry states what it is, why it was deferred, and where the code sits, so
it can be picked up without rediscovering the context. Remove an entry when it
is done; keep the list short enough to be read before every feature.

---

## Stock configuration cannot be edited without SQL

**Deferred:** 2026-09-18 — explicitly postponed while removing `deviceCount`.

Stocks are seeded (`backend/src/db/seed.ts`) and `StockRepository.upsertMany`
uses `onConflictDoNothing`, so an existing row never changes. There are no admin
endpoints for stocks, only for users. Setting `has_grain_sensors`,
`fan_control_enabled` or `fan_topic_prefix` therefore means editing the SQLite
file on the NAS by hand, as documented in `docs/specs/API.md`.

Worth doing when stock configuration changes more than once a season: an admin
API plus a screen, or at minimum a seed that upserts declared fields.

## `device_prefix` has no reader

**Deferred:** 2026-09-18 — kept deliberately when `device_count` was dropped.

Device rosters now come from the measurements themselves, so
`stocks.device_prefix` is written and never read (`backend/src/db/schema.ts`
carries a comment saying so). It documents the naming convention (`1` → `1.1`…).

Drop it in its own migration if a future reader does not appear — note that
migration 0004 already made rollback a database-restore operation, so a second
column drop costs little extra.

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
a missing partner as offline when it was expected.

## Changing a user's tenancy does not close an open SSE stream

**Deferred:** 2026-09-23 — pre-existing, restated in tenant terms because the
previous entry named `user_stock_access`, a table this change drops.

`requireStockAccess` runs once when the fan stream connects. Moving a hall to
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

## Per-hall grants inside a tenant are gone

**Deferred:** 2026-09-23 — accepted alongside the tenants migration
(migration 0005), which widens access for anyone who held a partial hall grant.

Tenant membership is all-or-nothing: a user reaches every hall of their
tenant, and the finer per-hall grant that `user_stock_access` used to offer has
no equivalent. Reinstating it means a filter *inside* a tenant, not a return to
the dropped table.

## A wrong `stocks.tenant_id` disappears silently

**Deferred:** 2026-09-23 — accepted; `stocks.tenant_id` carries no foreign key
(SQLite refuses `ADD COLUMN` with both `REFERENCES` and a non-null default),
and hall-to-tenant assignment is manual SQL until a hall configuration screen
exists.

A typo in `tenant_id` is therefore the expected way this goes wrong: the hall
simply drops out of its intended tenant's `GET /stocks`, while an administrator
— who bypasses the tenant filter by role — still sees it, so the account most
likely to investigate sees nothing wrong.

`initFanControl` already reads every stock at startup. Warning there about a
`tenant_id` with no matching `tenants` row would turn a silent disappearance
into a log line, for a few lines of code.

## The offline flag trusts the device clock

**Deferred:** 2026-09-18 — decided to leave as is; documented in
`docs/specs/API.md`.

Stock readings are flagged offline by comparing `measurementTimeS`, reported by
the device, while the look-back window filters on InfluxDB's ingest time. A
skewed device clock shifts the flag in either direction, and a reading with no
timestamp is never flagged.

Fixing it means obtaining a per-device ingest timestamp, which InfluxQL does not
return alongside a multi-field `LAST()` — it would need a second query.

## Warn about a running fan when fan control is withdrawn

**Deferred:** 2026-09-19 — belongs to the planned stock configuration UI.

Withdrawing fan control sends one best-effort `off` and forgets the stock; the
Shelly's own auto-off covers the rest. Once halls are configured through a
screen rather than SQL, that screen is the right place to say "switch the
ventilation off by hand" — and to send the final `off` while the operator is
watching.

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
hall that spent its refresh carries the count into the next hall, where a single
401 then lands in the give-up branch directly.

Closing it: abort on the second 401, as the 404 and 403 branches do, surface it,
and reset the ref at the top of the effect body.

## A stray 404 latches the fan page into "no fan control"

**Deferred:** 2026-09-20 — needs a 404 from something other than the fan
endpoint, which a single proxy in front of one backend rarely produces.

`useFanStream` treats any 404 on the stream URL as fan control having been
withdrawn: it latches `disabled` and stops reconnecting. A proxy with no
matching upstream, or a changed API base path after a deploy, reads the same.
Re-enabling fan control (which needs a backend restart anyway) also leaves a
latched client showing the notice until the page is reloaded.

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

## Retirement never unsubscribes the stock's MQTT topics

**Deferred:** 2026-09-19 — costs broker traffic, not correctness.

`FanControlManager.init` subscribes to `<prefix>/monitor/#`, `<prefix>/status/#`
and `<prefix>/online` per stock; retiring a stock deletes the wiring but never
unsubscribes, and `MqttClientLike` has no `unsubscribe` at all. The broker keeps
delivering that prefix's traffic for the life of the process, and `route()`
drops it silently.

Adding `unsubscribe` to `MqttClientLike` and calling it in `retireController`
would close it.

## Clear-then-re-enable inside one tick retires the controller anyway

**Deferred:** 2026-09-19 — needs a mistaken edit corrected within 60 s, which
the operating reality makes unlikely.

`reconcile` retires on `!enabled.has(stockId) || wiring.retiring`. If a request
marked the stock while the row was briefly cleared, the next tick retires it
even though the fresh read says the stock is enabled again. Rebuilding the
controller then needs a restart.

Closing it: retire only on `!enabled.has(stockId)`, and clear the mark when the
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

## No in-app prompt when a new bundle is available

**Deferred:** 2026-09-17 — the update banner was reverted in `b68be57`.

The service worker updates itself (`registerType: 'autoUpdate'`), but until it
takes control a cached bundle can render fields the new backend no longer sends.
The `deviceCount` removal is the current example, noted in
`docs/DEPLOYMENT.md`.
