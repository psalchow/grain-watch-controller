# Automation Core v1 — Design Spec

**Date:** 2026-09-29
**Status:** Approved for planning
**Sub-project:** C of `2026-09-20-automatic-fan-control-concept.md`

Automatic ventilation for a stock: a rule set evaluated on a timer decides
whether the fan should run, and drives the existing fan control. The umbrella
concept fixed the rules (§5), the switching protection (§6), the override (§7),
the events (§8) and the architecture (§9). This spec settles what the concept
left open and records where it deviates from it.

Sub-project A (tenants) is done. C builds on it but needs nothing from it: the
per-stock parameters introduced here become tenant-scoped profiles in D.

## 1. Deviations from the concept

Recorded first, because a reader who knows the concept needs them and a reader
who does not can skip the section.

| Concept | Here | Why |
|---------|------|-----|
| §7: a manual command *suspends* automation; a `suspended` flag in `fan_state` | No suspend state. Automation is simply switched off and has to be switched back on | One flag instead of two. The user re-enables in both cases, so the second state carried no decision |
| §8: `automation_suspended` / `automation_resumed` | `automation_disabled` with a cause; re-enabling is an ordinary `automation_configured` | Follows from the line above |
| §5: rules 1 to **4** switch off without waiting for the minimum run time | Rules 1 to **3** | Reaching the target temperature is an ordinary end, not a safety case. A run that reaches its target two minutes before the minimum run time may finish those two minutes |
| §5 rule 1: "readings missing or stale" | …**or the dew point underivable** | `buildOutdoorConditions` also reports `dewPoint: null` when both readings are present and fresh but more than `INFLUXDB_OUTDOOR_MAX_SKEW` apart. Rule 2 has nothing to compare against in that case, so it is rule 1's business, not rule 2's (§4) |
| §5: `DEWPOINT_MARGIN_K` is a constant, and no target hysteresis is named | `DEWPOINT_MARGIN_K = 2` stays a constant; the target hysteresis is a configurable parameter, default 1 K | The dew-point margin is a physical bound. The target hysteresis is a preference about switching frequency |
| §7: the override is shown on the overview card | The *automation state* is shown on the overview card | Same purpose, adapted to the missing suspend state. The need grew: automation now switches itself off on four occasions, none of which requires anybody to have the fan page open |

Not a deviation but an addition the concept does not mention: local switching at
the contactor now switches the backend's desired state off, and the physically
running fan becomes visible in the app. §6 below gives the reasoning.

## 2. Vocabulary

Beyond the concept's §3:

| Term | Meaning |
|------|---------|
| Stock | A `stocks` row — one grain store. The concept's §3 calls it "hall (stock)"; this spec uses **stock** throughout, because a store is not always a hall. "Halle" stays the local name for it and the word the German UI uses |
| Available (automation) | The stock *can* be automated: it has fan control and grain thermometers. Not a stored flag — derived |
| Enabled (automation) | The user has switched automation on for this stock. `stock_automation.enabled` |
| Decision | One result of `evaluate`: on, off, or hold, with a reason |
| Contactor engaged | The contactor's auxiliary contact is closed, i.e. the fan is actually running — whoever switched it |

## 3. Data model

### 3.1 New table `stock_automation`

One row per stock, created on first configuration. Reads fall back to the
defaults while no row exists, so the migration needs no backfill.

| Column | Type | Default | Bounds |
|--------|------|---------|--------|
| `stock_id` | TEXT, primary key, references `stocks.id` ON DELETE CASCADE | — | — |
| `enabled` | INTEGER (boolean) | 0 | — |
| `delta_on_k` | REAL | 10 | > `delta_off_k`, ≤ 20 |
| `delta_off_k` | REAL | 2 | ≥ 2, < `delta_on_k` |
| `max_outdoor_humidity_pct` | REAL | 80 | 40–100 |
| `target_temp_c` | REAL, nullable | 12 | −10 to 30 |
| `target_hysteresis_k` | REAL | 1 | 0–5 |
| `min_run_minutes` | INTEGER | 30 | 0–240 |
| `min_pause_minutes` | INTEGER | 30 | 5–240 |
| `updated_at` | TEXT | — | — |

The pause starts at 5 rather than 0 for two reasons. Below the evaluation
interval it cannot take effect at all — the next decision is five minutes away
regardless. And it is the only thing bounding a retry loop: `watchdog_off`
deliberately does not disable automation (§5.5) and leaves the desired state
false, so with a broken monitor path the next evaluation commands `on` again,
the watchdog trips again, and the stock writes four event rows per round. At the
default of 30 minutes that is a slow, readable trace of a real problem; at zero
it would be a flood. Bounding the frequency of that loop properly is the backlog
item in §11.

The lower bound on `delta_off_k` is load-bearing, not cosmetic. The concept's
§5 justifies the condensation guard comparing against the *coldest* reading with
the argument that a guard against the mean would be unreachable as long as
`delta_off_k ≥ DEWPOINT_MARGIN_K`. Allowing a smaller value would not make the
guard wrong — it protects the coldest point either way — but it would make that
paragraph false.

A separate table rather than columns on `stocks`, because D lifts exactly this
set into tenant-scoped profiles. Moving a table's contents is cheaper than
unpicking columns from a table that carries unrelated configuration.

### 3.2 No new column on `stocks`

Automation is available where `fanControlAvailable(stock) && has_grain_sensors`
— reusing the existing predicate in `stocks.controller.ts`, not re-deriving it.

That predicate has two halves: the row says fan control is wanted, **and** the
`FanControlManager` actually holds a controller for the stock. The second half is
not redundant. Controllers are built once, in the manager's constructor, from
`selectFanStocks`, which also requires a `fanTopicPrefix`; `reconcile` only ever
retires, never adds. A stock whose flag was set after the process started, one
with the flag but no topic prefix, and one already retired all have no
controller. Dropping that half would let `GET /stocks` report
`automation.available: true` beside `fanControlEnabled: false` for the same stock
in the same payload, and would let the cycle select a stock it cannot drive.

`has_grain_sensors` is a genuine precondition in v1, not a convenience: C
implements the `differential` kind only, so without grain thermometers rule 1
holds permanently and the automation could never switch on. Stocks without
thermometers get automation in D through the absolute outdoor-temperature
trigger (concept §5).

### 3.3 No automation-owned switching timestamps

The minimum run time and the minimum pause are measured against `fan_state`:
`since` for a running fan, `last_command_at` for a stopped one. The automation
stores no timestamps of its own.

This works because neither writer disturbs those values. The keep-alive
publishes and logs but does not call `persistState`, and `recover()` resumes a
run without re-stamping it. They are therefore the real switching times, and
they survive a restart at no extra cost — which is what the requirement
"automation state survives a restart" was about.

The deliberate consequence: **the minimum times belong to the fan, not to the
automation.** If somebody switches off by hand and re-enables automation
straight away, the pause from that manual switch still has to run out. For motor
protection that is the right behaviour — the motor does not care who switched
it. Manual commands themselves are never delayed by a minimum time.

### 3.4 Events

`fan_events.source` gains `auto`. Without it an automation decision cannot be
told apart from keep-alive and recovery, which are both `backend`.

| `kind` | `source` | Written when | Payload |
|--------|----------|--------------|---------|
| `auto_on` | `auto` | Decision *on*, fan was off | `reason`, grain mean, coldest grain reading, outdoor temperature, outdoor humidity, dew point, ΔT, `delta_on_k` |
| `auto_off` | `auto` | Decision *off*, fan was on | the same readings plus the run duration |
| `automation_disabled` | `auto` | Automation switched itself off | `cause`: `manual_command` \| `local_switch` \| `fault` \| `fan_control_withdrawn` |
| `automation_configured` | `user` | User changes `enabled` or a parameter | values before and after |

`command` still records *what* was switched; an automation event records *why*
it was decided. An automation switch therefore writes two rows: the `command`
row from `FanController` with source `auto`, and the `auto_on` / `auto_off` row
from the automation service.

Deliberately absent, as in the concept: no event for a start that a blocking
rule prevented (§11 there, §9 here).

## 4. Control rule

A pure function, no database and no MQTT:

```
evaluate(readings, parameters, state, now) -> { desiredOn: boolean | null, reason }
```

`null` means *hold* — the caller leaves the desired state untouched.

`state` is three values read from `fan_state`: `desiredOn`, `since`,
`last_command_at`.

`readings` carries the **dew point as an explicit `number | null`**, taken from
`buildOutdoorConditions`; `evaluate` never derives it. That is what makes rule 1
able to catch every case in which rule 2 would have nothing to compare against,
and it means a null can only ever mean `no_data`.

First matching rule wins:

| # | Condition | Result | `reason` |
|---|-----------|--------|----------|
| 1 | Outdoor temperature, outdoor humidity **or the derived dew point** missing or stale, **or** not one valid grain reading | off | `no_data` |
| 2 | Outdoor dew point ≥ coldest grain reading − `DEWPOINT_MARGIN_K` | off | `condensation_risk` |
| 3 | Outdoor relative humidity > `max_outdoor_humidity_pct` | off | `humidity_high` |
| 4a | Fan on, grain mean ≤ `target_temp_c` | off | `target_reached` |
| 4b | Fan off, grain mean < `target_temp_c` + `target_hysteresis_k` | hold | `target_reached` |
| 5 | ΔT < `delta_off_k` | off | `delta_too_small` |
| 6 | ΔT ≥ `delta_on_k` | on | `delta_ok` |
| 7 | otherwise | hold | `hold` |

ΔT = grain mean − outdoor temperature. Rules 4a and 4b are skipped when
`target_temp_c` is null.

The target hysteresis sits in the split between 4a and 4b and needs no stored
state: while the fan runs, reaching the target stops it; while it is off,
proximity to the target prevents a restart until the grain is a hysteresis band
above it.

### 4.1 Grain figures

Both derive from the same set of **valid values**:

- the **mean** drives ΔT in rules 5 and 6;
- the **minimum** is what rule 2 compares the dew point against, because water
  condenses on the coldest surface the air meets, not on an average.

A valid value is one `(device, layer)` temperature that is a finite number, on a
device whose `measurementTime` is non-null and no older than
`INFLUXDB_OFFLINE_AFTER`. Counting over values rather than devices, and spelling
the age test out rather than borrowing `offline`, is deliberate: `isOffline`
answers `false` for a null timestamp, so a device that dropped out of the
look-back window altogether reads as *not offline* — the opposite of what this
predicate wants — and a device can report while one of its three layer values is
null.

**One** valid value is enough. The count does not enter any rule: a stock with
four dead probes and one live one is not blind, it is sparsely measured, and the
remaining reading is still the best available evidence.

The outdoor side uses the same window plus the skew guard
(`INFLUXDB_OUTDOOR_MAX_SKEW`), both already applied by `buildOutdoorConditions`.
Note that its three outcomes differ: `offline` covers a stale or half-missing
station, while `derivedUnavailableReason: 'skew'` marks two fresh readings too
far apart to be paired. Rule 1 has to catch both, which is why it tests the dew
point rather than only its inputs.

### 4.2 Minimum times

Applied as a filter over the result, not inside the rules:

- Rules **1 to 3** switch off immediately, unfiltered. Safety outranks motor
  wear.
- Rules **4a** and **5** become *hold* while the fan has been running for less
  than `min_run_minutes`; the reason becomes `min_run_time`.
- Rule **6** becomes *hold* while less than `min_pause_minutes` have passed
  since the last switch-off; the reason becomes `min_pause`.
- A missing timestamp in `fan_state` counts as elapsed.

### 4.3 The reasons

`no_data`, `condensation_risk`, `humidity_high`, `target_reached`,
`delta_too_small`, `delta_ok`, `min_run_time`, `min_pause`, `hold`.

German wording for the fan page:

| `reason` | Text |
|---|---|
| `no_data` | Keine verwertbaren Messwerte |
| `condensation_risk` | Kondensationsgefahr am kältesten Messpunkt |
| `humidity_high` | Außenluft zu feucht |
| `target_reached` | Zieltemperatur erreicht |
| `delta_too_small` | Temperaturunterschied zu gering |
| `delta_ok` | Außenluft kühlt |
| `min_run_time` | Mindestlaufzeit läuft noch |
| `min_pause` | Mindestpause läuft noch |
| `hold` | Keine Änderung nötig |

## 5. Architecture

A separate `AutomationService` beside the `FanControlManager`, in a new
`backend/src/services/automation/`: the pure rule set, a timer service, types.
The manager already carries wiring, retirement and retention; adding the rule
set would make a grown class grow further.

### 5.1 Extracting the reading preparation

`isOffline`, `offlineAfterMs`, `outdoorMaxSkewMs` and `buildOutdoorConditions`
are module functions inside `stocks.controller.ts` today. They move into a
module of their own, which both the controller and the automation import. A
function deriving the grain mean, the grain minimum and the count of valid
points from `DeviceReading[]` joins them there — only the automation needs it,
but it belongs beside the rest of the preparation rather than inside the
service.

### 5.2 The cycle

`FAN_AUTOMATION_INTERVAL_MS`, default 300000, with a lower bound in
`validateConfig` as `FAN_RECONCILE_INTERVAL_MS` has. One evaluation immediately
at startup, then on the interval.

A single stock is also evaluated immediately when the `PUT` of §7 switches its
automation from off to on, reusing the same path. Without it the automation is
*enabled but undecided* for up to five minutes: a fan still running from a
manual switch keeps running although the rules would stop it, and the user who
just turned automation on gets no answer to the only question they have — will
it run. The stale `reason` and `evaluatedAt` that an open page would otherwise
show for those five minutes are a side benefit, not the reason.

Per tick, for every stock where automation is available and enabled: the same two
queries as `GET /latest` (`getLatestReadings`, `getOutdoorReading`), then
`evaluate`, then act. Stocks are processed one after another with errors confined
to the stock — a silent stock must not hold up the others.

A stock whose `getController` returns `null` is skipped for that tick, without an
event and without a read. §3.2 makes that rare, but the two are read at
different moments: a stock can be retired between the availability check and the
decision, and the cycle must not assume a controller it did not just obtain.

### 5.3 Read failures

A counter per stock. Three consecutive failures (≈15 minutes) are treated as
no data, i.e. rule 1, i.e. off. A successful tick resets the counter.

`FanControlManager.reconcile` skips a failed tick and keeps its wiring, and the
next tick retries. The automation cannot copy that unchanged: with InfluxDB
silent for hours the keep-alive would hold the fan on indefinitely, which is the
failure §1 of the concept gives as a reason for this work. Three ticks of
tolerance absorb an ordinary blip without leaving the plant running blind.

### 5.4 Acting on a decision

Only on a change — and the change is measured against
`controller.getStatus().desiredOn`, not against a remembered decision. That
costs nothing and makes a restart correct in passing: the automation never has
to persist its last decision, and any divergence (a crash between command and
persist, say) is resolved by the immediate first evaluation.

On a difference: `command(action, 'auto')` on the stock's `FanController`, plus
the `auto_on` or `auto_off` event. On *hold* or agreement: nothing.

**`enabled` is re-read from the repository immediately before acting**, and a
false value skips the action. The same argument as the controller check in §5.2,
and the same shape: two awaited InfluxDB queries sit between the selection and
the action, Express handlers share the event loop, so a manual command can land
in that window. Without the re-read the tick would resume with a decision
computed while automation was still enabled and command the fan against the user
who just took it over — the override of concept §7 losing to a decision that
predates it, a second after the button was pressed. A retired controller is
`null` and is caught anyway; disabled automation is not.

Actuation is otherwise unchanged. Automation uses the existing keep-alive and
watchdog path, so there is exactly one way a fan is driven.

### 5.5 The four ways automation switches itself off

| Cause | Trigger | Wiring |
|---|---|---|
| `manual_command` | `POST …/fan/command` | The HTTP controller calls the automation service |
| `local_switch` | `warning` from the Shelly | A new optional callback on `FanController`, set by the manager |
| `fault` | `alert` and `safety_shutoff` — **not** `watchdog_off` | the same callback |
| `fan_control_withdrawn` | `retireController` | The manager calls the automation service |

**The self-disable is a transition, not an action.** When `enabled` is already
false it does nothing: no flag write, no event. Otherwise one incident writes
several identical rows, because these triggers arrive in bursts — a failing
contactor publishes `alert` and, when the failed command was an `on`,
`safety_shutoff` immediately after, and both reach `enterFault`. Somebody
working at the contactor on site produces a `warning` per edge.

A callback rather than an `onChange` subscription: a `FanStatus` snapshot cannot
distinguish a manual command from an automation switch, and detecting a fresh
`lastWarning` by a changed timestamp would be an inference that breaks silently
at the next refactor.

Dependencies stay one-way. The automation service is constructed with a
`getController` function; the `FanControlManager` is constructed with an
anonymous callback. `bootstrap.ts` connects them; neither knows the other's
type.

**Why `watchdog_off` is excluded, and `warning` is not.** `enterFault` is
reached three ways. `alert` and `safety_shutoff` are statements by the device
about the plant — the contactor did not follow. `watchdog_off` is a statement
about our own delivery: monitor messages are published at QoS 0 without retain
(fan-control spec §2), so a single lost packet reaches it. The fan is stopped
either way, but disabling automation on a lost packet would leave a stock
unventilated for the rest of the season with nobody necessarily noticing.
Counting repeated watchdog trips is a backlog item, not v1.

A `warning` is neither of those, and it is worth being explicit about why it
disables automation on the first occurrence although the false-positive cost is
the same. The asymmetry is in what the two say about the plant, not in how
trustworthy they are:

- After `watchdog_off` the fan is *off* and the backend's picture is intact. The
  next evaluation can simply try again; nothing unsafe persists in the meantime.
- After a `warning` the auxiliary contact has moved without a command, so the
  backend's picture is already wrong — and if it moved to *engaged*, the fan is
  running on a contactor the backend cannot open (§6). Automation would be
  claiming a control authority it does not have.

A spurious warning — a bouncing contact, a brief drop-out — therefore costs an
unnecessary switch-off and a re-enable by hand, which is the safe direction of
being wrong. A spurious `watchdog_off` would cost the season. We have no
evidence either way about how often the contact chatters on this hardware; if it
turns out to, the same counting approach applies and the backlog item covers
both.

### 5.6 Changes to `FanController`

This is where C reaches into the fan control proper.

- New overlay `contactorEngaged: boolean | null`, fed from the `inputState` of
  every monitor message, exposed in `FanStatus`.
- A `warning` now also switches off: desired state false, `since` cleared,
  keep-alive and watchdog cleared, one `off` published, the state persisted, the
  `command` row written with source `shelly`, and the listeners notified.
- The `source` unions gain `auto`; the switch-off path additionally gains
  `shelly` for the case above.
- **An `off` while the desired state is already false does not enter a pending
  state.** It publishes, it persists, it logs — but the acknowledgement it would
  wait for cannot arrive, because the Shelly's output does not move.

The rule is *never enter a pending state you cannot leave*; **what is reported
instead is the caller's business.** A user's `off` on an already-off fan leaves
the reported state as it stands. The warning path sets it from `inputState`, as
the paragraph below describes — it has better information than "unchanged", and
in the local-switch-on case the two answers differ: the desired state is already
false when the `warning` arrives, so a shared helper that merely left the state
alone would report `OFF`, and the card would read "Aus" for a running fan.

**The warning path must not reuse `beginTurnOff` unchanged.** `beginTurnOff`
enters `TURN_OFF_PENDING`, and the only exit from that state is a `success`
message. In the case §6 describes — local switch-on while the backend is off —
our `off` does not change the Shelly's output, so no status event, no grace
timer and no acknowledgement follow, and the state machine would sit in
`TURN_OFF_PENDING` indefinitely. `FanControlPage` treats both pending states as
busy and renders a disabled "Wird quittiert…" spinner, so the person standing at
the fan would have no button at all — and no way to re-enable the automation
§5.5 just switched off. The stock stays unventilated until somebody restarts the
backend.

The warning path therefore reports the state the device just told us about
instead of a pending one: `ON` when `inputState` is true, `OFF` when it is
false. That is terminal, it is what is physically the case, and combined with
`desiredOn: false` and `contactorEngaged` the app can say both things at once —
the fan runs, and the backend is not the one driving it. The alternative,
defining what resolves `TURN_OFF_PENDING` when no acknowledgement can arrive, is
more work and buys less.

That terminal `ON` reaches a page which today picks its button from `state`
alone, so it would offer "Ausschalten" — one press, `beginTurnOff`, and the
stuck spinner is back, for the same person at the same fan. The bullet above
closes it in the state machine; §8 closes it in the page, which must not offer
the button at all here. Both are wanted: the state machine should not enter a
state it cannot leave whoever asked, and the page should not promise an action
the backend has no authority over (§6).

## 6. Local switching at the contactor

Switching by hand on site drives the contactor directly and bypasses the
Shelly's relay. The Shelly notices only through its input, which carries the
contactor's auxiliary contact (fan-control spec §2: the input is detached).

Three consequences, all of them decided here:

**The backend cannot switch that run off.** Its `off` only releases the Shelly's
own relay; the hand switch keeps holding the contactor. Nor does the Shelly's
one-hour auto-off end it, because the Shelly's output is not what is carrying
the load. This is the reason automation must be *disabled* in this situation
rather than merely pausing: it could not enforce its own safety rules, so it
must not claim to.

**No `alert` follows.** Read from the monitoring script:

- *Local on while the backend is off:* the input changes to `true` while
  `desiredInputState` is `false` → `warning`. Our subsequent `off` does not
  change the switch output (already off), so no switch status event, no grace
  timer, no alert. When the person later switches off on site, the input returns
  to `false`, which equals `desiredInputState` → `success`, which also clears
  the `lastWarning` overlay.
- *Local off while the backend is on:* `warning`, then our `off` changes the
  output from `true` to `false`, the grace timer fires after 3 s, finds the
  input already `false` as desired → `success`.

So no new `FanState` is needed — provided the warning path reports a terminal
state rather than a pending one (§5.6).

**`inputState` is trustworthy in every message; `switchState` is not.**
`sendSuccess` sets `inputState` equal to its `switchState` argument, which reads
like an echo, but both call sites pass a value that has just been established to
equal the real input: the input-event path passes the new input, the grace-timer
path passes `Input.GetStatus`. `sendAlert` passes the measured input directly,
and `sendSafetyShutoff` hard-codes `false`, which is the only state that
situation can have. Feeding `contactorEngaged` from every monitor message is
therefore sound.

`switchState` is the field to distrust: in a `warning` and in an `alert` it
carries `desiredInputState`, the last commanded output, not the relay's actual
state. Nothing in this design reads it; the doc comment on `contactorEngaged`
should say why the neighbouring field is not the one to use.

## 7. API

Both endpoints under `authenticate` + `requireStockAccess`, answering 404 where
the stock cannot have automation — the same shape the fan stream uses.

- `GET /api/v1/stocks/:stockId/fan/automation` — `enabled` and the seven
  parameters; the defaults where no row exists yet. Fills the form.
- `PUT /api/v1/stocks/:stockId/fan/automation` — `enabled` and the parameters in
  one call, validated with Zod against §3.1 plus the two cross-field conditions
  (`delta_off_k < delta_on_k`, `delta_off_k ≥ 2`). Writes `automation_configured`
  with before and after values and returns the stored state.

One endpoint for the switch and the parameters, because the form submits both
together and re-enabling after a self-disable is then the same call.

No role check beyond stock access, matching the switch command right next to it.
That the `viewer` role can write is a known, recorded contradiction; the backlog
carries the fix (renaming it to `operator`), which then resolves every case at
once rather than this one separately.

### 7.1 SSE

The fan page's snapshot gains `contactorEngaged` and a slim `automation` object:
`available`, `enabled`, `reason`, `evaluatedAt`. No parameters — the form
fetches those.

`FanController.onChange` only fires on fan state changes. A changing reason
without a switch (`hold` → `humidity_high`, the most common case there is) would
produce no push and leave a stale reason on the card. The automation service
therefore has an `onChange` of its own; the SSE handler subscribes to both and
sends the composed snapshot.

The `PUT` handler fires it after writing when `enabled` goes **to false**.
Otherwise switching automation off reaches no open stream at all: a disabled
stock is never evaluated (§5.2), so the evaluations that would carry the news
stop with the same call. The four self-disable causes are covered without it —
three of them move the `FanController` as well, and a withdrawal tears the
stream down — but a second browser on the fan page would sit on "Automatik
aktiv" indefinitely.

Switching **on** needs no explicit emit: §5.2 evaluates the stock right away,
and that evaluation pushes on its own.

It fires after **every** evaluation, not only on a changed reason. `evaluatedAt`
is the field that makes the difference: a stock ventilating normally sits on one
reason for hours, and a page showing "letzte Auswertung vor drei Stunden" tells
the user the automation has died — on the screen whose job is to say it is
alive. One message per open stream per five minutes is not a cost worth
optimising against that.

### 7.2 Stock list

`GET /api/v1/stocks` gains `automation: { available, enabled }` per stock — one
additional query over the automation table for the whole list, no SSE.

## 8. Frontend

- `FanControlPage.tsx`: an automation section with the switch, the current
  reason in plain German, the time of the last evaluation, and the parameter
  form. The four new event kinds join `EVENT_LABEL`.
- New `FanAutomationPanel.tsx`, so `FanControlPage` does not grow further:
  number fields, a save button, field errors from the Zod response.
- `FanStatusCard.tsx`: shows `contactorEngaged`. The case that matters is
  `contactorEngaged && !desiredOn` — "Gebläse läuft, vor Ort geschaltet".
  Without it a locally running fan is invisible in the app.
- `FanControlPage.renderButton` selects on `desiredOn` and `contactorEngaged`,
  not on `state`. Order: pending → the spinner as now; `contactorEngaged &&
  !desiredOn` → the local-run notice and **no** switch-off button, because the
  backend cannot open a contactor held by hand (§6); `FAULT` → "Erneut
  einschalten"; `desiredOn` → "Ausschalten"; otherwise "Einschalten". Keying on
  `state === 'ON'` as it does today would offer a switch-off for the local run
  (§5.6).
- `StockCard.tsx`: an automation marker beside the existing fan glyph.
- `frontend/src/api/fan.ts`: the two new calls.

## 9. Verification

The pure `evaluate` carries the main load: a table per rule, the boundaries
(ΔT exactly at `delta_on_k`, dew point exactly at grain minimum −
`DEWPOINT_MARGIN_K`), the minimum-time filter, and both halves of the target
hysteresis. Two cases deserve naming because they are the ones a literal reading
of the rule table gets wrong: a null dew point with fresh temperature and
humidity must yield `no_data` and never reach rule 2, and a stock whose devices
all report a null `measurementTime` must yield `no_data` rather than counting as
measured.

The service is tested against a fake controller, a fake reading source and a
supplied clock: a change switches, a hold does not, three read failures switch
off, the fourth failure does not switch again, a missing controller skips the
stock, automation disabled *during* the read performs no command, enabling a
stock evaluates it without waiting for the interval, and a second disable
trigger writes no second event.

New on `FanController`: `warning` switches off, reports, and leaves a
**terminal** state (`ON` or `OFF`, never `TURN_OFF_PENDING`); an `off` with the
desired state already false does not enter a pending state either; `alert` and
`safety_shutoff` report; `watchdog_off` does **not** report; `contactorEngaged`
follows `inputState`.

In the frontend, the local run is the case to pin down: `contactorEngaged &&
!desiredOn` shows the notice and offers no switch-off, and the ordinary states
keep the buttons they have today.

Plus migration, repository, both endpoints including field bounds and the 404,
and in the frontend the panel, the reason display, the card marker and the local
run.

Command: `npm run test`, `npm run lint`, `npm run typecheck` from the root.

### 9.1 The simulator has to be corrected first

`sim/shelly-emulator/src/shelly.ts` calls itself a faithful reproduction of
`switch-monitoring.mjs` and emits `warning` with a real `inputState`, but it
does not implement the semantics §6 depends on. Three divergences, all in the
local-switching path and all making the tests agree with the emulator rather
than with the field:

- `setSwitch` arms the grace timer unconditionally. The script arms it from a
  *status change* handler, i.e. only when the output actually moves. So our `off`
  while the output is already off evaluates the grace, finds the input still
  held by hand, and publishes an `alert` — the message §6 establishes does not
  follow. The cause recorded would be `fault` instead of `local_switch`.
- `setSwitch` re-arms the contactor-follow timer, which writes `inputState = on`
  after the contactor delay. In the field the hand switch keeps holding the
  contactor; in the emulator our `off` releases it. **The correction is not to
  drop the re-arm** — that timer is how the emulator models the contactor
  following any command, so removing it would leave the input stuck at `true`
  on every ordinary switch-off, fail the grace check and publish a spurious
  `alert`, breaking the existing fan-control tests. What is missing is state the
  emulator does not have: whether the contactor is currently held locally. A
  flag set and cleared by `manualContactorToggle` and consulted by `setSwitch`
  before arming the follow timer is the smallest thing that separates the two
  cases.
- `manualContactorToggle` always publishes a `warning`. The script compares
  against `desiredInputState` first and publishes `success` when the input
  arrives at the state that was commanded.

The device script is authoritative. Correcting the emulator is part of this
work, not a follow-up: without it the local-switching behaviour C introduces
cannot be exercised at all, and the emulator would actively assert the opposite
of §6.

## 10. Also to be changed

- `docs/specs/API.md`: two endpoints, two new status fields, the field in
  `GET /stocks`.
- `backend/.env.example`: `FAN_AUTOMATION_INTERVAL_MS`.
- `sim/shelly-emulator/src/shelly.ts`: the three corrections in §9.1.

The concept document stays as it is — it records the state of 20 September, and
§1 above carries the deviations.

## 11. Out of scope, into the backlog

- A counter for repeated `watchdog_off`, should delivery failures turn out to
  occur in practice (§5.5).
- The cause of the last self-disable on the overview card. It needs the cause
  stored and translated; the stock's event list already carries it in full.
- An edge-triggered event for a start a blocking rule prevented, and a longer
  retention for automation decisions — both already in §11 of the concept, now
  moving into `docs/BACKLOG.md`.
- A seasonal switch, a selectable control variable, the absolute trigger,
  profiles — §10 of the concept; D and later.
- The existing entry "The `viewer` role already writes" grows by the two
  automation endpoints.
- New: a contactor engaged by hand cannot be opened by the backend. No software
  fixes that; it is worth writing down because it bounds the reach of every
  safety rule.
- New: `FanControlManager.reconcile` only retires, never adds, so enabling fan
  control for a stock still needs a restart — and with it automation for that
  stock. §3.2 works around it rather than fixing it.

Deliberately untouched although nearby: `retireController`, the role checks,
live updates on the overview, a second trigger kind, profiles.
