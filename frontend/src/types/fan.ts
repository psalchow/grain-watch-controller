export type FanState = 'OFF' | 'TURN_ON_PENDING' | 'ON' | 'TURN_OFF_PENDING' | 'FAULT';

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
