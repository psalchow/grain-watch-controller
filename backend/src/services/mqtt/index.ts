import mqtt from 'mqtt';
import { MqttService, MqttClientLike } from './mqtt.service';

export { MqttService } from './mqtt.service';
export type { MqttClientLike } from './mqtt.service';

/**
 * Creates an MqttService backed by a live MQTT connection.
 * Auto-reconnect is handled by the mqtt library (reconnectPeriod).
 */
export function createMqttService(cfg: {
  url: string;
  username?: string;
  password?: string;
}): MqttService {
  const client = mqtt.connect(cfg.url, {
    ...(cfg.username !== undefined ? { username: cfg.username } : {}),
    ...(cfg.password !== undefined ? { password: cfg.password } : {}),
    reconnectPeriod: 5000,
  });
  const adapter: MqttClientLike = {
    publish: (topic, message) => client.publish(topic, message),
    subscribe: (topic) => client.subscribe(topic),
    on: ((event: string, cb: (...args: unknown[]) => void) =>
      client.on(event as 'message', cb as never)) as MqttClientLike['on'],
    end: () => client.end(),
  };
  return new MqttService(adapter);
}
