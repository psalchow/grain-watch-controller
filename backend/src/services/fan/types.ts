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
  | 'recovery';

export interface FanStatus {
  stockId: string;
  state: FanState;
  desiredOn: boolean;
  shellyOnline: boolean | null;
  lastWarning: { message: string; ts: string } | null;
  lastAlert: { message: string; ts: string } | null;
  since: string | null;
  updatedAt: string;
}
