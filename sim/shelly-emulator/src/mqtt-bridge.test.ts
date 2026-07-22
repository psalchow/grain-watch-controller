import { describe, it, expect, afterEach } from 'vitest';
import mqtt from 'mqtt';
import { startBroker, type Broker } from './broker';
import { ShellyMachine } from './shelly';
import { createBridgeEmitters, wireCommands } from './mqtt-bridge';

const PREFIX = '/corn-watch/actors/corn-watch-1/fan-control';
let broker: Broker | null = null;

afterEach(async () => { if (broker) { await broker.close(); broker = null; } });

function waitFor<T>(fn: () => T | undefined, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v !== undefined) { clearInterval(iv); resolve(v); }
      else if (Date.now() - started > timeoutMs) { clearInterval(iv); reject(new Error('timeout')); }
    }, 10);
  });
}

describe('mqtt bridge', () => {
  it('turns success into a monitor/status message a client can read', async () => {
    broker = await startBroker(0); // ephemeral port
    const emitters = createBridgeEmitters(broker, PREFIX);
    const machine = new ShellyMachine(emitters, { gracePeriodMs: 60, contactorDelayMs: 10, autoOffMs: 100000 });
    wireCommands(broker, PREFIX, machine);

    const client = mqtt.connect(`mqtt://127.0.0.1:${broker.port}`);
    const received: string[] = [];
    await new Promise<void>((r) => client.on('connect', () => r()));
    await new Promise<void>((r) => client.subscribe(`${PREFIX}/monitor/#`, () => r()));
    client.on('message', (_t, p) => received.push(p.toString()));

    client.publish(`${PREFIX}/command/switch:0`, 'on');

    const msg = await waitFor(() => received.find((m) => m.includes('"success"')));
    expect(JSON.parse(msg)).toMatchObject({ type: 'success', switchState: true, inputState: true });
    await new Promise<void>((r) => client.end(false, () => r()));
  });
});
