import { FanControlManager } from './fan.manager';

let manager: FanControlManager | null = null;

export function setFanManager(m: FanControlManager | null): void {
  manager = m;
}

export function getFanManager(): FanControlManager | null {
  return manager;
}
