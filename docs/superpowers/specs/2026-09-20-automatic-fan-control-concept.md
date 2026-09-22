# Automatic Fan Control — Concept

**Date:** 2026-09-20
**Status:** Agreed outline; each sub-project gets its own design spec

This is the umbrella document for automatic ventilation. It fixes the vocabulary,
the decomposition and the domain rules that the individual sub-projects share, so
that each of them can be specified and built without re-deciding the whole.

It is deliberately not an implementation plan. The sub-projects are listed in the
order they are meant to be built, and only the ones already brainstormed carry
detail; the rest record intent so a later round does not start from nothing.

## 1. Purpose

Ventilation is currently a manual act: somebody decides the outside air is
suitable and switches the fan on from the PWA. The decision is a small
calculation on values Grainwatch already holds — outdoor temperature, outdoor
humidity, grain temperature — and it has to be repeated at hours when nobody
wants to look at a phone. Automating it is the point of this work.

Switching on is only half of it. The manual arrangement also fails at switching
off, in two ways that happen every season:

- **The fan is forgotten.** It keeps running after the useful window has closed.
  That is wasted electricity, and once the outside air is no longer better than
  the air in the stock it works against the storage conditions instead of for
  them.
- **The weather turns and nobody is there.** Unexpected rain drives the outdoor
  humidity up within the hour. Somebody has to be on site and awake to notice and
  stop the fans; otherwise damp air is blown into the stock until someone does.

Both are decisions a timer cannot make and a rule on live measurements can. This
is why the automation must be able to switch *off* on its own authority, not only
to start a run somebody else has to end.

## 2. Operating reality that shapes the design

Taken from the root `CLAUDE.md` and sharpened where this work needs more
precision than the summary there gives:

- **Season.** Ventilation matters from August to May, mostly September to
  February.
- **The actuator is permanent, the sensors are not.** The Shelly stays wired for
  years. The thermometers are pulled out when the grain leaves the hall. That is
  not a gap to bridge: with no grain there is nothing to ventilate and nothing
  for the automation to decide.
- **Staff are present when it matters, not around the clock.** Somebody comes
  when there is a reason to. Nobody stands by the fan at three in the morning
  when the weather turns (§1). Conversely, every change to a hall's setup happens
  with a person on site — no fan runs while a hall is being rebuilt.
- **The Shelly switches itself off after exactly one hour** without a keep-alive
  from the backend. `FAN_KEEPALIVE_INTERVAL_MS` (15 minutes by default) is
  validated against that bound at startup. The backend therefore never has to
  chase acknowledgements to leave the plant safe — but note §7: while the
  backend is alive it keeps re-asserting, so the auto-off catches a crash, not a
  forgotten run.

Consequences for automation:

- A missed ventilation window costs almost nothing — the next one comes the
  following night. Blowing damp air into a cold stock costs a great deal. Every
  ambiguous situation therefore resolves to *off*.
- Grain readings disappearing for good is a **normal end state**, not a fault.
  The hall falls to `no_data` and the automation stops the fan and keeps it
  stopped, which is the right outcome for an emptied hall. Nothing needs to
  detect "the thermometers were dismantled" as such.
- Nothing has to be designed for the case "the configuration changes while the
  fan runs unattended". Reconfiguration is a supervised act.

## 3. Vocabulary

| Term | Meaning |
|------|---------|
| Tenant (Mandant) | Owns halls and — later — ventilation profiles. Users belong to it; a hall belongs to exactly one tenant, a user may in principle belong to several. |
| Hall (stock) | An existing `stocks` row. |
| Automation | Per-hall switch. Available only where the hall has fan control, and for the differential mode also grain thermometers. |
| Override (Übersteuerung) | A manual switch command puts automation out of action until the user re-enables it. Persistent across restarts. |
| Profile | A named, tenant-scoped set of automation parameters for one crop. Sub-project D. |

## 4. Decomposition

| # | Sub-project | Content | Status |
|---|-------------|---------|--------|
| A | Tenant | `tenants` table, `users.tenant_id`, `stocks.tenant_id`, visibility rule. Replaces `user_stock_access`. | Specified: `2026-09-20-tenants-design.md` |
| C | Automation core v1 | Temperature difference plus humidity, evaluation cycle, hysteresis, override, reasons in the log. Parameters sit on the hall. | Outlined in §5–§8 below |
| D | Profiles | Named tenant-scoped parameter sets (wheat, barley, rape), assigned to a hall, with a prerequisite check. Lifts C's per-hall parameters into profiles and adds the absolute-temperature trigger for halls without thermometers (§5). | Intent only |
| B | Hall configuration by an admin | Commissioning a hall through an API and a screen instead of SQL. Already in `docs/BACKLOG.md`. | Intent only |
| E | Time-driven ventilation | "every 3 days for 1 h once humidity drops below 65 %", combinable with C. Needs no thermometers. | Intent only |
| F | Manual run with a stop condition | Run for a duration, or until a temperature difference or humidity bound is reached. | Intent only |

Build order: **A → C → D**, then B, E and F as needed.

A comes first because it is small while little depends on it. Retrofitting
tenancy underneath existing profiles would mean migrating ownership. C delivers
the actual benefit and runs at first with parameters held directly on the hall;
D then lifts those parameters into profiles. B is a convenience as long as halls
are commissioned rarely — it moves ahead of D only if arming automation by hand
in SQLite turns out to be unacceptable.

## 5. Control rule (sub-project C)

A pure function, evaluated on a timer. No database, no MQTT:

```
evaluate(readings, parameters, state, now) -> { desiredOn, reason }
```

First matching rule wins:

| # | Condition | Result | `reason` |
|---|-----------|--------|----------|
| 1 | Readings missing or stale | off | `no_data` |
| 2 | Outdoor dew point ≥ **coldest** grain reading − `DEWPOINT_MARGIN_K` | off | `condensation_risk` |
| 3 | Outdoor relative humidity > `max_outdoor_humidity_pct` | off | `humidity_high` |
| 4 | `target_temp_c` set and reached | off | `target_reached` |
| 5 | ΔT < `delta_off_k` | off | `delta_too_small` |
| 6 | ΔT ≥ `delta_on_k` and minimum pause elapsed | on | `delta_ok` |
| 7 | otherwise | hold | `hold` |

with ΔT = grain temperature − outdoor temperature.

Rules 1 to 4 switch off immediately, without waiting for the minimum run time:
safety outranks motor wear. Rule 5 respects the minimum run time.

### Why rule 2 uses the coldest reading and not the mean

The dew point is by definition at most the air temperature it belongs to, with
equality at 100 % relative humidity. So

```
grain − dew point  ≥  grain − outdoor  =  ΔT
```

Against the **mean**, rule 2 would demand `dew point ≥ mean − 2 K`, i.e.
`ΔT ≤ 2 K` — a region the fan never runs in, because it starts at `delta_on_k`
and stops below `delta_off_k`. As long as `delta_off_k ≥ DEWPOINT_MARGIN_K`, the
rule would be unreachable.

Against the **coldest** measurement point it is both reachable and physically
right: water condenses on the coldest surface the air meets, not on an average.
In a stock that is half-cooled, the two differ widely — a bottom layer at 4 °C
under a top layer at 18 °C has a mean of 12 °C. Outdoor air at 10 °C and 90 %
relative humidity carries a dew point of 8.4 °C: harmless against the mean,
condensing on the bottom layer.

The mean stays the control variable for ΔT (rules 5 and 6). Rule 2 uses the
minimum. Offline points are excluded from both.

Rule 3 already catches most of these cases — 90 % is far above any sensible
humidity limit. Rule 2 is the second line of defence for a profile with a
generous limit or a small `delta_on_k`.

### Planned: absolute outdoor temperature instead of a difference (sub-project D)

Rules 5 and 6 compare a difference, which presupposes thermometers in the hall.
A hall without them — or one where they have been pulled out — still has a
usable criterion in the outdoor temperature alone: *switch on below 13 °C,
switch off again at 17 °C*.

So the trigger of rules 5 and 6 becomes one of two kinds, chosen by the profile:

| Kind | On | Off | Requires |
|------|----|-----|----------|
| `differential` | ΔT ≥ `delta_on_k` | ΔT < `delta_off_k` | grain thermometers |
| `absolute` | outdoor temperature ≤ `temp_on_c` | outdoor temperature > `temp_off_c` | outdoor station only |

The hysteresis stays two absolute values in both kinds, and the humidity limit
(rule 3) applies unchanged — it needs no grain reading.

Two things to settle when D is built, recorded here so they are not rediscovered:

- **Rule 2 has no basis without a grain temperature.** The condensation guard
  compares the outdoor dew point against the grain; with no thermometers there
  is nothing to compare against and only the relative-humidity limit remains.
  Either the `absolute` kind accepts that weaker protection, or it gains a
  substitute bound (a dew-point ceiling of its own, say).
- **Rules 1 and 4 narrow accordingly.** Under the `absolute` kind, missing grain
  readings are not `no_data` — they are the expected state — and `target_temp_c`
  refers to nothing. Staleness then only concerns the outdoor station.

This is not part of C. C implements the `differential` kind only, and the
parameter set is shaped so that adding the second kind is an added field rather
than a rewrite.

`DEWPOINT_MARGIN_K = 2` is a constant, not a parameter. It guards against
condensation on grain that is cooler than the incoming air's dew point — a
physical bound, not a preference.

### Grain temperature

Two figures are derived from the same set — every measurement point not flagged
offline, across all three layers:

- the **mean**, which drives ΔT in rules 5 and 6;
- the **minimum**, which rule 2 compares the dew point against.

Making the control variable selectable (mean / warmest point / warmest top-layer
point) is a planned extension, not part of v1. The minimum is not a choice; it
follows from what rule 2 protects.

### Stale data

Rule 1 uses the same staleness window as `GET /latest`
(`INFLUXDB_OFFLINE_AFTER`) and the same skew guard as `buildOutdoorConditions`
(`INFLUXDB_OUTDOOR_MAX_SKEW`). Blind means: stop the fan, do not restart, state
the reason on the card.

## 6. Switching protection (sub-project C)

- Hysteresis as two absolute values, `delta_on_k` and `delta_off_k`, rather than
  a threshold plus a tolerance — less to misread when setting them.
- Minimum run time and minimum pause, per hall.
- Evaluation every 5 minutes (`FAN_AUTOMATION_INTERVAL_MS`, named after the
  existing `FAN_KEEPALIVE_INTERVAL_MS` and `FAN_WATCHDOG_TIMEOUT_MS`).

## 7. Override (sub-project C)

A manual `on` or `off` command suspends automation until the user re-enables it
explicitly. No timeout.

The known risk of that choice is that automation stays off for half a season
after a brief intervention — the same forgetting that §1 gives as a reason for
building this at all, one level up. It is mitigated in the UI, not in the rules:
the suspended state is shown on the hall card in the overview, not only on the
fan screen.

The Shelly's auto-off does **not** catch this case. `FanController` re-publishes
`on` every 15 minutes for as long as `desiredOn` holds, so a manual run started
from the app is kept alive indefinitely; the device's auto-off only ends a run
the backend has stopped re-asserting, i.e. after a crash. A forgotten manual run
with automation suspended is therefore the one situation in which nothing at all
switches the fan off — which is precisely the failure §1 gives as a reason for
this work.

That is an argument for bounding a manual run, not for bounding the override.
Sub-project F (manual run with a stop condition) is where it belongs; until then
the mitigation is the visible hint on the overview.

The suspended flag lives in `fan_state`, so it survives a restart.

## 8. Event log (sub-project C)

`FanController.command()` already records every switch as `command {action}`
with a source. Automation events must not duplicate that. The split:

**`command` records what was switched. An automation event records why it was
decided.**

| `kind` | `source` | Written when | Payload |
|--------|----------|--------------|---------|
| `auto_on` | `auto` | Evaluation decides on, previous state off | `reason`, grain mean, coldest grain reading, outdoor temperature, humidity, dew point, ΔT, `delta_on_k` |
| `auto_off` | `auto` | Evaluation decides off, previous state on | `reason`, the same readings, run duration |
| `automation_suspended` | `user` | Manual command while automation was active | manual action, user id |
| `automation_resumed` | `user` | User lifts the override | user id, suspended duration |
| `automation_configured` | `user` | Automation switched on or off, or parameters changed | before and after values |

`fan_events.source` gains `auto`; without it an automation decision cannot be
told apart from keep-alive and recovery, which are both `backend`.

Deliberately absent: an event for a start that a blocking rule prevented — see
§11.

Retention is unchanged: `fan_events` is swept after `FAN_EVENT_RETENTION_DAYS`
(90 by default). Also §11.

## 9. Architecture (sub-project C)

A separate `AutomationService` beside the `FanControlManager`:

- the rule set is the pure `evaluate` above — testable without MQTT or a database;
- a thin timer service reads the same InfluxDB sources as `GET /latest` and, on a
  change of decision, calls the hall's `FanController` with source `auto`;
- actuation is unchanged. Automation uses the existing keep-alive and watchdog
  path, so there is exactly one way a fan is driven.

The `FanControlManager` already carries wiring, retirement and retention; adding
the rule set to it would make a grown class grow further.

## 10. Planned extensions, deliberately not in v1

- Control variable selectable per profile: mean / warmest point / warmest top
  layer (§5).
- Profiles, tenant-scoped, with prerequisite checks (D).
- Absolute outdoor-temperature trigger as an alternative to the difference, for
  halls without thermometers — on below 13 °C, off at 17 °C (§5, with D).
- Time-driven ventilation (E) and manual runs with a stop condition (F).
- A seasonal switch, so automation need not be turned off by hand every spring.

## 11. Deferred items

To be moved into `docs/BACKLOG.md` when that file is committed. Kept here so
they are not lost in the meantime.

### Automation decisions are swept after 90 days

`fan_events` is kept for `FAN_EVENT_RETENTION_DAYS` and swept wholesale. The
Shelly `status` flood and an `auto_off {reason: 'condensation_risk'}` are
therefore worth the same, although only one of them answers "why was this batch
ventilated the way it was last autumn".

Options: a longer window for the automation kinds, or moving decisions to a
table of their own with its own retention.

Deferred because it is a retention question about the whole event log, not
something the automation core introduces.

### No record of a start a blocking rule prevented

The rule set knows when the temperature difference would have started the fan and
a humidity or condensation rule stopped it. v1 does not write that down: the
reason overlaps with `auto_off`, and the current one is shown live on the card.

If the switching history turns out not to answer "why did nothing run last
night", add an edge-triggered event — written only when `reason` changes between
evaluations, otherwise it is 288 rows per hall per day.
