import type { Broker } from './broker';
import type { ShellyEmitters, ShellyMachine, ShellySnapshot, MonitorType } from './shelly';

/** Maps a monitor type to its topic suffix (success + safety_shutoff share 'status'). */
function monitorSuffix(type: MonitorType): string {
  if (type === 'warning') return 'warning';
  if (type === 'alert') return 'alert';
  return 'status';
}

export function createBridgeEmitters(
  broker: Broker,
  prefix: string,
): ShellyEmitters & { onSnapshot(cb: (s: ShellySnapshot) => void): void } {
  const snapshotListeners: Array<(s: ShellySnapshot) => void> = [];
  return {
    publishMonitor(type, message, switchState, inputState, ts) {
      broker.publish(
        `${prefix}/monitor/${monitorSuffix(type)}`,
        JSON.stringify({ type, message, switchState, inputState, timestamp: ts }),
      );
    },
    publishStatus(output) {
      broker.publish(`${prefix}/status/switch:0`, JSON.stringify({ output }));
    },
    publishOnline(online) {
      broker.publish(`${prefix}/online`, String(online), true);
    },
    onChange(snapshot) {
      snapshotListeners.forEach((cb) => cb(snapshot));
    },
    onSnapshot(cb) { snapshotListeners.push(cb); },
  };
}

export function wireCommands(broker: Broker, prefix: string, machine: ShellyMachine): void {
  broker.subscribe(`${prefix}/command/switch:0`, (payload) => {
    const cmd = payload.trim();
    if (cmd === 'on') machine.setSwitch(true);
    else if (cmd === 'off') machine.setSwitch(false);
  });
}
