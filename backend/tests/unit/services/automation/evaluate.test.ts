import { evaluate } from '../../../../src/services/automation/evaluate';
import { DEWPOINT_MARGIN_K } from '../../../../src/services/automation/types';
import type {
  AutomationReadings,
  FanTimingState,
} from '../../../../src/services/automation/types';
import type { AutomationConfig } from '../../../../src/db/schema';

const NOW = new Date('2026-09-30T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

// A configuration and reading set constructed so that, on their own, nothing
// but rule 7 ("hold") applies: no missing data, dew point far below any
// condensation risk, humidity well under the limit, target rule skipped
// (targetTempC null), and ΔT sitting strictly between deltaOffK and
// deltaOnK. Every test below overrides only the fields its rule needs.
function baseParameters(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    enabled: true,
    deltaOnK: 10,
    deltaOffK: 2,
    maxOutdoorHumidityPct: 80,
    targetTempC: null,
    targetHysteresisK: 1,
    minRunMinutes: 30,
    minPauseMinutes: 30,
    ...overrides,
  };
}

function baseReadings(overrides: Partial<AutomationReadings> = {}): AutomationReadings {
  return {
    outdoorTempC: 5,
    outdoorHumidityPct: 50,
    dewPointC: -5,
    outdoorOffline: false,
    grainMeanC: 10, // ΔT = 10 - 5 = 5, strictly between deltaOffK(2) and deltaOnK(10)
    grainMinC: 9,
    ...overrides,
  };
}

function baseState(overrides: Partial<FanTimingState> = {}): FanTimingState {
  return {
    desiredOn: false,
    since: null,
    lastCommandAt: null,
    ...overrides,
  };
}

describe('evaluate — rule 1: no_data', () => {
  it('yields no_data when the outdoor temperature is missing', () => {
    const result = evaluate(
      baseReadings({ outdoorTempC: null }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('yields no_data when the outdoor humidity is missing', () => {
    const result = evaluate(
      baseReadings({ outdoorHumidityPct: null }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('yields no_data when the outdoor conditions are offline', () => {
    const result = evaluate(
      baseReadings({ outdoorOffline: true }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('yields no_data when there is no valid grain mean', () => {
    // grainMinC stays present (9, from baseReadings) so this isolates the
    // grainMeanC guard: a mutant that dropped it would fall through to the
    // delta rules with `null - outdoorTempC` coercing to a number.
    const result = evaluate(
      baseReadings({ grainMeanC: null }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('yields no_data when there is no valid grain minimum', () => {
    // Defensive: summariseGrain never actually produces mean and min
    // independently null, but the type allows it and rule 1 must catch it.
    const result = evaluate(
      baseReadings({ grainMinC: null }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('yields no_data when the dew point is null despite fresh outdoor temperature and humidity (Traps 3 and 4)', () => {
    // Both inputs present and outdoorOffline is false (i.e. fresh), but the
    // dew point could not be derived (e.g. the two readings were too far
    // apart in time). An unguarded comparison against a null dew point would
    // coerce to 0 and silently fall through to rule 2.
    const result = evaluate(
      baseReadings({ dewPointC: null }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });
});

describe('evaluate — rule 2: condensation_risk', () => {
  it('switches off when the dew point is exactly at grainMinC - DEWPOINT_MARGIN_K', () => {
    const grainMinC = 9;
    const result = evaluate(
      baseReadings({ grainMinC, dewPointC: grainMinC - DEWPOINT_MARGIN_K }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'condensation_risk' });
  });

  it('does not fire one tenth below the threshold', () => {
    const grainMinC = 9;
    const result = evaluate(
      baseReadings({ grainMinC, dewPointC: grainMinC - DEWPOINT_MARGIN_K - 0.1 }),
      baseParameters(),
      baseState(),
      NOW,
    );
    expect(result.reason).not.toBe('condensation_risk');
    expect(result).toEqual({ desiredOn: null, reason: 'hold' });
  });
});

describe('evaluate — rule 3: humidity_high', () => {
  it('switches off one point above the limit', () => {
    const result = evaluate(
      baseReadings({ outdoorHumidityPct: 81 }),
      baseParameters({ maxOutdoorHumidityPct: 80 }),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'humidity_high' });
  });

  it('does not fire exactly at the limit', () => {
    const result = evaluate(
      baseReadings({ outdoorHumidityPct: 80 }),
      baseParameters({ maxOutdoorHumidityPct: 80 }),
      baseState(),
      NOW,
    );
    expect(result.reason).not.toBe('humidity_high');
    expect(result).toEqual({ desiredOn: null, reason: 'hold' });
  });
});

describe('evaluate — rule 4: target_reached', () => {
  it('4a: fan on and mean at target switches off, reason target_reached', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 12 }),
      baseParameters({ targetTempC: 12, targetHysteresisK: 1 }),
      baseState({ desiredOn: true, since: minutesAgo(60) }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'target_reached' });
  });

  it('4b: fan off and mean below target + hysteresis holds, reason target_reached', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 12.5 }), // target(12) + hysteresis(1) = 13
      baseParameters({ targetTempC: 12, targetHysteresisK: 1 }),
      baseState({ desiredOn: false }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: null, reason: 'target_reached' });
  });

  it('mean above target + hysteresis leaves the decision to the delta rules', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 14, outdoorTempC: 5 }), // ΔT = 9, between deltaOffK(2) and deltaOnK(10)
      baseParameters({ targetTempC: 12, targetHysteresisK: 1 }),
      baseState({ desiredOn: false }),
      NOW,
    );
    expect(result.reason).not.toBe('target_reached');
    expect(result).toEqual({ desiredOn: null, reason: 'hold' });
  });

  it('is skipped entirely when targetTempC is null', () => {
    // Fan off, mean(0.5) deliberately low: without the `targetTempC !== null`
    // guard, 4b's `grainMeanC < targetTempC + targetHysteresisK` would coerce
    // the null targetTempC to 0, and 0.5 < 0 + 1 would wrongly fire
    // target_reached even though no target is configured. With the guard in
    // place it falls through to the delta rules instead.
    const result = evaluate(
      baseReadings({ grainMeanC: 0.5, outdoorTempC: 5 }), // ΔT = -4.5, below deltaOffK(2)
      baseParameters({ targetTempC: null, targetHysteresisK: 1, deltaOffK: 2 }),
      baseState({ desiredOn: false }),
      NOW,
    );
    expect(result.reason).not.toBe('target_reached');
    expect(result).toEqual({ desiredOn: false, reason: 'delta_too_small' });
  });
});

describe('evaluate — rule 5: delta_too_small', () => {
  it('switches off one below delta_off_k', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 8.1 }), // ΔT = 1.9
      baseParameters({ deltaOffK: 2 }),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'delta_too_small' });
  });
});

describe('evaluate — rule 6: delta_ok', () => {
  it('switches on exactly at delta_on_k', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 0 }), // ΔT = 10
      baseParameters({ deltaOnK: 10 }),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: true, reason: 'delta_ok' });
  });

  it('holds one tenth below delta_on_k', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 0.1 }), // ΔT = 9.9
      baseParameters({ deltaOnK: 10 }),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: null, reason: 'hold' });
  });
});

describe('evaluate — rule 7: hold', () => {
  it('holds when ΔT sits strictly between the two bounds', () => {
    const result = evaluate(baseReadings(), baseParameters(), baseState(), NOW);
    expect(result).toEqual({ desiredOn: null, reason: 'hold' });
  });
});

describe('evaluate — precedence', () => {
  it('a condensation risk wins over a satisfied rule 6', () => {
    const grainMinC = 9;
    const result = evaluate(
      baseReadings({
        grainMinC,
        dewPointC: grainMinC - DEWPOINT_MARGIN_K, // fires rule 2
        grainMeanC: 20,
        outdoorTempC: 0, // ΔT = 20, would satisfy rule 6 on its own
      }),
      baseParameters({ deltaOnK: 10 }),
      baseState(),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'condensation_risk' });
  });
});

describe('evaluate — minimum times', () => {
  it('a fan running less than min_run_minutes turns rule 4a into a hold with min_run_time', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 12 }),
      baseParameters({ targetTempC: 12, targetHysteresisK: 1, minRunMinutes: 30 }),
      baseState({ desiredOn: true, since: minutesAgo(25) }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: null, reason: 'min_run_time' });
  });

  it('a fan running less than min_run_minutes turns rule 5 into a hold with min_run_time', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 9 }), // ΔT = 1, below deltaOffK(2)
      baseParameters({ targetTempC: null, deltaOffK: 2, minRunMinutes: 30 }),
      baseState({ desiredOn: true, since: minutesAgo(25) }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: null, reason: 'min_run_time' });
  });

  it('rules 1 to 3 still switch off immediately although the fan has been running less than min_run_minutes', () => {
    const result = evaluate(
      baseReadings({ outdoorOffline: true }),
      baseParameters({ minRunMinutes: 30 }),
      baseState({ desiredOn: true, since: minutesAgo(5) }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'no_data' });
  });

  it('a pause shorter than min_pause_minutes turns rule 6 into a hold with min_pause', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 0 }), // ΔT = 10, satisfies deltaOnK
      baseParameters({ deltaOnK: 10, minPauseMinutes: 30 }),
      baseState({ desiredOn: false, lastCommandAt: minutesAgo(10) }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: null, reason: 'min_pause' });
  });

  it('a null since counts as elapsed, so rule 4a switches off without waiting', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 12 }),
      baseParameters({ targetTempC: 12, targetHysteresisK: 1, minRunMinutes: 30 }),
      baseState({ desiredOn: true, since: null }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: false, reason: 'target_reached' });
  });

  it('a null lastCommandAt counts as elapsed, so rule 6 switches on without waiting', () => {
    const result = evaluate(
      baseReadings({ grainMeanC: 10, outdoorTempC: 0 }), // ΔT = 10
      baseParameters({ deltaOnK: 10, minPauseMinutes: 30 }),
      baseState({ desiredOn: false, lastCommandAt: null }),
      NOW,
    );
    expect(result).toEqual({ desiredOn: true, reason: 'delta_ok' });
  });
});
