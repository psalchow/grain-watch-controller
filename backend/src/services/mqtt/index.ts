import mqtt from 'mqtt';
import { MqttService, MqttClientLike } from './mqtt.service';

export { MqttService } from './mqtt.service';
export type { MqttClientLike } from './mqtt.service';

/**
 * Creates a live MQTT client adapted to MqttClientLike.
 * Auto-reconnect is enabled by the mqtt library defaults.
 */
export function createMqttClient(cfg: {
  url: string;
  username?: string;
  password?: string;
}): MqttClientLike {
  const client = mqtt.connect(cfg.url, {
    ...(cfg.username !== undefined ? { username: cfg.username } : {}),
    ...(cfg.password !== undefined ? { password: cfg.password } : {}),
    reconnectPeriod: 5000,
  });
  return {
    publish: (topic, message) => client.publish(topic, message),
    subscribe: (topic) => client.subscribe(topic),
    on: ((event: string, cb: (...args: unknown[]) => void) =>
      client.on(event as 'message' | 'connect', cb as never)) as MqttClientLike['on'],
    end: () => client.end(),
  };
}

export function createMqttService(cfg: {
  url: string;
  username?: string;
  password?: string;
}): MqttService {
  return new MqttService(createMqttClient(cfg));
}
