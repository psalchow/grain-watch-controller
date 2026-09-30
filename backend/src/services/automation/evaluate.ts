import {
  DEWPOINT_MARGIN_K,
  type AutomationConfig,
  type AutomationReadings,
  type Decision,
  type FanTimingState,
} from './types';

/**
 * Minutes elapsed since `timestamp`, or `Infinity` when it is null — a
 * missing timestamp counts as elapsed (design spec §4.2), so a filter never
 * blocks on it.
 */
function elapsedMinutes(timestamp: string | null, now: Date): number {
  if (timestamp === null) return Number.POSITIVE_INFINITY;
  return (now.getTime() - new Date(timestamp).getTime()) / 60_000;
}

/** Rules 4a and 5 become hold while the fan has run for less than the minimum. */
function withMinRunFilter(
  decision: Decision,
  state: FanTimingState,
  minRunMinutes: number,
  now: Date,
): Decision {
  if (elapsedMinutes(state.since, now) < minRunMinutes) {
    return { desiredOn: null, reason: 'min_run_time' };
  }
  return decision;
}

/**
 * Rule 6 becomes hold while less than the minimum has passed since the last
 * switch-off.
 *
 * Only while the fan is off. `fan_state.last_command_at` is stamped by every
 * command, the switch-on included, so on a running fan it measures the time
 * since this run *started* — the pause is defined against the last switch-off
 * (design spec §3.3, §4.2). Applying it there would cost no actuation (hold
 * and on coincide for a fan already running) but would report `min_pause`, and
 * the page would say "Mindestpause läuft noch" beneath a card saying the fan
 * is running.
 */
function withMinPauseFilter(
  decision: Decision,
  state: FanTimingState,
  minPauseMinutes: number,
  now: Date,
): Decision {
  if (state.desiredOn) return decision;
  if (elapsedMinutes(state.lastCommandAt, now) < minPauseMinutes) {
    return { desiredOn: null, reason: 'min_pause' };
  }
  return decision;
}

/**
 * The automation's control rule (design spec §4): a pure function, no
 * database and no MQTT. First matching rule wins; the minimum-time filter of
 * §4.2 is applied over the result, not inside the rules.
 */
export function evaluate(
  readings: AutomationReadings,
  parameters: AutomationConfig,
  state: FanTimingState,
  now: Date,
): Decision {
  // Rule 1: missing or stale readings, or the dew point underivable, or no
  // valid grain reading at all. Branch on null before any comparison — a
  // null dew point (or grain figure) must never reach a relational
  // comparison, where it would silently coerce to 0.
  if (
    readings.outdoorTempC === null ||
    readings.outdoorHumidityPct === null ||
    readings.dewPointC === null ||
    readings.outdoorOffline ||
    readings.grainMeanC === null ||
    readings.grainMinC === null
  ) {
    return { desiredOn: false, reason: 'no_data' };
  }

  // Rule 2: condensation risk at the coldest grain reading.
  if (readings.dewPointC >= readings.grainMinC - DEWPOINT_MARGIN_K) {
    return { desiredOn: false, reason: 'condensation_risk' };
  }

  // Rule 3: outdoor air too humid to bring in.
  if (readings.outdoorHumidityPct > parameters.maxOutdoorHumidityPct) {
    return { desiredOn: false, reason: 'humidity_high' };
  }

  // Rule 4: target temperature, skipped entirely when none is configured.
  if (parameters.targetTempC !== null) {
    if (state.desiredOn && readings.grainMeanC <= parameters.targetTempC) {
      return withMinRunFilter(
        { desiredOn: false, reason: 'target_reached' },
        state,
        parameters.minRunMinutes,
        now,
      );
    }
    if (
      !state.desiredOn &&
      readings.grainMeanC < parameters.targetTempC + parameters.targetHysteresisK
    ) {
      return { desiredOn: null, reason: 'target_reached' };
    }
  }

  const deltaT = readings.grainMeanC - readings.outdoorTempC;

  // Rule 5: too little difference to be worth running.
  if (deltaT < parameters.deltaOffK) {
    return withMinRunFilter(
      { desiredOn: false, reason: 'delta_too_small' },
      state,
      parameters.minRunMinutes,
      now,
    );
  }

  // Rule 6: enough difference to be worth switching on.
  if (deltaT >= parameters.deltaOnK) {
    return withMinPauseFilter(
      { desiredOn: true, reason: 'delta_ok' },
      state,
      parameters.minPauseMinutes,
      now,
    );
  }

  // Rule 7: between the two bounds — leave it as it is.
  return { desiredOn: null, reason: 'hold' };
}
