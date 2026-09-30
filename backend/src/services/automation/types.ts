/**
 * Types for the automation rule set (docs/superpowers/specs/2026-09-29-fan-automation-core-design.md §4).
 *
 * `AutomationConfig` is deliberately not redeclared here — it already exists
 * in `../../db/schema.ts` and carries exactly the parameters `evaluate` needs.
 */
export type { AutomationConfig } from '../../db/schema';

/** Why `evaluate` decided what it decided (design spec §4.3). */
export type AutomationReason =
  | 'no_data'
  | 'condensation_risk'
  | 'humidity_high'
  | 'target_reached'
  | 'delta_too_small'
  | 'delta_ok'
  | 'min_run_time'
  | 'min_pause'
  | 'hold';

/**
 * The readings `evaluate` decides on. The dew point is carried as an explicit
 * `number | null`, already derived by `buildOutdoorConditions` — `evaluate`
 * never derives it itself, so a null here can only ever mean "no usable dew
 * point", whatever the reason (missing input, staleness, or two readings too
 * far apart in time to pair).
 */
export interface AutomationReadings {
  outdoorTempC: number | null;
  outdoorHumidityPct: number | null;
  dewPointC: number | null;
  outdoorOffline: boolean;
  grainMeanC: number | null;
  grainMinC: number | null;
}

/**
 * The three values read from `fan_state` that the minimum-time filter needs
 * (design spec §3.3, §4.2): whether the fan is currently desired on, since
 * when it has been running, and when it was last commanded (i.e. when it was
 * last switched off).
 */
export interface FanTimingState {
  desiredOn: boolean;
  since: string | null;
  lastCommandAt: string | null;
}

/** One result of `evaluate`. `desiredOn: null` means hold — leave it as is. */
export interface Decision {
  desiredOn: boolean | null;
  reason: AutomationReason;
}

/**
 * The physical bound rule 2 guards against: dew point condenses on the
 * coldest grain reading once it comes within this many kelvin of it. A
 * constant, not a parameter — unlike the target hysteresis, it is not a
 * preference about switching frequency (design spec §1).
 */
export const DEWPOINT_MARGIN_K = 2;
