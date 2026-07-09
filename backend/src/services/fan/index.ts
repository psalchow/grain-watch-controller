import { FanControlManager } from './fan.manager';

export { FanControlManager } from './fan.manager';
export { FanController } from './fan.controller';
export * from './types';

let manager: FanControlManager | null = null;

export function setFanManager(m: FanControlManager | null): void {
  manager = m;
}

export function getFanManager(): FanControlManager | null {
  return manager;
}
