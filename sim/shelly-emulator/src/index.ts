import { startBroker } from './broker';
import { ShellyMachine } from './shelly';
import { createBridgeEmitters, wireCommands } from './mqtt-bridge';
import { startServer } from './server';

const PREFIX = process.env.SHELLY_TOPIC_PREFIX ?? '/corn-watch/actors/corn-watch-1/fan-control';
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 1883);
const UI_PORT = Number(process.env.UI_PORT ?? 8080);
const AUTO_OFF_MS = Number(process.env.SHELLY_AUTO_OFF_MS ?? 3600000);

async function main(): Promise<void> {
  const broker = await startBroker(MQTT_PORT);
  console.log(`[emulator] MQTT broker on :${broker.port}`);

  const emitters = createBridgeEmitters(broker, PREFIX);
  const machine = new ShellyMachine(emitters, { autoOffMs: AUTO_OFF_MS });
  wireCommands(broker, PREFIX, machine);

  // Announce online (retained) at startup.
  machine.setOnline(true);
  broker.publish(`${PREFIX}/online`, 'true', true);

  startServer({ port: UI_PORT, machine, broker, onSnapshot: emitters.onSnapshot });
}

void main();
