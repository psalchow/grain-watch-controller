import { createServer, type Server } from 'node:net';
import Aedes from 'aedes';

export interface TrafficEntry { dir: 'in' | 'out'; topic: string; payload: string; ts: number; }

export interface Broker {
  publish(topic: string, payload: string, retain?: boolean): void;
  subscribe(topic: string, handler: (payload: string) => void): void;
  onTraffic(cb: (e: TrafficEntry) => void): void;
  close(): Promise<void>;
  port: number;
}

export function startBroker(port: number): Promise<Broker> {
  const aedes = new Aedes();
  const server: Server = createServer(aedes.handle);
  const trafficListeners: Array<(e: TrafficEntry) => void> = [];

  // Every publish flowing through the broker (client commands = 'in',
  // broker-originated publishes = 'out') is surfaced for the UI log.
  aedes.on('publish', (packet, client) => {
    if (!packet.topic || packet.topic.startsWith('$SYS')) return;
    trafficListeners.forEach((cb) => cb({
      dir: client ? 'in' : 'out',
      topic: packet.topic,
      payload: packet.payload ? packet.payload.toString() : '',
      ts: Date.now(),
    }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: boundPort,
        publish(topic, payload, retain = false) {
          aedes.publish({ cmd: 'publish', qos: 0, dup: false, retain, topic, payload: Buffer.from(payload) }, () => {});
        },
        subscribe(topic, handler) {
          aedes.subscribe(topic, (packet, cb) => {
            handler(packet.payload ? packet.payload.toString() : '');
            cb();
          }, () => {});
        },
        onTraffic(cb) { trafficListeners.push(cb); },
        close() {
          return new Promise<void>((res) => { aedes.close(() => server.close(() => res())); });
        },
      });
    });
  });
}
