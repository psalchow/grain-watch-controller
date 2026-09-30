export type FanState =
  | 'OFF'
  | 'TURN_ON_PENDING'
  | 'ON'
  | 'TURN_OFF_PENDING'
  | 'FAULT';

export type ShellyMessageType = 'success' | 'warning' | 'alert' | 'safety_shutoff';

export interface ShellyMonitorMessage {
  type: ShellyMessageType;
  message: string;
  switchState: boolean;
  inputState: boolean;
  timestamp: number;
}

export type FanEventKind =
  | 'command'
  | 'success'
  | 'safety_shutoff'
  | 'warning'
  | 'alert'
  | 'status'
  | 'online_change'
  | 'watchdog_off'
  | 'stand_down'
  | 'recovery'
  | 'auto_on'
  | 'auto_off'
  | 'automation_disabled'
  | 'automation_configured';

/**
 * Why `FanController` reported an interference with its own desired state to
 * `FanControllerDeps.onInterference`: `local_switch` for a `warning` (the
 * contactor moved without a command), `fault` for an `alert` or a
 * `safety_shutoff` (the contactor did not follow one). Deliberately excludes
 * `watchdog_off` — see design spec §5.5.
 */
export type InterferenceCause = 'local_switch' | 'fault';

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
   * Deliberately not fed from `switchState`: in a `warning` and an `alert`
   * that field carries `desiredInputState`, the Shelly's last commanded
   * output, not the relay's actual state — the two disagree exactly in the
   * situation this overlay exists to report (design spec §6).
   */
  contactorEngaged: boolean | null;
  lastWarning: { message: string; ts: string } | null;
  lastAlert: { message: string; ts: string } | null;
  since: string | null;
  updatedAt: string;
}
