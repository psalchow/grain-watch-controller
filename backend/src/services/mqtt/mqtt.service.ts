export interface MqttClientLike {
  publish(topic: string, message: string): void;
  subscribe(topic: string): void;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): void;
  end(): void;
}

type MessageListener = (topic: string, payload: string) => void;

/**
 * Thin wrapper over an MQTT client. Owns the single backend connection and
 * fans inbound messages out to registered listeners as decoded strings.
 */
export class MqttService {
  private readonly listeners: MessageListener[] = [];

  constructor(private readonly client: MqttClientLike) {
    this.client.on('message', (topic, payload) => {
      const decoded = payload.toString();
      for (const listener of this.listeners) {
        listener(topic, decoded);
      }
    });
  }

  publish(topic: string, message: string): void {
    this.client.publish(topic, message);
  }

  subscribe(topic: string): void {
    this.client.subscribe(topic);
  }

  onMessage(listener: MessageListener): void {
    this.listeners.push(listener);
  }

  end(): void {
    this.client.end();
  }
}
