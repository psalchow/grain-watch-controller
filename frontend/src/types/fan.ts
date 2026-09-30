export type FanState = 'OFF' | 'TURN_ON_PENDING' | 'ON' | 'TURN_OFF_PENDING' | 'FAULT';

export interface FanStatus {
  stockId: string;
  state: FanState;
  desiredOn: boolean;
  /**
   * The control's last connection state as reported by the broker: `true`
   * while it is connected, `false` once it dropped off, `null` until it has
   * been heard from at all.
   *
   * Scope of the claim: this tracks reports arriving about the device. It does
   * not cover the backend's own link to the broker — if that drops, no report
   * can arrive and the last value stands unchanged.
   */
  fanControlReachable: boolean | null;
  /**
   * Whether the contactor's auxiliary contact is closed, i.e. the fan is
   * physically running — whoever switched it. Fed from `inputState` on every
   * monitor message; `null` until the Shelly has said anything.
   *
   * Deliberately not fed from `switchState`: on the device's own monitor
   * messages that field carries `desiredInputState`, the Shelly's last
   * commanded output, not the relay's actual state — the two disagree exactly
   * in the situation this overlay exists to report (design spec §6). This
   * type carries no `switchState`; it is not the field to trust.
   */
  contactorEngaged: boolean | null;
  lastWarning: { message: string; ts: string } | null;
  lastAlert: { message: string; ts: string } | null;
  since: string | null;
  updatedAt: string;
}

export interface FanEvent {
  id: number;
  stockId: string;
  ts: string;
  kind: string;
  payload: unknown;
  source: string;
}

/** Why the automation last decided what it decided (design spec §4.3). */
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
 * The switch plus the seven parameters of `stock_automation` (design spec
 * §3.1). A second, independent declaration of the backend's
 * `AutomationConfig` (`backend/src/db/schema.ts`) — the two are not generated
 * from one source, so a field added to one and not the other type-checks on
 * both sides and fails only at runtime. Keep the field names identical.
 */
export interface AutomationConfig {
  enabled: boolean;
  deltaOnK: number;
  deltaOffK: number;
  maxOutdoorHumidityPct: number;
  targetTempC: number | null;
  targetHysteresisK: number;
  minRunMinutes: number;
  minPauseMinutes: number;
}

/**
 * What an open fan page knows about the automation of one stock (design spec
 * §7.1). No parameters here — the form fetches those separately via
 * `fanApi.getAutomation`.
 */
export interface AutomationSnapshot {
  available: boolean;
  enabled: boolean;
  reason: AutomationReason | null;
  evaluatedAt: string | null;
}

export interface FanSnapshot {
  status: FanStatus;
  events: FanEvent[];
  automation: AutomationSnapshot;
}
