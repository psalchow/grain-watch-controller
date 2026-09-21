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

export interface FanSnapshot {
  status: FanStatus;
  events: FanEvent[];
}
