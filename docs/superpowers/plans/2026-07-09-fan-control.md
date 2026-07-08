# Fan Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users switch a per-hall fan from the PWA via a dedicated sub-screen, with the backend owning the fan's desired state, keep-alive, watchdog, and full switching history.

**Architecture:** The backend gains a shared MQTT connection. A `FanControlManager` builds one `FanController` per fan-enabled hall; each controller runs a state machine, publishes `on`/`off` to the Shelly command topic, consumes the Shelly monitoring messages, arms a watchdog, re-asserts the desired state every 15 min (the Shelly auto-switches off after 1 h), persists desired state + an event log to SQLite, and pushes changes to the frontend over SSE. The frontend shows fan status on the hall screen and provides a switching sub-screen with clear in-flight states.

**Tech Stack:** Backend — Express 4, TypeScript, Drizzle + better-sqlite3, `mqtt`, Zod, Jest. Frontend — React 19, React Router 7, Axios, `@microsoft/fetch-event-source`, Vitest + Testing Library, Tailwind 4.

## Global Constraints

- All code, comments, commit messages in English (UK spelling: colour, behaviour, initialise).
- Node.js 22+ (backend), React 19 (frontend).
- Backend DB access is synchronous better-sqlite3 via Drizzle (`.get()`/`.all()`/`.run()`), snake_case casing.
- Backend InfluxDB queries use InfluxQL — not relevant here (fan state lives in SQLite).
- Config comes from environment variables — never hardcode broker or timing values.
- Backend tests: Jest + ts-jest, files under `backend/tests/`, `testMatch: **/*.test.ts`, in-memory DB via `createTestDb()` / `createDb({path:':memory:'})`, config mocked with `jest.mock('../../src/config', …)`.
- Frontend tests: Vitest + `@testing-library/react`, jsdom, `globals: true`, `@/*` alias.
- Run a single backend test file: `npm test --workspace backend -- <path-substring>`.
- Run a single frontend test file: `npm test --workspace frontend -- <path-substring>`.
- Fan MQTT command payloads are the raw strings `on` / `off` on `{prefix}/command/switch:{switchId}`.
- Dispatch Shelly monitoring messages on the payload `type` field, never on topic (`success` and `safety_shutoff` share `.../monitor/status`).
- Spec: `docs/superpowers/specs/2026-07-09-fan-control-design.md`.

---

## File Structure

**Backend (create unless noted):**
- `backend/src/db/schema.ts` *(modify)* — fan columns on `stocks`; `fanState`, `fanEvents` tables.
- `backend/src/db/types.ts` *(modify)* — `Stock` fan fields.
- `backend/src/db/seed.ts` *(modify)* — Halle 8 fan config.
- `backend/src/db/repositories/stock.repository.ts` *(modify)* — map fan fields.
- `backend/src/db/repositories/fan.repository.ts` — `FanStateRepository`, `FanEventsRepository`.
- `backend/src/db/repositories/index.ts` *(modify)* — export fan repos.
- `backend/drizzle/0001_fan_control.sql` *(generated)* — migration.
- `backend/src/config/index.ts` *(modify)* + `backend/.env.example` *(modify)* — MQTT + fan timing config.
- `backend/src/services/mqtt/mqtt.service.ts` + `backend/src/services/mqtt/index.ts` — MQTT wrapper + real-client factory.
- `backend/src/services/fan/types.ts` — shared fan types.
- `backend/src/services/fan/shelly-message.ts` — parse/validate Shelly monitor payloads.
- `backend/src/services/fan/fan.controller.ts` — per-hall state machine (`FanController`).
- `backend/src/services/fan/fan.manager.ts` — `FanControlManager`.
- `backend/src/services/fan/index.ts` — singleton accessors + test hooks.
- `backend/src/controllers/fan.controller.ts` — HTTP handlers (`FanHttpController`).
- `backend/src/controllers/index.ts` *(modify)* — export.
- `backend/src/middleware/validation.middleware.ts` *(modify)* — `fanCommandSchema`.
- `backend/src/routes/fan.routes.ts` — `createFanRouter()`.
- `backend/src/routes/index.ts` *(modify)* — mount fan router.
- `backend/src/controllers/stocks.controller.ts` *(modify)* — add `fanControlEnabled` to latest readings.
- `backend/src/bootstrap.ts` *(modify)* + `backend/src/index.ts` *(modify)* — init + graceful shutdown.

**Frontend (create unless noted):**
- `frontend/src/types/fan.ts` — fan types.
- `frontend/src/types/api.ts` *(modify)* — `fanControlEnabled` on `LatestReadingsResponse`.
- `frontend/src/api/fan.ts` + `frontend/src/api/index.ts` *(modify)* — fan API + SSE subscribe.
- `frontend/src/api/client.ts` *(modify)* — public `refresh()`.
- `frontend/src/hooks/useFanStream.ts` — live status hook.
- `frontend/src/components/FanStatusCard.tsx` — compact status card.
- `frontend/src/pages/FanControlPage.tsx` — switching sub-screen.
- `frontend/src/App.tsx` *(modify)* — route.
- `frontend/src/pages/StockDetailPage.tsx` *(modify)* — render card + link.

---

## PHASE 1 — BACKEND DATA LAYER

### Task 1: Fan configuration + fan tables (schema, types, seed, repo, migration)

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/types.ts`
- Modify: `backend/src/db/seed.ts`
- Modify: `backend/src/db/repositories/stock.repository.ts`
- Generate: `backend/drizzle/0001_fan_control.sql`
- Test: `backend/tests/db/repositories/stock.repository.test.ts` *(extend — add fan cases)*

**Interfaces:**
- Produces: `stocks` columns `fanControlEnabled: boolean`, `fanTopicPrefix: string | null`, `fanSwitchId: number`; `Stock` fields `fanControlEnabled`, `fanTopicPrefix?`, `fanSwitchId`; Drizzle tables `fanState`, `fanEvents`.

- [ ] **Step 1: Extend the failing repository test**

Append to `backend/tests/db/repositories/stock.repository.test.ts` inside the top-level `describe` (adjust the existing `import` if `createTestDb` is not already imported):

```typescript
describe('fan configuration', () => {
  it('round-trips fan config fields', async () => {
    const testDb = createTestDb();
    const repo = new StockRepository(testDb.db);
    await repo.upsertMany([
      {
        id: 'grain-watch-9',
        name: 'Halle 9',
        deviceCount: 5,
        deviceGroup: 'corn-watch-9',
        devicePrefix: '9',
        hasHumidity: false,
        active: true,
        createdAt: '2026-06-02T00:00:00.000Z',
        fanControlEnabled: true,
        fanTopicPrefix: '/corn-watch/actors/corn-watch-9/fan-control',
        fanSwitchId: 0,
      },
    ]);
    const stock = await repo.findById('grain-watch-9');
    expect(stock?.fanControlEnabled).toBe(true);
    expect(stock?.fanTopicPrefix).toBe('/corn-watch/actors/corn-watch-9/fan-control');
    expect(stock?.fanSwitchId).toBe(0);
  });

  it('defaults fan control to disabled', async () => {
    const testDb = createTestDb();
    const repo = new StockRepository(testDb.db);
    await repo.upsertMany([
      {
        id: 'grain-watch-10',
        name: 'Halle 10',
        deviceCount: 5,
        deviceGroup: 'corn-watch-10',
        devicePrefix: '10',
        hasHumidity: false,
        active: true,
        createdAt: '2026-06-02T00:00:00.000Z',
        fanControlEnabled: false,
        fanSwitchId: 0,
      },
    ]);
    const stock = await repo.findById('grain-watch-10');
    expect(stock?.fanControlEnabled).toBe(false);
    expect(stock?.fanTopicPrefix).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- stock.repository`
Expected: FAIL — `fanControlEnabled` is not a known property / column missing.

- [ ] **Step 3: Add columns + fan tables to `schema.ts`**

In `backend/src/db/schema.ts`, replace the `stocks` table definition with:

```typescript
export const stocks = sqliteTable('stocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  deviceCount: integer('device_count').notNull(),
  deviceGroup: text('device_group').notNull(),
  devicePrefix: text('device_prefix').notNull(),
  hasHumidity: integer('has_humidity', { mode: 'boolean' }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  fanControlEnabled: integer('fan_control_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  fanTopicPrefix: text('fan_topic_prefix'),
  fanSwitchId: integer('fan_switch_id').notNull().default(0),
});

export const fanState = sqliteTable('fan_state', {
  stockId: text('stock_id')
    .primaryKey()
    .references(() => stocks.id, { onDelete: 'cascade' }),
  desiredOn: integer('desired_on', { mode: 'boolean' }).notNull().default(false),
  since: text('since'),
  lastCommandAt: text('last_command_at'),
  updatedAt: text('updated_at').notNull(),
});

export const fanEvents = sqliteTable(
  'fan_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stockId: text('stock_id')
      .notNull()
      .references(() => stocks.id, { onDelete: 'cascade' }),
    ts: text('ts').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload'),
    source: text('source').notNull(),
  },
  (table) => ({
    stockTsIdx: index('fan_events_stock_ts_idx').on(table.stockId, table.ts),
  })
);
```

Then add to the type exports at the bottom of the file:

```typescript
export type DbFanState = typeof fanState.$inferSelect;
export type DbFanEvent = typeof fanEvents.$inferSelect;
```

- [ ] **Step 4: Extend `Stock` in `types.ts`**

In `backend/src/db/types.ts`, replace the `Stock` interface with:

```typescript
export interface Stock {
  id: string;
  name: string;
  description?: string;
  deviceCount: number;
  deviceGroup: string;
  devicePrefix: string;
  hasHumidity: boolean;
  active: boolean;
  createdAt: string;
  fanControlEnabled: boolean;
  fanTopicPrefix?: string;
  fanSwitchId: number;
}
```

- [ ] **Step 5: Map fan fields in `stock.repository.ts`**

In `backend/src/db/repositories/stock.repository.ts`, update `upsertMany`'s value mapper to include the fan columns, and `toStock` to read them. Replace the value object inside `.values(values.map(...))` with:

```typescript
        values.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          deviceCount: s.deviceCount,
          deviceGroup: s.deviceGroup,
          devicePrefix: s.devicePrefix,
          hasHumidity: s.hasHumidity,
          active: s.active,
          createdAt: s.createdAt,
          fanControlEnabled: s.fanControlEnabled,
          fanTopicPrefix: s.fanTopicPrefix ?? null,
          fanSwitchId: s.fanSwitchId,
        }))
```

Replace `toStock` with:

```typescript
  private toStock(row: typeof stocks.$inferSelect): Stock {
    const stock: Stock = {
      id: row.id,
      name: row.name,
      deviceCount: row.deviceCount,
      deviceGroup: row.deviceGroup,
      devicePrefix: row.devicePrefix,
      hasHumidity: row.hasHumidity,
      active: row.active,
      createdAt: row.createdAt,
      fanControlEnabled: row.fanControlEnabled,
      fanSwitchId: row.fanSwitchId,
    };
    if (row.description !== null) {
      stock.description = row.description;
    }
    if (row.fanTopicPrefix !== null) {
      stock.fanTopicPrefix = row.fanTopicPrefix;
    }
    return stock;
  }
```

- [ ] **Step 6: Seed Halle 8 fan config**

In `backend/src/db/seed.ts`, update the two seed entries. Add to `grain-watch-1` (Halle 8):

```typescript
    fanControlEnabled: true,
    fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control',
    fanSwitchId: 0,
```

Add to `grain-watch-2` (Halle 7):

```typescript
    fanControlEnabled: false,
    fanSwitchId: 0,
```

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate --workspace backend`
Expected: a new file `backend/drizzle/0001_fan_control.sql` appears (adds columns + `fan_state` + `fan_events`). Inspect it to confirm it only alters `stocks` and creates the two tables.

- [ ] **Step 8: Run tests**

Run: `npm test --workspace backend -- stock.repository`
Expected: PASS. Also run `npm test --workspace backend -- seed` — existing seed test should still PASS (upsert ignores conflicts).

- [ ] **Step 9: Commit**

```bash
git add backend/src/db backend/drizzle backend/tests/db/repositories/stock.repository.test.ts
git commit -m "feat(backend): add fan control config columns and fan tables"
```

---

### Task 2: Fan state + events repositories

**Files:**
- Create: `backend/src/db/repositories/fan.repository.ts`
- Modify: `backend/src/db/repositories/index.ts`
- Test: `backend/tests/db/repositories/fan.repository.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1 tables).
- Produces:
  - `class FanStateRepository { get(stockId): DbFanState | null; upsert(row: { stockId; desiredOn; since: string | null; lastCommandAt: string | null; updatedAt: string }): void; }`
  - `class FanEventsRepository { insert(row: { stockId; ts; kind; payload: unknown; source }): void; listRecent(stockId, limit): FanEvent[]; deleteOlderThan(cutoffIso): number; }`
  - `interface FanEvent { id: number; stockId: string; ts: string; kind: string; payload: unknown; source: string; }`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/db/repositories/fan.repository.test.ts`:

```typescript
import { createTestDb } from '../../setup/db';
import { StockRepository } from '../../../src/db/repositories';
import { FanStateRepository, FanEventsRepository } from '../../../src/db/repositories/fan.repository';

async function seedStock(db: ReturnType<typeof createTestDb>): Promise<void> {
  await new StockRepository(db.db).upsertMany([
    {
      id: 'grain-watch-1', name: 'Halle 8', deviceCount: 5, deviceGroup: 'corn-watch-1',
      devicePrefix: '1', hasHumidity: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
      fanControlEnabled: true, fanTopicPrefix: '/p', fanSwitchId: 0,
    },
  ]);
}

describe('FanStateRepository', () => {
  it('upserts and reads desired state', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new FanStateRepository(db.db);
    expect(repo.get('grain-watch-1')).toBeNull();
    repo.upsert({ stockId: 'grain-watch-1', desiredOn: true, since: '2026-07-09T10:00:00.000Z', lastCommandAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-09T10:00:00.000Z' });
    expect(repo.get('grain-watch-1')?.desiredOn).toBe(true);
    repo.upsert({ stockId: 'grain-watch-1', desiredOn: false, since: null, lastCommandAt: '2026-07-09T11:00:00.000Z', updatedAt: '2026-07-09T11:00:00.000Z' });
    expect(repo.get('grain-watch-1')?.desiredOn).toBe(false);
  });
});

describe('FanEventsRepository', () => {
  it('inserts, lists newest first, and prunes by cutoff', async () => {
    const db = createTestDb();
    await seedStock(db);
    const repo = new FanEventsRepository(db.db);
    repo.insert({ stockId: 'grain-watch-1', ts: '2026-01-01T00:00:00.000Z', kind: 'command', payload: { action: 'on' }, source: 'user' });
    repo.insert({ stockId: 'grain-watch-1', ts: '2026-07-09T00:00:00.000Z', kind: 'success', payload: { switchState: true }, source: 'shelly' });

    const recent = repo.listRecent('grain-watch-1', 50);
    expect(recent).toHaveLength(2);
    expect(recent[0].kind).toBe('success');
    expect(recent[0].payload).toEqual({ switchState: true });

    const deleted = repo.deleteOlderThan('2026-06-01T00:00:00.000Z');
    expect(deleted).toBe(1);
    expect(repo.listRecent('grain-watch-1', 50)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- fan.repository`
Expected: FAIL — cannot find module `fan.repository`.

- [ ] **Step 3: Implement the repositories**

Create `backend/src/db/repositories/fan.repository.ts`:

```typescript
import { eq, desc, lt, sql } from 'drizzle-orm';
import type { Db } from '../types';
import { fanState, fanEvents } from '../schema';
import type { DbFanState } from '../schema';

export interface FanEvent {
  id: number;
  stockId: string;
  ts: string;
  kind: string;
  payload: unknown;
  source: string;
}

export interface FanStateUpsert {
  stockId: string;
  desiredOn: boolean;
  since: string | null;
  lastCommandAt: string | null;
  updatedAt: string;
}

export class FanStateRepository {
  constructor(private readonly db: Db) {}

  get(stockId: string): DbFanState | null {
    return (
      this.db.select().from(fanState).where(eq(fanState.stockId, stockId)).get() ?? null
    );
  }

  upsert(row: FanStateUpsert): void {
    this.db
      .insert(fanState)
      .values(row)
      .onConflictDoUpdate({
        target: fanState.stockId,
        set: {
          desiredOn: row.desiredOn,
          since: row.since,
          lastCommandAt: row.lastCommandAt,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
}

export interface FanEventInsert {
  stockId: string;
  ts: string;
  kind: string;
  payload: unknown;
  source: string;
}

export class FanEventsRepository {
  constructor(private readonly db: Db) {}

  insert(row: FanEventInsert): void {
    this.db
      .insert(fanEvents)
      .values({
        stockId: row.stockId,
        ts: row.ts,
        kind: row.kind,
        payload: row.payload === undefined ? null : JSON.stringify(row.payload),
        source: row.source,
      })
      .run();
  }

  listRecent(stockId: string, limit: number): FanEvent[] {
    const rows = this.db
      .select()
      .from(fanEvents)
      .where(eq(fanEvents.stockId, stockId))
      .orderBy(desc(fanEvents.ts), desc(fanEvents.id))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      stockId: r.stockId,
      ts: r.ts,
      kind: r.kind,
      payload: r.payload !== null ? JSON.parse(r.payload) : null,
      source: r.source,
    }));
  }

  deleteOlderThan(cutoffIso: string): number {
    const result = this.db
      .delete(fanEvents)
      .where(lt(fanEvents.ts, cutoffIso))
      .run();
    return result.changes;
  }
}
```

Note: `sql` import is unused — remove it if the linter flags it.

- [ ] **Step 4: Export from repositories index**

In `backend/src/db/repositories/index.ts`, add:

```typescript
export { FanStateRepository, FanEventsRepository } from './fan.repository';
export type { FanEvent, FanEventInsert, FanStateUpsert } from './fan.repository';
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace backend -- fan.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/repositories
git commit -m "feat(backend): add fan state and events repositories"
```

---

## PHASE 2 — BACKEND CONFIG + MQTT

### Task 3: MQTT + fan timing configuration

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `backend/.env.example`
- Test: `backend/tests/unit/config.test.ts` *(extend)*

**Interfaces:**
- Produces: `config.mqtt: { url: string; username?: string; password?: string }` and `config.fan: { keepAliveMs: number; watchdogMs: number; retentionDays: number; retentionSweepMs: number }`.

- [ ] **Step 1: Extend the failing config test**

Append to `backend/tests/unit/config.test.ts` (inside the existing top-level `describe`; the file already imports config dynamically — mirror its pattern of setting `process.env` then `await import('../../src/config')`):

```typescript
describe('fan/mqtt config', () => {
  it('provides mqtt and fan defaults', async () => {
    jest.resetModules();
    process.env['NODE_ENV'] = 'development';
    const { config } = await import('../../src/config');
    expect(config.fan.keepAliveMs).toBe(900000);
    expect(config.fan.watchdogMs).toBe(10000);
    expect(config.fan.retentionDays).toBe(90);
    expect(config.mqtt.url).toBe('mqtt://localhost:1883');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- config`
Expected: FAIL — `config.fan` / `config.mqtt` undefined.

- [ ] **Step 3: Add config interfaces + values**

In `backend/src/config/index.ts`, add these interfaces near the other `interface` declarations:

```typescript
/** MQTT broker connection configuration (backend-wide). */
interface MqttConfig {
  /** Broker URL, e.g. 'mqtt://host:1883' or 'mqtts://host:8883' */
  url: string;
  /** Broker username (optional) */
  username?: string;
  /** Broker password (optional) */
  password?: string;
}

/** Fan-control timing configuration. */
interface FanConfig {
  /** Interval to re-assert the desired ON state (ms). Must be < Shelly Auto OFF (1 h). */
  keepAliveMs: number;
  /** Time to wait for a Shelly success after an ON command before switching off (ms). */
  watchdogMs: number;
  /** Days to retain fan_events rows. */
  retentionDays: number;
  /** Interval of the retention sweep (ms). */
  retentionSweepMs: number;
}
```

Add `mqtt` and `fan` to the `Config` interface:

```typescript
  /** MQTT broker settings */
  mqtt: MqttConfig;

  /** Fan-control timing settings */
  fan: FanConfig;
```

Add to the exported `config` object (after `database`):

```typescript
  mqtt: {
    url: getEnvVar('MQTT_URL', 'mqtt://localhost:1883'),
    username: process.env['MQTT_USERNAME'] || undefined,
    password: process.env['MQTT_PASSWORD'] || undefined,
  },
  fan: {
    keepAliveMs: getEnvVarAsInt('FAN_KEEPALIVE_INTERVAL_MS', 900000),
    watchdogMs: getEnvVarAsInt('FAN_WATCHDOG_TIMEOUT_MS', 10000),
    retentionDays: getEnvVarAsInt('FAN_EVENT_RETENTION_DAYS', 90),
    retentionSweepMs: getEnvVarAsInt('FAN_RETENTION_SWEEP_INTERVAL_MS', 21600000),
  },
```

Add to the `export type { ... }` line: `MqttConfig`, `FanConfig`.

In `validateConfig`, after the InfluxDB URL check, add:

```typescript
  // Validate MQTT URL format
  try {
    new URL(cfg.mqtt.url);
  } catch {
    errors.push(`MQTT_URL must be a valid URL, got: ${cfg.mqtt.url}`);
  }
  if (cfg.fan.keepAliveMs >= 3600000) {
    errors.push('FAN_KEEPALIVE_INTERVAL_MS must be under 3600000 (Shelly Auto OFF is 1 h)');
  }
```

- [ ] **Step 4: Document in `.env.example`**

Append to `backend/.env.example`:

```
# MQTT broker (backend-wide; fan control)
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=

# Fan control timing
FAN_KEEPALIVE_INTERVAL_MS=900000
FAN_WATCHDOG_TIMEOUT_MS=10000
FAN_EVENT_RETENTION_DAYS=90
FAN_RETENTION_SWEEP_INTERVAL_MS=21600000
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace backend -- config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config backend/.env.example backend/tests/unit/config.test.ts
git commit -m "feat(backend): add mqtt and fan timing configuration"
```

---

### Task 4: MQTT service wrapper

**Files:**
- Create: `backend/src/services/mqtt/mqtt.service.ts`
- Create: `backend/src/services/mqtt/index.ts`
- Test: `backend/tests/unit/services/mqtt.service.test.ts`
- Modify: `backend/package.json` (add `mqtt` dependency)

**Interfaces:**
- Produces:
  - `interface MqttClientLike { publish(topic: string, message: string): void; subscribe(topic: string): void; on(event: 'message', cb: (topic: string, payload: Buffer) => void): void; on(event: 'connect', cb: () => void): void; end(): void; }`
  - `class MqttService { constructor(client: MqttClientLike); publish(topic, message): void; subscribe(topic): void; onMessage(listener: (topic: string, payload: string) => void): void; onConnect(cb: () => void): void; end(): void; }`
  - `function createMqttClient(cfg: { url; username?; password? }): MqttClientLike`

- [ ] **Step 1: Add the `mqtt` dependency**

Run: `npm install mqtt --workspace backend`
Expected: `mqtt` appears in `backend/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/unit/services/mqtt.service.test.ts`:

```typescript
import { MqttService, MqttClientLike } from '../../../src/services/mqtt/mqtt.service';

function fakeClient() {
  const handlers: { message: Array<(t: string, p: Buffer) => void>; connect: Array<() => void> } = {
    message: [], connect: [],
  };
  const published: Array<{ topic: string; message: string }> = [];
  const subscribed: string[] = [];
  const client: MqttClientLike = {
    publish: (topic, message) => { published.push({ topic, message }); },
    subscribe: (topic) => { subscribed.push(topic); },
    on: ((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'message') handlers.message.push(cb as (t: string, p: Buffer) => void);
      if (event === 'connect') handlers.connect.push(cb as () => void);
    }) as MqttClientLike['on'],
    end: () => {},
  };
  return { client, handlers, published, subscribed };
}

describe('MqttService', () => {
  it('forwards decoded messages to listeners', () => {
    const { client, handlers } = fakeClient();
    const svc = new MqttService(client);
    const received: Array<{ topic: string; payload: string }> = [];
    svc.onMessage((topic, payload) => received.push({ topic, payload }));
    handlers.message[0]('/p/monitor/status', Buffer.from('{"type":"success"}'));
    expect(received).toEqual([{ topic: '/p/monitor/status', payload: '{"type":"success"}' }]);
  });

  it('publishes and subscribes through the client', () => {
    const { client, published, subscribed } = fakeClient();
    const svc = new MqttService(client);
    svc.publish('/p/command/switch:0', 'on');
    svc.subscribe('/p/monitor/#');
    expect(published).toEqual([{ topic: '/p/command/switch:0', message: 'on' }]);
    expect(subscribed).toEqual(['/p/monitor/#']);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `npm test --workspace backend -- mqtt.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `mqtt.service.ts`**

Create `backend/src/services/mqtt/mqtt.service.ts`:

```typescript
export interface MqttClientLike {
  publish(topic: string, message: string): void;
  subscribe(topic: string): void;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): void;
  on(event: 'connect', cb: () => void): void;
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

  onConnect(cb: () => void): void {
    this.client.on('connect', cb);
  }

  end(): void {
    this.client.end();
  }
}
```

- [ ] **Step 5: Implement the real-client factory `index.ts`**

Create `backend/src/services/mqtt/index.ts`:

```typescript
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
    username: cfg.username,
    password: cfg.password,
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
```

- [ ] **Step 6: Run tests**

Run: `npm test --workspace backend -- mqtt.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/mqtt backend/tests/unit/services/mqtt.service.test.ts backend/package.json package-lock.json
git commit -m "feat(backend): add mqtt service wrapper and client factory"
```

---

### Task 5: Shelly monitor message parsing

**Files:**
- Create: `backend/src/services/fan/types.ts`
- Create: `backend/src/services/fan/shelly-message.ts`
- Test: `backend/tests/unit/services/shelly-message.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  - `type FanState = 'OFF' | 'TURN_ON_PENDING' | 'ON' | 'TURN_OFF_PENDING' | 'FAULT';`
  - `type ShellyMessageType = 'success' | 'warning' | 'alert' | 'safety_shutoff';`
  - `interface ShellyMonitorMessage { type: ShellyMessageType; message: string; switchState: boolean; inputState: boolean; timestamp: number; }`
  - `type FanEventKind = 'command' | 'success' | 'safety_shutoff' | 'warning' | 'alert' | 'status' | 'online_change' | 'watchdog_off' | 'recovery';`
  - `interface FanStatus { stockId: string; state: FanState; desiredOn: boolean; shellyOnline: boolean | null; lastWarning: { message: string; ts: string } | null; lastAlert: { message: string; ts: string } | null; since: string | null; updatedAt: string; }`
- Produces (in `shelly-message.ts`): `function parseShellyMonitorMessage(raw: string): ShellyMonitorMessage | null`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/services/shelly-message.test.ts`:

```typescript
import { parseShellyMonitorMessage } from '../../../src/services/fan/shelly-message';

describe('parseShellyMonitorMessage', () => {
  it('parses a success payload', () => {
    const msg = parseShellyMonitorMessage(
      '{"type":"success","message":"Contactor switched correctly","switchState":true,"inputState":true,"timestamp":123}'
    );
    expect(msg).toEqual({
      type: 'success', message: 'Contactor switched correctly',
      switchState: true, inputState: true, timestamp: 123,
    });
  });

  it('parses safety_shutoff', () => {
    const msg = parseShellyMonitorMessage(
      '{"type":"safety_shutoff","message":"x","switchState":false,"inputState":false,"timestamp":1}'
    );
    expect(msg?.type).toBe('safety_shutoff');
  });

  it('returns null for unknown type', () => {
    expect(parseShellyMonitorMessage('{"type":"nope","message":"x","switchState":true,"inputState":true,"timestamp":1}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseShellyMonitorMessage('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseShellyMonitorMessage('{"type":"success"}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- shelly-message`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `types.ts`**

Create `backend/src/services/fan/types.ts`:

```typescript
export type FanState =
  | 'OFF'
  | 'TURN_ON_PENDING'
  | 'ON'
  | 'TURN_OFF_PENDING'
  | 'FAULT';

export type ShellyMessageType = 'success' | 'warning' | 'alert' | 'safety_shutoff';

export interface ShellyMonitorMessage {
  type: ShellyMessageType;
  message: string;
  switchState: boolean;
  inputState: boolean;
  timestamp: number;
}

export type FanEventKind =
  | 'command'
  | 'success'
  | 'safety_shutoff'
  | 'warning'
  | 'alert'
  | 'status'
  | 'online_change'
  | 'watchdog_off'
  | 'recovery';

export interface FanStatus {
  stockId: string;
  state: FanState;
  desiredOn: boolean;
  shellyOnline: boolean | null;
  lastWarning: { message: string; ts: string } | null;
  lastAlert: { message: string; ts: string } | null;
  since: string | null;
  updatedAt: string;
}
```

- [ ] **Step 4: Implement `shelly-message.ts`**

Create `backend/src/services/fan/shelly-message.ts`:

```typescript
import { ShellyMessageType, ShellyMonitorMessage } from './types';

const VALID_TYPES: ShellyMessageType[] = ['success', 'warning', 'alert', 'safety_shutoff'];

/**
 * Parses a Shelly monitor payload. Returns null for malformed JSON, unknown
 * `type`, or missing/mis-typed fields. Dispatch downstream on `.type`.
 */
export function parseShellyMonitorMessage(raw: string): ShellyMonitorMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o['type'] !== 'string' || !VALID_TYPES.includes(o['type'] as ShellyMessageType)) {
    return null;
  }
  if (
    typeof o['message'] !== 'string' ||
    typeof o['switchState'] !== 'boolean' ||
    typeof o['inputState'] !== 'boolean' ||
    typeof o['timestamp'] !== 'number'
  ) {
    return null;
  }
  return {
    type: o['type'] as ShellyMessageType,
    message: o['message'] as string,
    switchState: o['switchState'] as boolean,
    inputState: o['inputState'] as boolean,
    timestamp: o['timestamp'] as number,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace backend -- shelly-message`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/fan/types.ts backend/src/services/fan/shelly-message.ts backend/tests/unit/services/shelly-message.test.ts
git commit -m "feat(backend): add fan types and shelly message parser"
```

---

## PHASE 3 — BACKEND FAN STATE MACHINE

### Task 6: FanController state machine

**Files:**
- Create: `backend/src/services/fan/fan.controller.ts`
- Test: `backend/tests/unit/services/fan.controller.test.ts`

**Interfaces:**
- Consumes: `FanStateRepository`, `FanEventsRepository` (Task 2); `ShellyMonitorMessage`, `FanStatus`, `FanState` (Task 5).
- Produces:
  ```typescript
  interface FanControllerDeps {
    stockId: string;
    publish: (payload: 'on' | 'off') => void;   // wired to MQTT command topic
    stateRepo: FanStateRepository;
    eventsRepo: FanEventsRepository;
    timings: { keepAliveMs: number; watchdogMs: number };
    now?: () => Date;
  }
  class FanController {
    constructor(deps: FanControllerDeps);
    recover(): void;                             // resume desired=on at boot
    command(action: 'on' | 'off', source: 'user'): void;
    handleShellyMessage(msg: ShellyMonitorMessage): void;
    handleStatus(raw: string): void;             // generic status update, logged
    handleOnline(online: boolean): void;
    getStatus(): FanStatus;
    getRecentEvents(limit: number): import('../../db/repositories/fan.repository').FanEvent[];
    onChange(listener: (status: FanStatus) => void): () => void;  // returns unsubscribe
    stop(): void;                                // clears timers
  }
  ```

- [ ] **Step 1: Write the failing test (state transitions + watchdog + keep-alive + recovery)**

Create `backend/tests/unit/services/fan.controller.test.ts`:

```typescript
import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanController } from '../../../src/services/fan/fan.controller';
import type { ShellyMonitorMessage } from '../../../src/services/fan/types';

function successMsg(switchState: boolean): ShellyMonitorMessage {
  return { type: 'success', message: 'ok', switchState, inputState: switchState, timestamp: 1 };
}

async function makeController() {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceCount: 5, deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/p', fanSwitchId: 0,
  }]);
  const published: Array<'on' | 'off'> = [];
  const controller = new FanController({
    stockId: 'grain-watch-1',
    publish: (p) => published.push(p),
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000 },
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, controller, published };
}

describe('FanController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('goes OFF -> TURN_ON_PENDING -> ON on success', async () => {
    const { controller, published } = await makeController();
    expect(controller.getStatus().state).toBe('OFF');
    controller.command('on', 'user');
    expect(controller.getStatus().state).toBe('TURN_ON_PENDING');
    expect(published).toEqual(['on']);
    controller.handleShellyMessage(successMsg(true));
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().desiredOn).toBe(true);
  });

  it('watchdog switches off and faults when no success arrives', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    jest.advanceTimersByTime(10000);
    expect(published).toEqual(['on', 'off']);
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
  });

  it('re-asserts ON via keep-alive while desired on', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on', 'on']);
  });

  it('alert -> FAULT, desired off, stops keep-alive', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'alert', message: 'no follow', switchState: true, inputState: false, timestamp: 2 });
    expect(controller.getStatus().state).toBe('FAULT');
    expect(controller.getStatus().desiredOn).toBe(false);
    jest.advanceTimersByTime(900000);
    expect(published).toEqual(['on']); // no keep-alive re-assert after fault
  });

  it('warning only sets overlay, no state change', async () => {
    const { controller } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.handleShellyMessage({ type: 'warning', message: 'manual', switchState: true, inputState: true, timestamp: 3 });
    expect(controller.getStatus().state).toBe('ON');
    expect(controller.getStatus().lastWarning?.message).toBe('manual');
  });

  it('command off -> TURN_OFF_PENDING -> OFF on success(false)', async () => {
    const { controller, published } = await makeController();
    controller.command('on', 'user');
    controller.handleShellyMessage(successMsg(true));
    controller.command('off', 'user');
    expect(controller.getStatus().state).toBe('TURN_OFF_PENDING');
    expect(published).toEqual(['on', 'off']);
    controller.handleShellyMessage(successMsg(false));
    expect(controller.getStatus().state).toBe('OFF');
  });

  it('recover() resumes ON intent from persisted state', async () => {
    const { db, published } = await makeController();
    new FanStateRepository(db.db).upsert({
      stockId: 'grain-watch-1', desiredOn: true, since: '2026-07-09T09:00:00.000Z',
      lastCommandAt: '2026-07-09T09:00:00.000Z', updatedAt: '2026-07-09T09:00:00.000Z',
    });
    const controller2 = new FanController({
      stockId: 'grain-watch-1', publish: (p) => published.push(p),
      stateRepo: new FanStateRepository(db.db), eventsRepo: new FanEventsRepository(db.db),
      timings: { keepAliveMs: 900000, watchdogMs: 10000 }, now: () => new Date('2026-07-09T10:00:00.000Z'),
    });
    controller2.recover();
    expect(controller2.getStatus().state).toBe('TURN_ON_PENDING');
    expect(published).toContain('on');
  });

  it('notifies onChange listeners', async () => {
    const { controller } = await makeController();
    const seen: string[] = [];
    controller.onChange((s) => seen.push(s.state));
    controller.command('on', 'user');
    expect(seen).toContain('TURN_ON_PENDING');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- fan.controller`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fan.controller.ts`**

Create `backend/src/services/fan/fan.controller.ts`:

```typescript
import type { FanStateRepository, FanEventsRepository, FanEvent } from '../../db/repositories/fan.repository';
import type { FanState, FanStatus, FanEventKind, ShellyMonitorMessage } from './types';

export interface FanControllerDeps {
  stockId: string;
  publish: (payload: 'on' | 'off') => void;
  stateRepo: FanStateRepository;
  eventsRepo: FanEventsRepository;
  timings: { keepAliveMs: number; watchdogMs: number };
  now?: () => Date;
}

type ChangeListener = (status: FanStatus) => void;

/**
 * Per-hall fan state machine. Owns desired state, watchdog and keep-alive
 * timers, consumes Shelly monitor messages, and persists an event log.
 */
export class FanController {
  private readonly deps: FanControllerDeps;
  private readonly now: () => Date;
  private state: FanState = 'OFF';
  private desiredOn = false;
  private since: string | null = null;
  private shellyOnline: boolean | null = null;
  private lastWarning: { message: string; ts: string } | null = null;
  private lastAlert: { message: string; ts: string } | null = null;
  private updatedAt: string;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: ChangeListener[] = [];

  constructor(deps: FanControllerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.updatedAt = this.now().toISOString();
  }

  recover(): void {
    const persisted = this.deps.stateRepo.get(this.deps.stockId);
    if (persisted?.desiredOn) {
      this.since = persisted.since;
      this.log('recovery', { resumedDesiredOn: true }, 'backend');
      this.beginTurnOn('backend', false);
    }
  }

  command(action: 'on' | 'off', source: 'user'): void {
    if (action === 'on') {
      this.since = this.now().toISOString();
      this.beginTurnOn(source, true);
    } else {
      this.beginTurnOff(source);
    }
  }

  handleShellyMessage(msg: ShellyMonitorMessage): void {
    const ts = this.now().toISOString();
    switch (msg.type) {
      case 'success':
        this.log('success', msg, 'shelly');
        this.clearWatchdog();
        if (msg.switchState) {
          this.setState('ON');
          this.ensureKeepAlive();
        } else {
          this.setState('OFF');
          this.clearKeepAlive();
        }
        break;
      case 'warning':
        this.lastWarning = { message: msg.message, ts };
        this.log('warning', msg, 'shelly');
        this.emit();
        break;
      case 'alert':
        this.lastAlert = { message: msg.message, ts };
        this.log('alert', msg, 'shelly');
        this.enterFault();
        break;
      case 'safety_shutoff':
        this.lastAlert = { message: msg.message, ts };
        this.log('safety_shutoff', msg, 'shelly');
        this.enterFault();
        break;
    }
  }

  handleStatus(raw: string): void {
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* keep raw string */ }
    this.log('status', payload, 'shelly');
  }

  handleOnline(online: boolean): void {
    if (this.shellyOnline === online) return;
    this.shellyOnline = online;
    this.log('online_change', { online }, 'shelly');
    this.emit();
  }

  getStatus(): FanStatus {
    return {
      stockId: this.deps.stockId,
      state: this.state,
      desiredOn: this.desiredOn,
      shellyOnline: this.shellyOnline,
      lastWarning: this.lastWarning,
      lastAlert: this.lastAlert,
      since: this.since,
      updatedAt: this.updatedAt,
    };
  }

  getRecentEvents(limit: number): FanEvent[] {
    return this.deps.eventsRepo.listRecent(this.deps.stockId, limit);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  stop(): void {
    this.clearWatchdog();
    this.clearKeepAlive();
  }

  // --- internals ---

  private beginTurnOn(source: 'user' | 'backend', persist: boolean): void {
    this.desiredOn = true;
    if (persist) this.persistState();
    this.setState('TURN_ON_PENDING');
    this.log('command', { action: 'on' }, source);
    this.deps.publish('on');
    this.armWatchdog();
    this.ensureKeepAlive();
  }

  private beginTurnOff(source: 'user'): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('TURN_OFF_PENDING');
    this.log('command', { action: 'off' }, source);
    this.deps.publish('off');
  }

  private enterFault(): void {
    this.desiredOn = false;
    this.since = null;
    this.persistState();
    this.clearWatchdog();
    this.clearKeepAlive();
    this.setState('FAULT');
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.deps.publish('off');
      this.log('watchdog_off', { reason: 'no success within watchdog window' }, 'backend');
      this.enterFault();
    }, this.deps.timings.watchdogMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
  }

  private ensureKeepAlive(): void {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (!this.desiredOn) return;
      this.deps.publish('on');
      this.log('command', { action: 'on', keepAlive: true }, 'backend');
    }, this.deps.timings.keepAliveMs);
  }

  private clearKeepAlive(): void {
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
  }

  private setState(next: FanState): void {
    this.state = next;
    this.updatedAt = this.now().toISOString();
    this.emit();
  }

  private persistState(): void {
    const nowIso = this.now().toISOString();
    this.deps.stateRepo.upsert({
      stockId: this.deps.stockId,
      desiredOn: this.desiredOn,
      since: this.since,
      lastCommandAt: nowIso,
      updatedAt: nowIso,
    });
  }

  private log(kind: FanEventKind, payload: unknown, source: 'user' | 'shelly' | 'backend'): void {
    this.deps.eventsRepo.insert({
      stockId: this.deps.stockId,
      ts: this.now().toISOString(),
      kind,
      payload,
      source,
    });
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace backend -- fan.controller`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fan/fan.controller.ts backend/tests/unit/services/fan.controller.test.ts
git commit -m "feat(backend): add fan controller state machine"
```

---

### Task 7: FanControlManager (wiring, routing, recovery, retention)

**Files:**
- Create: `backend/src/services/fan/fan.manager.ts`
- Create: `backend/src/services/fan/index.ts`
- Test: `backend/tests/unit/services/fan.manager.test.ts`

**Interfaces:**
- Consumes: `MqttService` (Task 4), `FanController` (Task 6), `StockRepository`, fan repos, `parseShellyMonitorMessage` (Task 5).
- Produces:
  ```typescript
  interface FanManagerDeps {
    stocks: Array<{ stockId: string; topicPrefix: string; switchId: number }>;
    mqtt: { publish(topic: string, message: string): void; subscribe(topic: string): void; onMessage(l: (t: string, p: string) => void): void };
    stateRepo: FanStateRepository;
    eventsRepo: FanEventsRepository;
    timings: { keepAliveMs: number; watchdogMs: number; retentionDays: number; retentionSweepMs: number };
    now?: () => Date;
  }
  class FanControlManager {
    constructor(deps: FanManagerDeps);
    init(): void;                          // subscribe, recover, start retention sweep
    isFanStock(stockId: string): boolean;
    getController(stockId: string): FanController | null;
    shutdown(): void;
  }
  ```
  Singleton accessors in `index.ts`: `setFanManager(m | null)`, `getFanManager(): FanControlManager | null`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/services/fan.manager.test.ts`:

```typescript
import { createTestDb } from '../../setup/db';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../../src/db/repositories';
import { FanControlManager } from '../../../src/services/fan/fan.manager';

function fakeMqtt() {
  const published: Array<{ topic: string; message: string }> = [];
  const subscribed: string[] = [];
  let handler: ((t: string, p: string) => void) | null = null;
  return {
    published, subscribed,
    emit: (t: string, p: string) => handler?.(t, p),
    mqtt: {
      publish: (topic: string, message: string) => { published.push({ topic, message }); },
      subscribe: (topic: string) => { subscribed.push(topic); },
      onMessage: (l: (t: string, p: string) => void) => { handler = l; },
    },
  };
}

async function setup() {
  const db = createTestDb();
  await new StockRepository(db.db).upsertMany([{
    id: 'grain-watch-1', name: 'Halle 8', deviceCount: 5, deviceGroup: 'corn-watch-1',
    devicePrefix: '1', hasHumidity: true, active: true, createdAt: '2026-06-02T00:00:00.000Z',
    fanControlEnabled: true, fanTopicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', fanSwitchId: 0,
  }]);
  const f = fakeMqtt();
  const manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/corn-watch/actors/corn-watch-1/fan-control', switchId: 0 }],
    mqtt: f.mqtt,
    stateRepo: new FanStateRepository(db.db),
    eventsRepo: new FanEventsRepository(db.db),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000 },
    now: () => new Date('2026-07-09T10:00:00.000Z'),
  });
  return { db, manager, f };
}

describe('FanControlManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('subscribes to monitor + online topics on init', async () => {
    const { manager, f } = await setup();
    manager.init();
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/monitor/#');
    expect(f.subscribed).toContain('/corn-watch/actors/corn-watch-1/fan-control/online');
  });

  it('routes a monitor success message to the controller', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.getController('grain-watch-1')!.command('on', 'user');
    f.emit(
      '/corn-watch/actors/corn-watch-1/fan-control/monitor/status',
      '{"type":"success","message":"ok","switchState":true,"inputState":true,"timestamp":1}'
    );
    expect(manager.getController('grain-watch-1')!.getStatus().state).toBe('ON');
  });

  it('routes online LWT to the controller overlay', async () => {
    const { manager, f } = await setup();
    manager.init();
    f.emit('/corn-watch/actors/corn-watch-1/fan-control/online', 'true');
    expect(manager.getController('grain-watch-1')!.getStatus().shellyOnline).toBe(true);
  });

  it('publishes to the command topic when the controller acts', async () => {
    const { manager, f } = await setup();
    manager.init();
    manager.getController('grain-watch-1')!.command('on', 'user');
    expect(f.published).toContainEqual({ topic: '/corn-watch/actors/corn-watch-1/fan-control/command/switch:0', message: 'on' });
  });

  it('reports non-fan stocks as unknown', async () => {
    const { manager } = await setup();
    manager.init();
    expect(manager.isFanStock('grain-watch-1')).toBe(true);
    expect(manager.isFanStock('grain-watch-2')).toBe(false);
    expect(manager.getController('grain-watch-2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- fan.manager`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fan.manager.ts`**

Create `backend/src/services/fan/fan.manager.ts`:

```typescript
import type { FanStateRepository, FanEventsRepository } from '../../db/repositories/fan.repository';
import { FanController } from './fan.controller';
import { parseShellyMonitorMessage } from './shelly-message';

export interface FanManagerDeps {
  stocks: Array<{ stockId: string; topicPrefix: string; switchId: number }>;
  mqtt: {
    publish(topic: string, message: string): void;
    subscribe(topic: string): void;
    onMessage(listener: (topic: string, payload: string) => void): void;
  };
  stateRepo: FanStateRepository;
  eventsRepo: FanEventsRepository;
  timings: { keepAliveMs: number; watchdogMs: number; retentionDays: number; retentionSweepMs: number };
  now?: () => Date;
}

interface HallWiring {
  stockId: string;
  topicPrefix: string;
  commandTopic: string;
  controller: FanController;
}

export class FanControlManager {
  private readonly halls = new Map<string, HallWiring>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: FanManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    for (const s of deps.stocks) {
      const commandTopic = `${s.topicPrefix}/command/switch:${s.switchId}`;
      const controller = new FanController({
        stockId: s.stockId,
        publish: (payload) => this.deps.mqtt.publish(commandTopic, payload),
        stateRepo: deps.stateRepo,
        eventsRepo: deps.eventsRepo,
        timings: { keepAliveMs: deps.timings.keepAliveMs, watchdogMs: deps.timings.watchdogMs },
        now: this.now,
      });
      this.halls.set(s.stockId, { stockId: s.stockId, topicPrefix: s.topicPrefix, commandTopic, controller });
    }
  }

  init(): void {
    this.deps.mqtt.onMessage((topic, payload) => this.route(topic, payload));
    for (const hall of this.halls.values()) {
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/monitor/#`);
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/status/#`);
      this.deps.mqtt.subscribe(`${hall.topicPrefix}/online`);
      hall.controller.recover();
    }
    this.retentionTimer = setInterval(() => this.sweepRetention(), this.deps.timings.retentionSweepMs);
  }

  isFanStock(stockId: string): boolean {
    return this.halls.has(stockId);
  }

  getController(stockId: string): FanController | null {
    return this.halls.get(stockId)?.controller ?? null;
  }

  shutdown(): void {
    if (this.retentionTimer) { clearInterval(this.retentionTimer); this.retentionTimer = null; }
    for (const hall of this.halls.values()) hall.controller.stop();
  }

  private route(topic: string, payload: string): void {
    for (const hall of this.halls.values()) {
      if (!topic.startsWith(`${hall.topicPrefix}/`)) continue;
      const suffix = topic.slice(hall.topicPrefix.length + 1);
      if (suffix.startsWith('monitor/')) {
        const msg = parseShellyMonitorMessage(payload);
        if (msg) hall.controller.handleShellyMessage(msg);
      } else if (suffix.startsWith('status/')) {
        hall.controller.handleStatus(payload);
      } else if (suffix === 'online') {
        hall.controller.handleOnline(payload.trim() === 'true');
      }
      return;
    }
  }

  private sweepRetention(): void {
    const cutoff = new Date(this.now().getTime() - this.deps.timings.retentionDays * 86400000).toISOString();
    this.deps.eventsRepo.deleteOlderThan(cutoff);
  }
}
```

- [ ] **Step 4: Implement `index.ts` singleton accessors**

Create `backend/src/services/fan/index.ts`:

```typescript
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
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace backend -- fan.manager`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/fan/fan.manager.ts backend/src/services/fan/index.ts backend/tests/unit/services/fan.manager.test.ts
git commit -m "feat(backend): add fan control manager with mqtt routing and retention"
```

---

## PHASE 4 — BACKEND HTTP + WIRING

### Task 8: Fan HTTP endpoints (GET status, POST command, SSE stream) + validation + routing + latest-readings flag

**Files:**
- Modify: `backend/src/middleware/validation.middleware.ts`
- Create: `backend/src/controllers/fan.controller.ts`
- Modify: `backend/src/controllers/index.ts`
- Create: `backend/src/routes/fan.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Modify: `backend/src/controllers/stocks.controller.ts`
- Test: `backend/tests/integration/fan.test.ts`

**Interfaces:**
- Consumes: `getFanManager()` (Task 7), `authenticate`, `requireStockAccess`, `validateParams`, `validateBody`, `NotFoundError`.
- Produces:
  - `fanCommandSchema = z.object({ action: z.enum(['on','off']) })`, type `FanCommandRequest`.
  - `class FanHttpController { getStatus(req,res,next); sendCommand(req,res,next); stream(req,res,next); }`
  - `createFanRouter(): Router` mounted at `/stocks`.
  - `getLatestReadings` response gains `fanControlEnabled: boolean`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/integration/fan.test.ts` (mirrors `stocks.test.ts` — mock config, build app with `createApp`+`finaliseApp`, seed DB, inject a fan manager via `setFanManager`, forge a JWT):

```typescript
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { resetServiceSingletonsForTests } from '../../src/services';
import { StockRepository, FanStateRepository, FanEventsRepository } from '../../src/db/repositories';
import { seedStocks } from '../../src/db/seed';
import { FanControlManager } from '../../src/services/fan/fan.manager';
import { setFanManager } from '../../src/services/fan';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

jest.mock('../../src/config', () => ({
  config: {
    port: 3000, nodeEnv: 'test',
    jwt: { secret: 'test-secret-key-for-testing-only-must-be-long-enough', expiresIn: '24h' },
    influxdb: { url: 'http://localhost:8086', token: 't', org: 'o', bucket: 'b', measurement: 'Temp', outdoorTemperatureMeasurement: 'ot', outdoorHumidityMeasurement: 'oh', outdoorLookback: '1h' },
  },
}));

function token(): string {
  return jwt.sign({ userId: 'u1', username: 'admin', role: 'admin', stockAccess: ['*'] }, JWT_SECRET, { expiresIn: '1h' });
}

const published: Array<{ topic: string; message: string }> = [];

beforeEach(async () => {
  initDb({ path: ':memory:' });
  runMigrations(getDb());
  await seedStocks(new StockRepository(getDb()));
  resetServiceSingletonsForTests();
  published.length = 0;
  const manager = new FanControlManager({
    stocks: [{ stockId: 'grain-watch-1', topicPrefix: '/p', switchId: 0 }],
    mqtt: { publish: (topic, message) => published.push({ topic, message }), subscribe: () => {}, onMessage: () => {} },
    stateRepo: new FanStateRepository(getDb()),
    eventsRepo: new FanEventsRepository(getDb()),
    timings: { keepAliveMs: 900000, watchdogMs: 10000, retentionDays: 90, retentionSweepMs: 21600000 },
  });
  manager.init();
  setFanManager(manager);
});

afterEach(() => { setFanManager(null); closeDb(); });

function app() { return finaliseApp(createApp({ enableLogging: false })); }

describe('fan endpoints', () => {
  it('GET /fan returns status for a fan hall', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('OFF');
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('GET /fan returns 404 for a non-fan hall', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-2/fan').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('POST /fan/command on publishes and moves to pending', async () => {
    const res = await request(app()).post('/api/v1/stocks/grain-watch-1/fan/command').set('Authorization', `Bearer ${token()}`).send({ action: 'on' });
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('TURN_ON_PENDING');
    expect(published).toContainEqual({ topic: '/p/command/switch:0', message: 'on' });
  });

  it('POST /fan/command rejects invalid action', async () => {
    const res = await request(app()).post('/api/v1/stocks/grain-watch-1/fan/command').set('Authorization', `Bearer ${token()}`).send({ action: 'spin' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app()).get('/api/v1/stocks/grain-watch-1/fan');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- integration/fan`
Expected: FAIL — fan routes/controller not found.

- [ ] **Step 3: Add `fanCommandSchema` to validation middleware**

In `backend/src/middleware/validation.middleware.ts`, add after `historyQuerySchema`:

```typescript
/**
 * Fan command request body schema.
 */
export const fanCommandSchema = z.object({
  action: z.enum(['on', 'off'], {
    required_error: 'Action is required',
    invalid_type_error: 'Action must be one of: on, off',
  }),
});

/** Type inferred from fanCommandSchema */
export type FanCommandRequest = z.infer<typeof fanCommandSchema>;
```

Then in `backend/src/middleware/index.ts`, add `fanCommandSchema` to the value export block and `FanCommandRequest` to the type export block.

- [ ] **Step 4: Implement the HTTP controller**

Create `backend/src/controllers/fan.controller.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../middleware';
import { getFanManager } from '../services/fan';
import type { FanCommandRequest } from '../middleware';

const RECENT_EVENT_LIMIT = 50;

export class FanHttpController {
  getStatus(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
    } catch (error) {
      next(error);
    }
  }

  sendCommand(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);
      const { action } = req.body as FanCommandRequest;
      controller.command(action, 'user');
      res.status(200).json({
        status: controller.getStatus(),
        events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
      });
    } catch (error) {
      next(error);
    }
  }

  stream(req: Request, res: Response, next: NextFunction): void {
    try {
      const stockId = req.params['stockId'] as string;
      const controller = this.requireController(stockId);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      const send = (): void => {
        res.write(`data: ${JSON.stringify({
          status: controller.getStatus(),
          events: controller.getRecentEvents(RECENT_EVENT_LIMIT),
        })}\n\n`);
      };

      send();
      const unsubscribe = controller.onChange(() => send());
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);

      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  }

  private requireController(stockId: string) {
    const manager = getFanManager();
    const controller = manager?.getController(stockId) ?? null;
    if (!manager || !controller) {
      throw new NotFoundError(`Fan control not available for stock: ${stockId}`);
    }
    return controller;
  }
}
```

- [ ] **Step 5: Export the controller**

In `backend/src/controllers/index.ts`, add: `export { FanHttpController } from './fan.controller';`

- [ ] **Step 6: Create the fan router**

Create `backend/src/routes/fan.routes.ts`:

```typescript
import { Router } from 'express';
import { FanHttpController } from '../controllers';
import {
  authenticate,
  requireStockAccess,
  validateParams,
  validateBody,
  stockIdParamsSchema,
  fanCommandSchema,
} from '../middleware';

export function createFanRouter(): Router {
  const router = Router();
  const controller = new FanHttpController();

  router.get(
    '/:stockId/fan',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.getStatus(req, res, next)
  );

  router.post(
    '/:stockId/fan/command',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    validateBody(fanCommandSchema),
    (req, res, next) => controller.sendCommand(req, res, next)
  );

  router.get(
    '/:stockId/fan/stream',
    authenticate,
    validateParams(stockIdParamsSchema),
    requireStockAccess,
    (req, res, next) => controller.stream(req, res, next)
  );

  return router;
}
```

- [ ] **Step 7: Mount the fan router**

In `backend/src/routes/index.ts`, add the import `import { createFanRouter } from './fan.routes';`, then mount it **after** the stocks router so unmatched `/stocks/:id/fan*` paths reach it:

```typescript
  router.use('/stocks', createStocksRouter());
  router.use('/stocks', createFanRouter());
```

Also add `export { createFanRouter } from './fan.routes';` with the other re-exports.

- [ ] **Step 8: Add `fanControlEnabled` to latest readings**

In `backend/src/controllers/stocks.controller.ts`, inside `getLatestReadings`, add `fanControlEnabled: metadata.fanControlEnabled,` to the `res.status(200).json({ ... })` object (after `outdoor`).

- [ ] **Step 9: Run tests**

Run: `npm test --workspace backend -- integration/fan`
Expected: PASS (all 5 cases). Then run the full backend suite: `npm test --workspace backend` — expect PASS (stocks test still green; `fanControlEnabled` is additive).

- [ ] **Step 10: Commit**

```bash
git add backend/src/middleware backend/src/controllers backend/src/routes backend/tests/integration/fan.test.ts
git commit -m "feat(backend): add fan http endpoints, sse stream and routing"
```

---

### Task 9: Bootstrap wiring + graceful shutdown

**Files:**
- Modify: `backend/src/services/fan/fan.manager.ts` (add pure `selectFanStocks` helper)
- Modify: `backend/src/bootstrap.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/unit/services/fan.manager.test.ts` *(extend — test `selectFanStocks`)*

**Interfaces:**
- Consumes: `createMqttService` (Task 4), `FanControlManager`, `setFanManager`/`getFanManager` (Task 7), `Stock`, `config.mqtt`, `config.fan`.
- Produces:
  - `function selectFanStocks(stocks: Stock[]): Array<{ stockId; topicPrefix; switchId }>` — pure filter+map (fan-enabled with a prefix). Unit-tested.
  - `async initFanControl(): Promise<void>` (in bootstrap) building + `init()`-ing the manager; awaited by `bootstrapApplication`. Opens a real MQTT connection, so it is exercised only via manual smoke (Task 13), never in unit tests.
  - `shutdownFanControl(): void`.

Rationale: the fan-stock selection logic is the part worth a unit test; it is extracted as a pure function so tests never open a live MQTT socket. `initFanControl` becomes thin glue verified manually.

- [ ] **Step 1: Extend the failing test for `selectFanStocks`**

Append to `backend/tests/unit/services/fan.manager.test.ts`:

```typescript
import { selectFanStocks } from '../../../src/services/fan/fan.manager';
import type { Stock } from '../../../src/db/types';

describe('selectFanStocks', () => {
  const base: Stock = {
    id: 'x', name: 'X', deviceCount: 5, deviceGroup: 'g', devicePrefix: '1',
    hasHumidity: false, active: true, createdAt: 'x', fanControlEnabled: false, fanSwitchId: 0,
  };

  it('keeps only fan-enabled stocks that have a topic prefix', () => {
    const result = selectFanStocks([
      { ...base, id: 'a', fanControlEnabled: true, fanTopicPrefix: '/pa', fanSwitchId: 0 },
      { ...base, id: 'b', fanControlEnabled: false },
      { ...base, id: 'c', fanControlEnabled: true }, // no prefix -> excluded
    ]);
    expect(result).toEqual([{ stockId: 'a', topicPrefix: '/pa', switchId: 0 }]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace backend -- fan.manager`
Expected: FAIL — `selectFanStocks` not exported.

- [ ] **Step 3: Add the pure helper to `fan.manager.ts`**

In `backend/src/services/fan/fan.manager.ts`, add near the top (after imports):

```typescript
import type { Stock } from '../../db/types';

/** Selects the MQTT wiring config for every fan-enabled stock. Pure. */
export function selectFanStocks(
  stocks: Stock[],
): Array<{ stockId: string; topicPrefix: string; switchId: number }> {
  return stocks
    .filter((s) => s.fanControlEnabled && s.fanTopicPrefix)
    .map((s) => ({ stockId: s.id, topicPrefix: s.fanTopicPrefix as string, switchId: s.fanSwitchId }));
}
```

- [ ] **Step 4: Run the helper test**

Run: `npm test --workspace backend -- fan.manager`
Expected: PASS (existing manager cases + `selectFanStocks`).

- [ ] **Step 5: Build + start the manager in bootstrap (awaited, no race)**

In `backend/src/bootstrap.ts`, add imports (skip any already present):

```typescript
import { config } from './config';
import { createMqttService } from './services/mqtt';
import { FanControlManager, selectFanStocks, setFanManager, getFanManager } from './services/fan';
import { FanStateRepository, FanEventsRepository } from './db/repositories';
import { getDb } from './db';
```

Note: `selectFanStocks` must be re-exported from `backend/src/services/fan/index.ts` — add `export { FanControlManager, selectFanStocks } from './fan.manager';` there (replacing the existing `FanControlManager`-only re-export line).

Add these functions to `bootstrap.ts`:

```typescript
/**
 * Builds and starts the fan control manager for all fan-enabled stocks.
 * No-op when no stock has fan control configured. Recovers desired state.
 * Opens the live MQTT connection — not exercised by unit tests.
 */
export async function initFanControl(): Promise<void> {
  const db = getDb();
  const stocks = await new StockRepository(db).findAll();
  const fanStocks = selectFanStocks(stocks);
  if (fanStocks.length === 0) {
    console.log('Fan control: no fan-enabled stocks, skipping MQTT init');
    return;
  }
  const mqtt = createMqttService(config.mqtt);
  const manager = new FanControlManager({
    stocks: fanStocks,
    mqtt,
    stateRepo: new FanStateRepository(db),
    eventsRepo: new FanEventsRepository(db),
    timings: {
      keepAliveMs: config.fan.keepAliveMs,
      watchdogMs: config.fan.watchdogMs,
      retentionDays: config.fan.retentionDays,
      retentionSweepMs: config.fan.retentionSweepMs,
    },
  });
  manager.init();
  setFanManager(manager);
  console.log(`Fan control: initialised for ${fanStocks.length} stock(s)`);
}

export function shutdownFanControl(): void {
  const manager = getFanManager();
  if (manager) {
    manager.shutdown();
    setFanManager(null);
  }
}
```

Then `await` it at the end of `bootstrapApplication()`, just before `return result;` in the `try` block:

```typescript
    await initFanControl();
    return result;
```

(`StockRepository` is already imported at the top of `bootstrap.ts`.)

- [ ] **Step 6: Wire graceful shutdown in `index.ts`**

In `backend/src/index.ts`, import `shutdownFanControl`:

```typescript
import { bootstrapApplication, shutdownFanControl } from './bootstrap';
```

Update the `shutdown` handler to stop fan control before closing the DB (do NOT publish off — fan stays on; the Shelly Auto OFF is the safety net):

```typescript
const shutdown = (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  shutdownFanControl();
  closeDb();
  process.exit(0);
};
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test --workspace backend -- fan.manager`
Expected: PASS (`selectFanStocks` + manager cases).
Run: `npm run typecheck --workspace backend`
Expected: no errors (confirms bootstrap `await initFanControl()` and `index.ts` wiring type-check).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/fan backend/src/bootstrap.ts backend/src/index.ts backend/tests/unit/services/fan.manager.test.ts
git commit -m "feat(backend): wire fan control into bootstrap and graceful shutdown"
```

---

## PHASE 5 — FRONTEND

### Task 10: Fan API client + types + SSE hook

**Files:**
- Create: `frontend/src/types/fan.ts`
- Modify: `frontend/src/types/api.ts` (add `fanControlEnabled?: boolean` to `LatestReadingsResponse`)
- Create: `frontend/src/api/fan.ts`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/api/client.ts` (add public `refresh()`)
- Create: `frontend/src/hooks/useFanStream.ts`
- Modify: `frontend/package.json` (add `@microsoft/fetch-event-source`)
- Test: `frontend/src/api/fan.test.ts`

**Interfaces:**
- Produces (in `types/fan.ts`):
  ```typescript
  export type FanState = 'OFF' | 'TURN_ON_PENDING' | 'ON' | 'TURN_OFF_PENDING' | 'FAULT';
  export interface FanStatus { stockId: string; state: FanState; desiredOn: boolean; shellyOnline: boolean | null; lastWarning: { message: string; ts: string } | null; lastAlert: { message: string; ts: string } | null; since: string | null; updatedAt: string; }
  export interface FanEvent { id: number; stockId: string; ts: string; kind: string; payload: unknown; source: string; }
  export interface FanSnapshot { status: FanStatus; events: FanEvent[]; }
  ```
- Produces (in `api/fan.ts`): `fanApi.getStatus(stockId): Promise<FanSnapshot>`, `fanApi.sendCommand(stockId, action): Promise<FanSnapshot>`.
- Produces (in `hooks/useFanStream.ts`): `useFanStream(stockId, enabled): { snapshot: FanSnapshot | null; connected: boolean }`.

- [ ] **Step 1: Add the SSE dependency**

Run: `npm install @microsoft/fetch-event-source --workspace frontend`
Expected: appears in `frontend/package.json` dependencies.

- [ ] **Step 2: Write the failing API test**

Create `frontend/src/api/fan.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fanApi } from './fan';
import client from './client';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockClient = client as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

describe('fanApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getStatus calls the fan endpoint', async () => {
    mockClient.get.mockResolvedValue({ data: { status: { state: 'OFF' }, events: [] } });
    const snap = await fanApi.getStatus('grain-watch-1');
    expect(mockClient.get).toHaveBeenCalledWith('/stocks/grain-watch-1/fan');
    expect(snap.status.state).toBe('OFF');
  });

  it('sendCommand posts the action', async () => {
    mockClient.post.mockResolvedValue({ data: { status: { state: 'TURN_ON_PENDING' }, events: [] } });
    const snap = await fanApi.sendCommand('grain-watch-1', 'on');
    expect(mockClient.post).toHaveBeenCalledWith('/stocks/grain-watch-1/fan/command', { action: 'on' });
    expect(snap.status.state).toBe('TURN_ON_PENDING');
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `npm test --workspace frontend -- api/fan`
Expected: FAIL — cannot find `./fan`.

- [ ] **Step 4: Create `types/fan.ts`**

Create `frontend/src/types/fan.ts` with the interfaces from the **Interfaces** block above (copy verbatim).

- [ ] **Step 5: Add `fanControlEnabled` to `LatestReadingsResponse`**

In `frontend/src/types/api.ts`, find `interface LatestReadingsResponse` and add:

```typescript
  fanControlEnabled?: boolean;
```

- [ ] **Step 6: Implement `api/fan.ts`**

Create `frontend/src/api/fan.ts`:

```typescript
import axios from './client';
import type { FanSnapshot } from '../types/fan';

export const fanApi = {
  async getStatus(stockId: string): Promise<FanSnapshot> {
    const response = await axios.get<FanSnapshot>(`/stocks/${stockId}/fan`);
    return response.data;
  },

  async sendCommand(stockId: string, action: 'on' | 'off'): Promise<FanSnapshot> {
    const response = await axios.post<FanSnapshot>(
      `/stocks/${stockId}/fan/command`,
      { action },
    );
    return response.data;
  },
};
```

Then in `frontend/src/api/index.ts` add: `export { fanApi } from './fan';`

- [ ] **Step 7: Add a public `refresh()` to the API client**

In `frontend/src/api/client.ts`, add a public method to the `ApiClient` class (it can reuse the private `refreshAccessToken`):

```typescript
  /** Forces a token refresh (used by non-axios transports such as SSE). */
  async refresh(): Promise<string> {
    return this.refreshAccessToken();
  }
```

- [ ] **Step 8: Implement `hooks/useFanStream.ts`**

Create `frontend/src/hooks/useFanStream.ts`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { apiClient } from '../api/client';
import type { FanSnapshot } from '../types/fan';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');

/**
 * Subscribes to the fan SSE stream for a stock. Sends the bearer token as a
 * header (so it never lands in server logs), refreshes it on a 401, and
 * exposes the latest snapshot plus a connected flag.
 */
export function useFanStream(
  stockId: string | undefined,
  enabled: boolean,
): { snapshot: FanSnapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<FanSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (!stockId || !enabled) return;
    const controller = new AbortController();

    void fetchEventSource(`${API_BASE_URL}/stocks/${stockId}/fan/stream`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` },
      openWhenHidden: true,
      onopen: async (res) => {
        if (res.status === 401 && !refreshedRef.current) {
          refreshedRef.current = true;
          await apiClient.refresh();
          throw new Error('retry-after-refresh');
        }
        refreshedRef.current = false;
        setConnected(true);
      },
      onmessage: (ev) => {
        if (!ev.data) return;
        setSnapshot(JSON.parse(ev.data) as FanSnapshot);
      },
      onerror: () => {
        setConnected(false);
        // returning undefined lets fetch-event-source retry with backoff
      },
    });

    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [stockId, enabled]);

  return { snapshot, connected };
}
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npm test --workspace frontend -- api/fan`
Expected: PASS.
Run: `npm run build --workspace frontend` (tsc + vite) — expect no type errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types frontend/src/api frontend/src/hooks frontend/package.json package-lock.json
git commit -m "feat(frontend): add fan api client, types and sse hook"
```

---

### Task 11: FanStatusCard component

**Files:**
- Create: `frontend/src/components/FanStatusCard.tsx`
- Test: `frontend/src/components/FanStatusCard.test.tsx`

**Interfaces:**
- Consumes: `FanStatus` (`types/fan.ts`).
- Produces: `function FanStatusCard({ status, connected }: { status: FanStatus | null; connected: boolean }): JSX.Element` — display-only; shows state label + warning/alert/offline badges.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/FanStatusCard.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FanStatusCard } from './FanStatusCard';
import type { FanStatus } from '../types/fan';

const base: FanStatus = {
  stockId: 'grain-watch-1', state: 'ON', desiredOn: true, shellyOnline: true,
  lastWarning: null, lastAlert: null, since: null, updatedAt: '2026-07-09T10:00:00.000Z',
};

describe('FanStatusCard', () => {
  it('shows the running state', () => {
    render(<FanStatusCard status={base} connected={true} />);
    expect(screen.getByText(/Läuft/i)).toBeInTheDocument();
  });

  it('shows an in-flight label when pending', () => {
    render(<FanStatusCard status={{ ...base, state: 'TURN_ON_PENDING' }} connected={true} />);
    expect(screen.getByText(/wird eingeschaltet/i)).toBeInTheDocument();
  });

  it('shows an alert badge when there is an alert', () => {
    render(<FanStatusCard status={{ ...base, state: 'FAULT', lastAlert: { message: 'no follow', ts: 'x' } }} connected={true} />);
    expect(screen.getByText(/Fehler/i)).toBeInTheDocument();
  });

  it('renders a placeholder when status is null', () => {
    render(<FanStatusCard status={null} connected={false} />);
    expect(screen.getByText(/Lüfter/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace frontend -- FanStatusCard`
Expected: FAIL — cannot find `./FanStatusCard`.

- [ ] **Step 3: Implement `FanStatusCard.tsx`**

Create `frontend/src/components/FanStatusCard.tsx`:

```typescript
import { Fan, AlertTriangle, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FanState, FanStatus } from '@/types/fan';

const STATE_LABEL: Record<FanState, string> = {
  OFF: 'Aus',
  TURN_ON_PENDING: 'Wird eingeschaltet…',
  ON: 'Läuft',
  TURN_OFF_PENDING: 'Wird ausgeschaltet…',
  FAULT: 'Fehler',
};

const PENDING: FanState[] = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

export function FanStatusCard({
  status,
  connected,
}: {
  status: FanStatus | null;
  connected: boolean;
}) {
  const state = status?.state ?? 'OFF';
  const isPending = PENDING.includes(state);
  const isOn = state === 'ON';

  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <Fan className={cn('h-5 w-5', isOn && 'animate-spin text-green-600')} />
        <span className="font-medium">Lüfter</span>
        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm font-semibold">
          {status ? STATE_LABEL[state] : '—'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {status?.lastAlert && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" /> Fehler: {status.lastAlert.message}
          </span>
        )}
        {status?.lastWarning && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <AlertTriangle className="h-3 w-3" /> Warnung: {status.lastWarning.message}
          </span>
        )}
        {status?.shellyOnline === false && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <WifiOff className="h-3 w-3" /> Shelly offline
          </span>
        )}
        {!connected && (
          <span className="text-xs text-muted-foreground/60">Verbindung…</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace frontend -- FanStatusCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FanStatusCard.tsx frontend/src/components/FanStatusCard.test.tsx
git commit -m "feat(frontend): add fan status card"
```

---

### Task 12: Fan sub-screen page + route + hall-screen integration

**Files:**
- Create: `frontend/src/pages/FanControlPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/StockDetailPage.tsx`
- Test: `frontend/src/pages/FanControlPage.test.tsx`

**Interfaces:**
- Consumes: `useFanStream` (Task 10), `fanApi` (Task 10), `FanStatusCard` (Task 11), `Button`.
- Produces: default-exported `FanControlPage` at route `/stocks/:stockId/fan`; hall screen shows `FanStatusCard` + a link to the sub-screen when `fanControlEnabled`.

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/pages/FanControlPage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import FanControlPage from './FanControlPage';
import { fanApi } from '../api/fan';
import { useFanStream } from '../hooks/useFanStream';
import type { FanSnapshot } from '../types/fan';

vi.mock('../api/fan', () => ({ fanApi: { getStatus: vi.fn(), sendCommand: vi.fn() } }));
vi.mock('../hooks/useFanStream', () => ({ useFanStream: vi.fn() }));

const snap = (state: string): FanSnapshot => ({
  status: { stockId: 'grain-watch-1', state: state as FanSnapshot['status']['state'], desiredOn: state === 'ON', shellyOnline: true, lastWarning: null, lastAlert: null, since: null, updatedAt: 'x' },
  events: [],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stocks/grain-watch-1/fan']}>
      <Routes>
        <Route path="/stocks/:stockId/fan" element={<FanControlPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FanControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fanApi.getStatus).mockResolvedValue(snap('OFF'));
    vi.mocked(fanApi.sendCommand).mockResolvedValue(snap('TURN_ON_PENDING'));
  });

  it('shows an enabled Einschalten button when OFF and sends the command', async () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('OFF'), connected: true });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Einschalten/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(fanApi.sendCommand).toHaveBeenCalledWith('grain-watch-1', 'on'));
  });

  it('disables buttons while pending (in-flight)', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('TURN_ON_PENDING'), connected: true });
    renderPage();
    expect(screen.getByRole('button', { name: /wird quittiert/i })).toBeDisabled();
  });

  it('shows Ausschalten when running', () => {
    vi.mocked(useFanStream).mockReturnValue({ snapshot: snap('ON'), connected: true });
    renderPage();
    expect(screen.getByRole('button', { name: /Ausschalten/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test --workspace frontend -- FanControlPage`
Expected: FAIL — cannot find `./FanControlPage`.

- [ ] **Step 3: Implement `FanControlPage.tsx`**

Create `frontend/src/pages/FanControlPage.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { FanStatusCard } from '@/components/FanStatusCard';
import { Button } from '@/components/ui/button';
import { fanApi } from '@/api/fan';
import { useFanStream } from '@/hooks/useFanStream';
import type { FanSnapshot } from '@/types/fan';

const PENDING = ['TURN_ON_PENDING', 'TURN_OFF_PENDING'];

export default function FanControlPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<FanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { snapshot: live, connected } = useFanStream(stockId, true);

  useEffect(() => {
    if (!stockId) return;
    fanApi.getStatus(stockId).then(setInitial).catch(() => setError('Status konnte nicht geladen werden.'));
  }, [stockId]);

  const snapshot = live ?? initial;
  const state = snapshot?.status.state ?? 'OFF';
  const isPending = PENDING.includes(state) || busy;

  const send = useCallback(
    async (action: 'on' | 'off') => {
      if (!stockId) return;
      setBusy(true);
      setError(null);
      try {
        setInitial(await fanApi.sendCommand(stockId, action));
      } catch {
        setError('Schaltbefehl fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    },
    [stockId],
  );

  const renderButton = () => {
    if (isPending) {
      return (
        <Button size="lg" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird quittiert…
        </Button>
      );
    }
    if (state === 'ON') {
      return <Button size="lg" variant="destructive" onClick={() => send('off')}>Ausschalten</Button>;
    }
    if (state === 'FAULT') {
      return <Button size="lg" onClick={() => send('on')}>Erneut einschalten</Button>;
    }
    return <Button size="lg" onClick={() => send('on')}>Einschalten</Button>;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-screen-md px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/stocks/${stockId}`)}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Zurück</span>
          </Button>
          <h1 className="text-2xl font-bold">Lüftersteuerung</h1>
        </div>

        <FanStatusCard status={snapshot?.status ?? null} connected={connected} />

        <div className="mt-6 flex justify-center">{renderButton()}</div>

        {error && (
          <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        )}

        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Verlauf</h2>
          <ul className="space-y-1 text-xs">
            {(snapshot?.events ?? []).map((ev) => (
              <li key={ev.id} className="flex gap-2 border-b py-1">
                <span className="text-muted-foreground/60">{ev.ts}</span>
                <span className="font-medium">{ev.kind}</span>
                <span className="text-muted-foreground">{ev.source}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `frontend/src/App.tsx`, import the page and add a protected route **before** the catch-all:

```typescript
import FanControlPage from './pages/FanControlPage';
```

```tsx
      <Route
        path="/stocks/:stockId/fan"
        element={
          <ProtectedRoute>
            <FanControlPage />
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 5: Show the card + link on the hall screen**

In `frontend/src/pages/StockDetailPage.tsx`:
1. Add imports:
```typescript
import { Fan } from 'lucide-react';
import { FanStatusCard } from '@/components/FanStatusCard';
import { useFanStream } from '@/hooks/useFanStream';
```
2. After the existing `useState` declarations, add:
```typescript
  const fanEnabled = data?.fanControlEnabled ?? false;
  const { snapshot: fanSnapshot, connected: fanConnected } = useFanStream(stockId, fanEnabled);
```
3. Inside the `data && data.devices.length > 0` branch, above the sensor grid `<div className="grid ...">`, add:
```tsx
            {fanEnabled && (
              <div className="mb-4">
                <FanStatusCard status={fanSnapshot?.status ?? null} connected={fanConnected} />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate(`/stocks/${stockId}/fan`)}
                >
                  <Fan className="mr-2 h-4 w-4" /> Lüfter steuern
                </Button>
              </div>
            )}
```

- [ ] **Step 6: Run tests + build**

Run: `npm test --workspace frontend -- FanControlPage`
Expected: PASS.
Run: `npm run build --workspace frontend` — expect no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/FanControlPage.tsx frontend/src/pages/FanControlPage.test.tsx frontend/src/App.tsx frontend/src/pages/StockDetailPage.tsx
git commit -m "feat(frontend): add fan control sub-screen and hall-screen status"
```

---

## PHASE 6 — VERIFICATION

### Task 13: Full-suite verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Backend — full test suite + lint + typecheck**

Run: `npm test --workspace backend`
Expected: all PASS, coverage thresholds (80%) met.
Run: `npm run lint --workspace backend && npm run typecheck --workspace backend`
Expected: no errors.

- [ ] **Step 2: Frontend — full test suite + lint + build**

Run: `npm test --workspace frontend && npm run lint --workspace frontend && npm run build --workspace frontend`
Expected: all PASS, no type errors.

- [ ] **Step 3: Manual smoke against a broker (documented, not automated)**

With a reachable MQTT broker and `MQTT_URL` set, start the backend (`npm run dev:backend`). Using an MQTT client, subscribe to `/corn-watch/actors/corn-watch-1/fan-control/command/switch:0`. In the PWA, open Halle 8 → "Lüfter steuern" → "Einschalten". Confirm:
  - an `on` message is published to the command topic;
  - publishing `{"type":"success","message":"ok","switchState":true,"inputState":true,"timestamp":1}` to `/corn-watch/actors/corn-watch-1/fan-control/monitor/status` flips the UI to "Läuft" within ~1 s (SSE);
  - after ~15 min a keep-alive `on` re-publishes;
  - if no success is published after an `on`, the backend publishes `off` within ~10 s and the UI shows "Fehler".

- [ ] **Step 4: Final commit (if any doc/verification notes were added)**

```bash
git add -A
git commit -m "chore: fan control verification notes" || echo "nothing to commit"
```

---

## Self-Review Notes (author checklist — already applied)

- **Spec coverage:** MQTT connection (T3/T4), command via `/command/switch:0` (T7), monitor dispatch by `type` (T5/T7), keep-alive 15 min (T6), watchdog 10 s (T6), alert/safety→FAULT+stop (T6), warn-only (T6), online/status logging (T6/T7), DB config in `stocks` (T1), `fan_state`+`fan_events`+90-day retention (T1/T2/T7), recovery on restart (T6/T9), no-off-on-shutdown (T9), REST+SSE (T8), stock-access auth + 404 when disabled (T8), hall-screen card + sub-screen with in-flight buttons + history (T11/T12).
- **Type consistency:** `FanState`, `FanStatus`, `ShellyMonitorMessage`, `FanEvent`, `FanSnapshot` names match across backend and frontend; command payloads are `'on'|'off'`; command topic `{prefix}/command/switch:{switchId}`.
- **Placeholders:** none — every step carries full code or an exact command with expected output.
