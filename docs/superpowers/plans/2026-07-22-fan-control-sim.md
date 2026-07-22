# Fan Control — Local Simulation Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-command local environment (MQTT broker + Shelly emulator with web UI + seeded InfluxDB + backend + frontend) to try out and simulate the fan-control feature without hardware or the production InfluxDB.

**Architecture:** A standalone Node/TS emulator package embeds an `aedes` MQTT broker, a pure Shelly+contactor state machine (faithful to `switch-monitoring.mjs`), and an HTTP+WebSocket server driving a vanilla web UI. A seeder writes fake sensor data to a dockerised InfluxDB (with the v1 DBRP mapping the backend needs). Everything is wired by `docker-compose.sim.yml`. No backend/frontend application code changes — only env values.

**Tech Stack:** Node 24, TypeScript via `tsx`, `aedes` (MQTT broker), `ws` (WebSocket), Vitest, Docker Compose, InfluxDB 2.7.

## Global Constraints

- All code, comments, commit messages in English (UK spelling). UI copy may be German (matches the app).
- No changes to `backend/src/**` or `frontend/src/**`. Everything new lives under `sim/` plus `docker-compose.sim.yml`.
- The emulator and seeder are standalone packages (own `package.json`, NOT added to the root workspaces array `["frontend","backend"]`).
- Fan MQTT prefix (Halle 8 seed): `/corn-watch/actors/corn-watch-1/fan-control` (leading slash). Command topic `{prefix}/command/switch:0`, payload `on`/`off`. Monitor payload `{ type, message, switchState, inputState, timestamp }` with `type ∈ success|warning|alert|safety_shutoff`; `success`+`safety_shutoff` → `{prefix}/monitor/status`, `warning` → `{prefix}/monitor/warning`, `alert` → `{prefix}/monitor/alert`. Status → `{prefix}/status/switch:0` JSON `{output}`. Online → `{prefix}/online` retained `true`/`false`.
- Default is a correctly-following contactor (→ `success`); the fault (`wontEngage`) is pre-armed and takes effect on the next switch. Grace 3000 ms is not to be raced in the UI.
- InfluxDB `Temp` measurement fields: `temp-top`, `temp-mid`, `temp-bottom`, `humidity`, `batteryMV`, `measurementTimeS` (unix seconds); tags `device-group` (`corn-watch-1`), `device` (`1.1`..`1.5`). Outdoor: `outdoor-temperature` field `temp`, `outdoor-humidity` field `humidity`, tag `device`=`corn-watch-1`. Backend queries via v1 compat `GET /query?db=grainwatch` → needs a DBRP mapping.
- Spec: `docs/superpowers/specs/2026-07-22-fan-control-sim-design.md`.

---

## File Structure

- `sim/shelly-emulator/package.json` — standalone; deps `aedes`, `ws`, `mqtt` (test), `tsx`, `vitest`, `typescript`, `@types/ws`, `@types/node`.
- `sim/shelly-emulator/tsconfig.json`
- `sim/shelly-emulator/src/shelly.ts` — pure state machine (no MQTT/HTTP).
- `sim/shelly-emulator/src/shelly.test.ts` — Vitest unit tests (fake timers).
- `sim/shelly-emulator/src/broker.ts` — aedes broker wrapper (publish/subscribe/traffic hook).
- `sim/shelly-emulator/src/mqtt-bridge.ts` — wires the state machine to the broker.
- `sim/shelly-emulator/src/mqtt-bridge.test.ts` — integration test over a real broker.
- `sim/shelly-emulator/src/server.ts` — HTTP static + WebSocket (state + traffic push, control in).
- `sim/shelly-emulator/src/index.ts` — entrypoint wiring broker+shelly+bridge+server.
- `sim/shelly-emulator/public/index.html` — web UI.
- `sim/shelly-emulator/Dockerfile`
- `sim/influx-seed/package.json` — standalone; deps `tsx`, `typescript`, `@types/node`, `vitest`.
- `sim/influx-seed/tsconfig.json`
- `sim/influx-seed/src/lineprotocol.ts` — pure line-protocol builder.
- `sim/influx-seed/src/lineprotocol.test.ts` — Vitest.
- `sim/influx-seed/src/seed.ts` — ensures DBRP + writes seed data.
- `sim/influx-seed/Dockerfile`
- `docker-compose.sim.yml`
- `sim/README.md` — run + click runbook.

---

## Task 1: Shelly state machine (pure) + tests

**Files:**
- Create: `sim/shelly-emulator/package.json`, `sim/shelly-emulator/tsconfig.json`
- Create: `sim/shelly-emulator/src/shelly.ts`
- Test: `sim/shelly-emulator/src/shelly.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type MonitorType = 'success' | 'warning' | 'alert' | 'safety_shutoff';
  type ContactorBehaviour = 'follow' | 'wontEngage';
  interface ShellySnapshot {
    switchOutput: boolean; inputState: boolean; online: boolean;
    contactorBehaviour: ContactorBehaviour;
    lastMonitor: { type: MonitorType; message: string; ts: number } | null;
  }
  interface ShellyEmitters {
    publishMonitor(type: MonitorType, message: string, switchState: boolean, inputState: boolean, ts: number): void;
    publishStatus(output: boolean): void;
    publishOnline(online: boolean): void;
    onChange(snapshot: ShellySnapshot): void;
  }
  interface ShellyOptions { gracePeriodMs?: number; contactorDelayMs?: number; autoOffMs?: number; now?: () => number; }
  class ShellyMachine {
    constructor(emit: ShellyEmitters, opts?: ShellyOptions);
    setSwitch(on: boolean): void;                 // MQTT command or manual output switch
    manualContactorToggle(): void;                // input toggled w/o command → warning
    setContactorBehaviour(b: ContactorBehaviour): void;
    setOnline(on: boolean): void;
    getSnapshot(): ShellySnapshot;
    stop(): void;                                 // clear timers
  }
  ```

- [ ] **Step 1: Create the package manifest**

Create `sim/shelly-emulator/package.json`:

```json
{
  "name": "grainwatch-shelly-emulator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "aedes": "^0.51.3",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "@types/ws": "^8.5.13",
    "mqtt": "^5.10.1",
    "tsx": "^4.21.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `sim/shelly-emulator/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Then install (creates the package lockfile):

Run: `cd sim/shelly-emulator && npm install`
Expected: `node_modules` created, no errors.

- [ ] **Step 2: Write the failing test**

Create `sim/shelly-emulator/src/shelly.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellyMachine, type ShellySnapshot, type MonitorType } from './shelly';

function makeEmit() {
  const monitors: Array<{ type: MonitorType; switchState: boolean; inputState: boolean }> = [];
  const statuses: boolean[] = [];
  const onlines: boolean[] = [];
  let last: ShellySnapshot | null = null;
  const emit = {
    publishMonitor: (type: MonitorType, _m: string, switchState: boolean, inputState: boolean) =>
      { monitors.push({ type, switchState, inputState }); },
    publishStatus: (output: boolean) => { statuses.push(output); },
    publishOnline: (online: boolean) => { onlines.push(online); },
    onChange: (s: ShellySnapshot) => { last = s; },
  };
  return { emit, monitors, statuses, onlines, get last() { return last; } };
}

const OPTS = { gracePeriodMs: 3000, contactorDelayMs: 500, autoOffMs: 60000, now: () => 1000 };

describe('ShellyMachine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes success when the contactor follows (default)', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    expect(e.statuses).toEqual([true]);        // status on switch
    vi.advanceTimersByTime(500);               // contactor engages
    expect(s.getSnapshot().inputState).toBe(true);
    vi.advanceTimersByTime(2500);              // grace elapses
    expect(e.monitors.at(-1)).toEqual({ type: 'success', switchState: true, inputState: true });
  });

  it('publishes alert + safety_shutoff when the contactor will not engage', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setContactorBehaviour('wontEngage');
    s.setSwitch(true);
    vi.advanceTimersByTime(3000);              // grace elapses, input never engaged
    const types = e.monitors.map((m) => m.type);
    expect(types).toContain('alert');
    expect(types).toContain('safety_shutoff');
    expect(s.getSnapshot().switchOutput).toBe(false); // safety shutoff forced output off
  });

  it('publishes a warning on manual contactor toggle without a command', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.manualContactorToggle();
    expect(e.monitors.at(-1)?.type).toBe('warning');
    expect(s.getSnapshot().inputState).toBe(true);
  });

  it('turns the output off on auto-off expiry', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    vi.advanceTimersByTime(500);               // engaged
    vi.advanceTimersByTime(60000);             // auto-off fires
    expect(s.getSnapshot().switchOutput).toBe(false);
    expect(e.statuses.at(-1)).toBe(false);
  });

  it('keep-alive re-assert resets the auto-off timer', () => {
    const e = makeEmit();
    const s = new ShellyMachine(e.emit, OPTS);
    s.setSwitch(true);
    vi.advanceTimersByTime(40000);             // < autoOff
    s.setSwitch(true);                         // keep-alive re-assert
    vi.advanceTimersByTime(40000);             // 80s total but only 40s since re-assert
    expect(s.getSnapshot().switchOutput).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `cd sim/shelly-emulator && npm test`
Expected: FAIL — cannot find module `./shelly`.

- [ ] **Step 4: Implement `shelly.ts`**

Create `sim/shelly-emulator/src/shelly.ts`:

```ts
export type MonitorType = 'success' | 'warning' | 'alert' | 'safety_shutoff';
export type ContactorBehaviour = 'follow' | 'wontEngage';

export interface ShellySnapshot {
  switchOutput: boolean;
  inputState: boolean;
  online: boolean;
  contactorBehaviour: ContactorBehaviour;
  lastMonitor: { type: MonitorType; message: string; ts: number } | null;
}

export interface ShellyEmitters {
  publishMonitor(type: MonitorType, message: string, switchState: boolean, inputState: boolean, ts: number): void;
  publishStatus(output: boolean): void;
  publishOnline(online: boolean): void;
  onChange(snapshot: ShellySnapshot): void;
}

export interface ShellyOptions {
  gracePeriodMs?: number;
  contactorDelayMs?: number;
  autoOffMs?: number;
  now?: () => number;
}

/**
 * Faithful reproduction of the fan-control side of switch-monitoring.mjs.
 * Pure of transport: it calls the injected emitters instead of touching MQTT.
 */
export class ShellyMachine {
  private switchOutput = false;
  private inputState = false;
  private desiredInputState = false;
  private online = true;
  private contactorBehaviour: ContactorBehaviour = 'follow';
  private lastMonitor: ShellySnapshot['lastMonitor'] = null;

  private grace: ReturnType<typeof setTimeout> | null = null;
  private follow: ReturnType<typeof setTimeout> | null = null;
  private autoOff: ReturnType<typeof setTimeout> | null = null;

  private readonly gracePeriodMs: number;
  private readonly contactorDelayMs: number;
  private readonly autoOffMs: number;
  private readonly now: () => number;

  constructor(private readonly emit: ShellyEmitters, opts: ShellyOptions = {}) {
    this.gracePeriodMs = opts.gracePeriodMs ?? 3000;
    this.contactorDelayMs = opts.contactorDelayMs ?? 500;
    this.autoOffMs = opts.autoOffMs ?? 3600000;
    this.now = opts.now ?? (() => Date.now());
  }

  setSwitch(on: boolean): void {
    this.switchOutput = on;
    this.desiredInputState = on;
    this.emit.publishStatus(on);

    // Contactor reaction: follow after a short delay unless armed to fail.
    if (this.follow) { clearTimeout(this.follow); this.follow = null; }
    if (on && this.contactorBehaviour === 'wontEngage') {
      // stays disengaged — the fault case
    } else {
      this.follow = setTimeout(() => {
        this.follow = null;
        this.inputState = on;
        this.change();
      }, this.contactorDelayMs);
    }

    // Auto-off: (re)arm while on (a repeated ON — keep-alive — resets it).
    if (this.autoOff) { clearTimeout(this.autoOff); this.autoOff = null; }
    if (on) {
      this.autoOff = setTimeout(() => {
        this.autoOff = null;
        this.setSwitch(false); // models Shelly Auto OFF as an internal switch-off
      }, this.autoOffMs);
    }

    // Grace: evaluate whether the contactor reached the desired state.
    if (this.grace) clearTimeout(this.grace);
    this.grace = setTimeout(() => {
      this.grace = null;
      this.evaluateGrace();
    }, this.gracePeriodMs);

    this.change();
  }

  manualContactorToggle(): void {
    this.inputState = !this.inputState;
    this.publishMonitor('warning', 'Input changed without switch command');
    this.change();
  }

  setContactorBehaviour(b: ContactorBehaviour): void {
    this.contactorBehaviour = b;
    this.change();
  }

  setOnline(on: boolean): void {
    if (this.online === on) return;
    this.online = on;
    this.emit.publishOnline(on);
    this.change();
  }

  getSnapshot(): ShellySnapshot {
    return {
      switchOutput: this.switchOutput,
      inputState: this.inputState,
      online: this.online,
      contactorBehaviour: this.contactorBehaviour,
      lastMonitor: this.lastMonitor,
    };
  }

  stop(): void {
    for (const t of [this.grace, this.follow, this.autoOff]) if (t) clearTimeout(t);
    this.grace = this.follow = this.autoOff = null;
  }

  private evaluateGrace(): void {
    if (this.inputState === this.desiredInputState) {
      this.publishMonitor('success', 'Contactor switched correctly');
      return;
    }
    this.publishMonitor('alert', `Input did not switch within ${this.gracePeriodMs}ms`);
    if (this.desiredInputState) {
      // Commanded ON but the contactor did not engage → safety shutoff.
      this.switchOutput = false;
      this.emit.publishStatus(false);
      this.publishMonitor('safety_shutoff', 'Switch turned OFF - input did not engage');
      this.change();
    }
  }

  private publishMonitor(type: MonitorType, message: string): void {
    const ts = this.now();
    this.lastMonitor = { type, message, ts };
    this.emit.publishMonitor(type, message, this.switchOutput, this.inputState, ts);
  }

  private change(): void {
    this.emit.onChange(this.getSnapshot());
  }
}
```

- [ ] **Step 5: Run tests to green**

Run: `cd sim/shelly-emulator && npm test`
Expected: PASS (5 tests). Also `npm run typecheck` — no errors.

- [ ] **Step 6: Commit**

```bash
git add sim/shelly-emulator/package.json sim/shelly-emulator/tsconfig.json sim/shelly-emulator/src/shelly.ts sim/shelly-emulator/src/shelly.test.ts sim/shelly-emulator/package-lock.json
git commit -m "feat(sim): add Shelly emulator state machine"
```

---

## Task 2: MQTT broker + bridge (aedes) + integration test

**Files:**
- Create: `sim/shelly-emulator/src/broker.ts`
- Create: `sim/shelly-emulator/src/mqtt-bridge.ts`
- Test: `sim/shelly-emulator/src/mqtt-bridge.test.ts`

**Interfaces:**
- Consumes: `ShellyMachine`, `ShellyEmitters`, `MonitorType` (Task 1).
- Produces:
  ```ts
  // broker.ts
  interface TrafficEntry { dir: 'in' | 'out'; topic: string; payload: string; ts: number; }
  interface Broker {
    publish(topic: string, payload: string, retain?: boolean): void;
    subscribe(topic: string, handler: (payload: string) => void): void;
    onTraffic(cb: (e: TrafficEntry) => void): void;
    close(): Promise<void>;
    port: number;
  }
  function startBroker(port: number): Promise<Broker>;
  // mqtt-bridge.ts
  function createBridgeEmitters(broker: Broker, prefix: string): ShellyEmitters & { onSnapshot(cb: (s: import('./shelly').ShellySnapshot) => void): void };
  function wireCommands(broker: Broker, prefix: string, machine: ShellyMachine): void;
  ```

- [ ] **Step 1: Write the failing integration test**

Create `sim/shelly-emulator/src/mqtt-bridge.test.ts`:

```ts
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
    client.end();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd sim/shelly-emulator && npm test -- mqtt-bridge`
Expected: FAIL — cannot find `./broker`.

- [ ] **Step 3: Implement `broker.ts`**

Create `sim/shelly-emulator/src/broker.ts`:

```ts
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
```

- [ ] **Step 4: Implement `mqtt-bridge.ts`**

Create `sim/shelly-emulator/src/mqtt-bridge.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to green**

Run: `cd sim/shelly-emulator && npm test`
Expected: PASS (shelly + mqtt-bridge). `npm run typecheck` — no errors.

- [ ] **Step 6: Commit**

```bash
git add sim/shelly-emulator/src/broker.ts sim/shelly-emulator/src/mqtt-bridge.ts sim/shelly-emulator/src/mqtt-bridge.test.ts
git commit -m "feat(sim): add aedes broker and mqtt bridge for the emulator"
```

---

## Task 3: HTTP + WebSocket server, web UI, entrypoint

**Files:**
- Create: `sim/shelly-emulator/src/server.ts`
- Create: `sim/shelly-emulator/src/index.ts`
- Create: `sim/shelly-emulator/public/index.html`

**Interfaces:**
- Consumes: `Broker`, `TrafficEntry` (Task 2); `ShellyMachine`, `ShellySnapshot` (Task 1); bridge emitters (Task 2).
- Produces: `startServer(opts: { port: number; machine: ShellyMachine; broker: Broker; onSnapshot: (cb: (s: ShellySnapshot) => void) => void }): void`.

- [ ] **Step 1: Implement `server.ts`**

Create `sim/shelly-emulator/src/server.ts`:

```ts
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
```

- [ ] **Step 2: Implement `index.ts` (entrypoint)**

Create `sim/shelly-emulator/src/index.ts`:

```ts
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
```

- [ ] **Step 3: Implement `public/index.html`**

Create `sim/shelly-emulator/public/index.html`:

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shelly-Emulator — Halle 8</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 12px 20px; background: #1e293b; font-weight: 600; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px; }
    .card { background: #1e293b; border-radius: 10px; padding: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }
    .fan { font-size: 48px; text-align: center; transition: transform .2s; }
    .fan.on { animation: spin 1.2s linear infinite; color: #22c55e; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; }
    .on-bg { background: #14532d; color: #bbf7d0; } .off-bg { background: #3f3f46; color: #d4d4d8; }
    button { background: #334155; color: #e2e8f0; border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 14px; }
    button:hover { background: #475569; }
    button.danger { background: #7f1d1d; } button.danger:hover { background: #991b1b; }
    select { background: #334155; color: #e2e8f0; border: 0; border-radius: 8px; padding: 8px; }
    #log { grid-column: 1 / -1; font-family: ui-monospace, monospace; font-size: 12px; height: 240px; overflow: auto; background: #0b1220; padding: 10px; border-radius: 8px; }
    .log-in { color: #93c5fd; } .log-out { color: #86efac; }
  </style>
</head>
<body>
  <header>Shelly 1 (Gen 3) — Emulator · Halle 8</header>
  <main>
    <div class="card">
      <h2>Schalt-Status (Shelly-Output)</h2>
      <div id="fan" class="fan">✷</div>
      <div class="row">Output: <span id="output" class="pill off-bg">–</span></div>
      <div class="row">Schütz / Lüfter (Input): <span id="input" class="pill off-bg">–</span></div>
      <div class="row">Online: <span id="online" class="pill off-bg">–</span></div>
      <div class="row">Letzte Meldung: <span id="lastMonitor">–</span></div>
    </div>
    <div class="card">
      <h2>Steuerung</h2>
      <div class="row">
        <button onclick="send({action:'switch',on:true})">Shelly EIN</button>
        <button onclick="send({action:'switch',on:false})">Shelly AUS</button>
      </div>
      <div class="row">
        <button onclick="send({action:'manualContactor'})">Lüfter/Schütz manuell schalten</button>
      </div>
      <div class="row">
        Schütz beim nächsten Schalten:
        <select id="behaviour" onchange="send({action:'contactorBehaviour',value:this.value})">
          <option value="follow">Normal (folgt)</option>
          <option value="wontEngage">Zieht nicht an</option>
        </select>
      </div>
      <div class="row">
        <button class="danger" id="onlineBtn" onclick="toggleOnline()">Shelly offline schalten</button>
      </div>
    </div>
    <div id="log"></div>
  </main>
  <script>
    let ws, online = true;
    const $ = (id) => document.getElementById(id);
    function connect() {
      ws = new WebSocket(`ws://${location.host}`);
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.kind === 'snapshot') render(m.snapshot);
        else if (m.kind === 'traffic') addLog(m.entry);
      };
      ws.onclose = () => setTimeout(connect, 1000);
    }
    function send(msg) { ws && ws.readyState === 1 && ws.send(JSON.stringify(msg)); }
    function toggleOnline() { online = !online; send({ action: 'online', value: online }); }
    function pill(el, on, onText, offText) {
      el.textContent = on ? onText : offText;
      el.className = 'pill ' + (on ? 'on-bg' : 'off-bg');
    }
    function render(s) {
      pill($('output'), s.switchOutput, 'EIN', 'AUS');
      pill($('input'), s.inputState, 'angezogen', 'abgefallen');
      pill($('online'), s.online, 'online', 'offline');
      online = s.online;
      $('onlineBtn').textContent = s.online ? 'Shelly offline schalten' : 'Shelly online schalten';
      $('behaviour').value = s.contactorBehaviour;
      $('fan').className = 'fan' + (s.switchOutput ? ' on' : '');
      $('lastMonitor').textContent = s.lastMonitor ? `${s.lastMonitor.type} — ${s.lastMonitor.message}` : '–';
    }
    function addLog(e) {
      const div = document.createElement('div');
      div.className = e.dir === 'in' ? 'log-in' : 'log-out';
      const t = new Date(e.ts).toLocaleTimeString();
      div.textContent = `${t} ${e.dir === 'in' ? '⇢' : '⇠'} ${e.topic}  ${e.payload}`;
      const log = $('log');
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    connect();
  </script>
</body>
</html>
```

- [ ] **Step 4: Smoke-run the emulator locally**

Run: `cd sim/shelly-emulator && MQTT_PORT=1884 UI_PORT=8080 npm start`
Expected: logs `MQTT broker on :1884` and `web UI on http://localhost:8080`. Open the UI in a browser: clicking "Shelly EIN" spins the fan, shows Output EIN / Input angezogen within ~0.5 s, and the log shows the outgoing `status`/`monitor/status` messages. Stop with Ctrl-C.

- [ ] **Step 5: Typecheck + commit**

Run: `cd sim/shelly-emulator && npm run typecheck`
Expected: no errors.

```bash
git add sim/shelly-emulator/src/server.ts sim/shelly-emulator/src/index.ts sim/shelly-emulator/public/index.html
git commit -m "feat(sim): add emulator http+ws server and web UI"
```

---

## Task 4: InfluxDB seeder

**Files:**
- Create: `sim/influx-seed/package.json`, `sim/influx-seed/tsconfig.json`
- Create: `sim/influx-seed/src/lineprotocol.ts`
- Test: `sim/influx-seed/src/lineprotocol.test.ts`
- Create: `sim/influx-seed/src/seed.ts`

**Interfaces:**
- Produces:
  ```ts
  // lineprotocol.ts
  interface Point { measurement: string; tags: Record<string, string>; fields: Record<string, number>; tsSeconds: number; }
  function toLineProtocol(points: Point[]): string;
  ```

- [ ] **Step 1: Create manifest + tsconfig**

Create `sim/influx-seed/package.json`:

```json
{
  "name": "grainwatch-influx-seed",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/seed.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.21.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `sim/influx-seed/tsconfig.json` (identical to the emulator's):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Run: `cd sim/influx-seed && npm install`
Expected: no errors.

- [ ] **Step 2: Write the failing test**

Create `sim/influx-seed/src/lineprotocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toLineProtocol } from './lineprotocol';

describe('toLineProtocol', () => {
  it('formats a Temp point with tags, fields and second precision', () => {
    const line = toLineProtocol([{
      measurement: 'Temp',
      tags: { 'device-group': 'corn-watch-1', device: '1.1' },
      fields: { 'temp-top': 10.5, batteryMV: 436, measurementTimeS: 1000 },
      tsSeconds: 1000,
    }]);
    expect(line).toBe('Temp,device-group=corn-watch-1,device=1.1 temp-top=10.5,batteryMV=436,measurementTimeS=1000 1000');
  });

  it('joins multiple points with newlines', () => {
    const line = toLineProtocol([
      { measurement: 'A', tags: { d: 'x' }, fields: { v: 1 }, tsSeconds: 5 },
      { measurement: 'B', tags: { d: 'y' }, fields: { v: 2 }, tsSeconds: 6 },
    ]);
    expect(line.split('\n')).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `cd sim/influx-seed && npm test`
Expected: FAIL — cannot find `./lineprotocol`.

- [ ] **Step 4: Implement `lineprotocol.ts`**

Create `sim/influx-seed/src/lineprotocol.ts`:

```ts
export interface Point {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number>;
  tsSeconds: number;
}

/** Builds InfluxDB line protocol (second precision). Field names may contain hyphens. */
export function toLineProtocol(points: Point[]): string {
  return points
    .map((p) => {
      const tags = Object.entries(p.tags).map(([k, v]) => `${k}=${v}`).join(',');
      const fields = Object.entries(p.fields).map(([k, v]) => `${k}=${v}`).join(',');
      const measurementAndTags = tags ? `${p.measurement},${tags}` : p.measurement;
      return `${measurementAndTags} ${fields} ${p.tsSeconds}`;
    })
    .join('\n');
}
```

- [ ] **Step 5: Run tests to green**

Run: `cd sim/influx-seed && npm test`
Expected: PASS.

- [ ] **Step 6: Implement `seed.ts`**

Create `sim/influx-seed/src/seed.ts`:

```ts
import { toLineProtocol, type Point } from './lineprotocol';

const URL = process.env.INFLUXDB_URL ?? 'http://localhost:8086';
const TOKEN = process.env.INFLUXDB_TOKEN ?? 'test-token';
const ORG = process.env.INFLUXDB_ORG ?? 'grainwatch';
const BUCKET = process.env.INFLUXDB_BUCKET ?? 'grainwatch';
const DEVICE_GROUP = 'corn-watch-1';
const DEVICES = ['1.1', '1.2', '1.3', '1.4', '1.5'];

const authHeaders = { Authorization: `Token ${TOKEN}` };

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${URL}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('InfluxDB did not become healthy in time');
}

/** Ensures a v1 DBRP mapping db=BUCKET -> bucket so the backend's /query works. */
async function ensureDbrp(): Promise<void> {
  const bucketsRes = await fetch(`${URL}/api/v2/buckets?name=${encodeURIComponent(BUCKET)}`, { headers: authHeaders });
  const bucketId = (await bucketsRes.json() as { buckets?: Array<{ id: string }> }).buckets?.[0]?.id;
  if (!bucketId) throw new Error(`Bucket ${BUCKET} not found`);

  const existing = await fetch(`${URL}/api/v2/dbrps?org=${encodeURIComponent(ORG)}`, { headers: authHeaders });
  const dbrps = (await existing.json() as { content?: Array<{ database: string }> }).content ?? [];
  if (dbrps.some((d) => d.database === BUCKET)) return;

  const res = await fetch(`${URL}/api/v2/dbrps`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ org: ORG, bucketID: bucketId, database: BUCKET, retention_policy: 'autogen', default: true }),
  });
  if (!res.ok) throw new Error(`DBRP create failed: ${res.status} ${await res.text()}`);
}

function buildPoints(): Point[] {
  const nowS = Math.floor(Date.now() / 1000);
  const points: Point[] = [];
  // ~24 h of readings, one every 15 min, per device.
  for (let step = 96; step >= 0; step--) {
    const ts = nowS - step * 900;
    DEVICES.forEach((device, di) => {
      const base = 10 + di * 0.5;
      points.push({
        measurement: 'Temp',
        tags: { 'device-group': DEVICE_GROUP, device },
        fields: {
          'temp-top': round(base + 1.5 + Math.sin(step / 6)),
          'temp-mid': round(base + 0.8 + Math.sin(step / 7)),
          'temp-bottom': round(base + Math.sin(step / 8)),
          humidity: round(70 + Math.sin(step / 5) * 5),
          batteryMV: 436,
          measurementTimeS: ts,
        },
        tsSeconds: ts,
      });
    });
    points.push({ measurement: 'outdoor-temperature', tags: { device: DEVICE_GROUP }, fields: { temp: round(5 + Math.sin(step / 10) * 3) }, tsSeconds: ts });
    points.push({ measurement: 'outdoor-humidity', tags: { device: DEVICE_GROUP }, fields: { humidity: round(80 + Math.sin(step / 9) * 8) }, tsSeconds: ts });
  }
  return points;
}

function round(v: number): number { return Math.round(v * 10) / 10; }

async function write(points: Point[]): Promise<void> {
  const res = await fetch(`${URL}/api/v2/write?org=${encodeURIComponent(ORG)}&bucket=${encodeURIComponent(BUCKET)}&precision=s`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    body: toLineProtocol(points),
  });
  if (!res.ok) throw new Error(`Write failed: ${res.status} ${await res.text()}`);
}

async function main(): Promise<void> {
  await waitForHealth();
  await ensureDbrp();
  await write(buildPoints());
  console.log('[seed] wrote seed data and ensured DBRP mapping');
}

void main().catch((err) => { console.error('[seed]', err); process.exit(1); });
```

- [ ] **Step 7: Typecheck + commit**

Run: `cd sim/influx-seed && npm run typecheck`
Expected: no errors.

```bash
git add sim/influx-seed/package.json sim/influx-seed/tsconfig.json sim/influx-seed/src/lineprotocol.ts sim/influx-seed/src/lineprotocol.test.ts sim/influx-seed/src/seed.ts sim/influx-seed/package-lock.json
git commit -m "feat(sim): add InfluxDB seeder with DBRP mapping and fake data"
```

---

## Task 5: Dockerfiles, docker-compose.sim.yml, README

**Files:**
- Create: `sim/shelly-emulator/Dockerfile`
- Create: `sim/influx-seed/Dockerfile`
- Create: `docker-compose.sim.yml`
- Create: `sim/README.md`

**Interfaces:**
- Consumes: emulator (`npm start` = `tsx src/index.ts`, ports MQTT 1883 / UI 8080), seeder (`npm start` = `tsx src/seed.ts`), backend build (`./backend/Dockerfile`), influxdb 2.7 setup env.

- [ ] **Step 1: Emulator Dockerfile**

Create `sim/shelly-emulator/Dockerfile`:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
EXPOSE 1883 8080
CMD ["npm", "start"]
```

- [ ] **Step 2: Seeder Dockerfile**

Create `sim/influx-seed/Dockerfile`:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
CMD ["npm", "start"]
```

- [ ] **Step 3: docker-compose.sim.yml**

Create `docker-compose.sim.yml` at the repo root:

```yaml
# Local simulation stack for the fan-control feature. Run: docker compose -f docker-compose.sim.yml up --build
services:
  influxdb:
    image: influxdb:2.7-alpine
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=adminpassword
      - DOCKER_INFLUXDB_INIT_ORG=grainwatch
      - DOCKER_INFLUXDB_INIT_BUCKET=grainwatch
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=test-token
    ports:
      - "8086:8086"
    healthcheck:
      test: ["CMD", "influx", "ping"]
      interval: 5s
      timeout: 5s
      retries: 20
    networks: [sim-net]

  influx-seed:
    build: { context: ./sim/influx-seed }
    environment:
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=test-token
      - INFLUXDB_ORG=grainwatch
      - INFLUXDB_BUCKET=grainwatch
    depends_on:
      influxdb: { condition: service_healthy }
    networks: [sim-net]
    restart: "no"

  shelly-emulator:
    build: { context: ./sim/shelly-emulator }
    environment:
      - MQTT_PORT=1883
      - UI_PORT=8080
      - SHELLY_TOPIC_PREFIX=/corn-watch/actors/corn-watch-1/fan-control
      # Lower to observe auto-off quickly, e.g. 120000 (2 min). Default 1 h.
      - SHELLY_AUTO_OFF_MS=3600000
    ports:
      - "8080:8080"
    networks: [sim-net]

  backend:
    build: { context: ./backend }
    environment:
      - NODE_ENV=development
      - PORT=3000
      - JWT_SECRET=dev-secret-change-in-production-please-32
      - MQTT_URL=mqtt://shelly-emulator:1883
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=test-token
      - INFLUXDB_ORG=grainwatch
      - INFLUXDB_BUCKET=grainwatch
      - INFLUXDB_MEASUREMENT=Temp
      - DATABASE_PATH=/app/data/grainwatch.db
      # Short so keep-alive re-asserts are observable within minutes.
      - FAN_KEEPALIVE_INTERVAL_MS=30000
    ports:
      - "3000:3000"
    depends_on:
      influxdb: { condition: service_healthy }
    networks: [sim-net]

  frontend:
    image: node:24-alpine
    working_dir: /app
    # npm install (not ci): frontend is an npm workspace with no standalone lockfile.
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0 --port 5173"
    environment:
      - VITE_API_BASE_URL=http://localhost:3000/api/v1
    volumes:
      - ./frontend:/app
      - /app/node_modules
    ports:
      - "5173:5173"
    networks: [sim-net]

networks:
  sim-net:
    driver: bridge
```

- [ ] **Step 4: README runbook**

Create `sim/README.md`:

```markdown
# Fan Control — Local Simulation

Runs the whole fan-control feature locally with an emulated Shelly + contactor
and a seeded InfluxDB. No hardware or production InfluxDB needed.

## Start

    docker compose -f docker-compose.sim.yml up --build

Wait until `influx-seed` exits 0 and the backend logs `Fan control: initialised`.

## Open

- Frontend: http://localhost:5173 — log in as `admin` / `changeme123`.
  Open Halle 8 → "Lüfter steuern" (sub-screen), or go directly to
  http://localhost:5173/stocks/grain-watch-1/fan
- Shelly emulator UI: http://localhost:8080

## Try it

1. **Normal switch on:** In the frontend fan screen click "Einschalten". The
   emulator UI shows Output EIN, Schütz angezogen; the frontend goes
   TURN_ON_PENDING → ON. The MQTT log shows the `command`, `status` and
   `monitor/status` (success) messages.
2. **Contactor won't engage:** In the emulator UI set "Schütz beim nächsten
   Schalten" → "Zieht nicht an", then switch on from the frontend. After ~3 s
   the emulator publishes `alert` + `safety_shutoff`; the frontend shows FAULT.
3. **Manual contactor switch:** Click "Lüfter/Schütz manuell schalten" — the
   emulator publishes a `warning` and the frontend shows the warning overlay.
4. **Shelly offline:** Click "Shelly offline schalten" — the frontend shows the
   Shelly-offline overlay.
5. **Keep-alive / auto-off:** With the fan ON, watch the MQTT log — the backend
   re-asserts `on` every 30 s. To see auto-off quickly, set
   `SHELLY_AUTO_OFF_MS` (e.g. `120000`) in `docker-compose.sim.yml`.

## Manual switching directly at the Shelly

The emulator UI "Shelly EIN/AUS" buttons switch the output directly (as if
toggled on the device). With the fan desired OFF in the backend this surfaces
as unexpected switching.

## Stop

    docker compose -f docker-compose.sim.yml down -v
```

- [ ] **Step 5: Verify the stack builds and starts**

Run: `docker compose -f docker-compose.sim.yml up --build -d`
Expected: all services start; `docker compose -f docker-compose.sim.yml ps` shows influxdb healthy, `influx-seed` exited 0, backend/frontend/shelly-emulator running. Check `docker compose -f docker-compose.sim.yml logs influx-seed` shows `wrote seed data`. Then `docker compose -f docker-compose.sim.yml down -v`.

- [ ] **Step 6: Commit**

```bash
git add sim/shelly-emulator/Dockerfile sim/influx-seed/Dockerfile docker-compose.sim.yml sim/README.md
git commit -m "feat(sim): add dockerfiles, sim compose and runbook"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Bring up the full stack**

Run: `docker compose -f docker-compose.sim.yml up --build`
Expected: influx-seed writes data and exits 0; backend logs fan-control init and connects to `mqtt://shelly-emulator:1883`.

- [ ] **Step 2: Walk the runbook**

Follow `sim/README.md` "Try it" steps 1–5 in the browser. Confirm each expected outcome: success flips the frontend to ON; the pre-armed "Zieht nicht an" yields alert + safety_shutoff → FAULT; manual contactor toggle → warning overlay; offline → offline overlay; keep-alive re-asserts every 30 s in the MQTT log.

- [ ] **Step 3: Confirm InfluxDB-backed screens work**

In the frontend open the Halle 8 hall screen (not just the fan sub-screen): sensor cards and history render from the seeded data, and the fan status card + "Lüfter steuern" button are present.

- [ ] **Step 4: Tear down**

Run: `docker compose -f docker-compose.sim.yml down -v`

---

## Self-Review Notes (author checklist — applied)

- **Spec coverage:** aedes broker (T2), Shelly state machine faithful to switch-monitoring.mjs incl. grace/auto-off/detached input (T1), success/warning/alert/safety_shutoff on the correct topics + status + retained online (T1/T2), web UI with MQTT log + switch status + manual Shelly switch + manual contactor switch + pre-armed fault + offline (T3), InfluxDB + seeder + DBRP mapping + schema-matching data (T4), backend with lowered keep-alive + MQTT_URL to the emulator (T5), frontend Vite container (T5), one-command compose + README runbook (T5), dual visualisation (emulator UI physical + frontend logical) exercised in T6. No backend/frontend src changes.
- **Type consistency:** `ShellySnapshot`/`ShellyEmitters`/`MonitorType`/`ContactorBehaviour` shared T1→T2→T3; monitor topic mapping (success/safety_shutoff→status) matches the backend contract; command topic `{prefix}/command/switch:0`; line-protocol fields match `InfluxDBService` queries.
- **Placeholders:** none — every step has full file contents or an exact command with expected output.
