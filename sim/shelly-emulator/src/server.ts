import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Broker, TrafficEntry } from './broker';
import type { ShellyMachine, ShellySnapshot, ContactorBehaviour } from './shelly';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '../public/index.html'), 'utf8');

interface ControlMessage {
  action: 'switch' | 'manualContactor' | 'contactorBehaviour' | 'online';
  on?: boolean;
  value?: ContactorBehaviour | boolean;
}

export function startServer(opts: {
  port: number;
  machine: ShellyMachine;
  broker: Broker;
  onSnapshot: (cb: (s: ShellySnapshot) => void) => void;
}): void {
  const { port, machine, broker, onSnapshot } = opts;

  const http = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  const wss = new WebSocketServer({ server: http });

  const broadcast = (obj: unknown): void => {
    const data = JSON.stringify(obj);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
  };

  onSnapshot((s) => broadcast({ kind: 'snapshot', snapshot: s }));
  broker.onTraffic((e: TrafficEntry) => broadcast({ kind: 'traffic', entry: e }));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ kind: 'snapshot', snapshot: machine.getSnapshot() }));
    ws.on('message', (raw) => {
      let msg: ControlMessage;
      try { msg = JSON.parse(raw.toString()) as ControlMessage; } catch { return; }
      switch (msg.action) {
        case 'switch': machine.setSwitch(!!msg.on); break;
        case 'manualContactor': machine.manualContactorToggle(); break;
        case 'contactorBehaviour': machine.setContactorBehaviour(msg.value as ContactorBehaviour); break;
        case 'online': machine.setOnline(!!msg.value); break;
      }
    });
  });

  http.listen(port, () => console.log(`[emulator] web UI on http://localhost:${port}`));
}
