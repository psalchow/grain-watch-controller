# SQLite Database Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON-based user store and hard-coded stock metadata with a SQLite database accessed via Drizzle ORM.

**Architecture:** Add a `db/` module to the backend containing the Drizzle schema, a connection factory, a migration runner, and repositories for users and stocks. Services accept their repository via constructor injection; the existing `UserService` is refactored to remove file I/O, and a new `StockService` replaces the in-controller `STOCK_METADATA` constant. Boot wires DB open → run migrations → seed stocks → initialise default admin.

**Tech Stack:** Node.js 22+, TypeScript 5.7+, Express.js 4, `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, Jest, Docker.

**Spec:** `docs/superpowers/specs/2026-06-02-sqlite-database-design.md`

---

## File Structure

**Create:**
- `backend/drizzle.config.ts` — drizzle-kit configuration
- `backend/drizzle/` — generated SQL migration files (root-level so they ship as static assets)
- `backend/src/db/index.ts` — connection factory + singleton accessor
- `backend/src/db/schema.ts` — Drizzle table definitions
- `backend/src/db/migrate.ts` — migration runner
- `backend/src/db/seed.ts` — stock seeding (idempotent)
- `backend/src/db/repositories/user.repository.ts`
- `backend/src/db/repositories/stock.repository.ts`
- `backend/src/db/repositories/index.ts` — barrel export
- `backend/src/db/types.ts` — shared `Stock` type for repository return values
- `backend/src/services/stock/stock.service.ts`
- `backend/src/services/stock/index.ts`
- `backend/tests/setup/db.ts` — in-memory DB helper
- `backend/tests/db/repositories/user.repository.test.ts`
- `backend/tests/db/repositories/stock.repository.test.ts`
- `backend/tests/db/seed.test.ts`
- `backend/tests/services/stock.service.test.ts`

**Modify:**
- `backend/package.json` — add deps + npm scripts
- `backend/src/config/index.ts` — add `database`, remove `usersFilePath`
- `backend/src/bootstrap.ts` — wire DB lifecycle into boot
- `backend/src/services/index.ts` — instantiate DB + repos + services
- `backend/src/services/auth/user.service.ts` — replace file I/O with `UserRepository`
- `backend/src/services/auth/index.ts` — keep public exports
- `backend/src/controllers/stocks.controller.ts` — consume `StockService`
- `backend/src/index.ts` — graceful shutdown hook (close DB)
- `backend/tests/services/auth/user.service.test.ts` — port to repository-based setup
- `backend/Dockerfile` — add native build toolchain to dependencies stage; copy `drizzle/` to runtime image
- `docker-compose.yml` — drop `USERS_FILE_PATH`, add `DATABASE_PATH`
- `backend/.env.example` — same
- `.gitignore` — ignore `backend/data/*.db*` (but keep dir)

**Delete (final task):**
- `backend/data/users.json`
- `backend/data/test-users.json`

---

## Task 1: Add dependencies and npm scripts

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install runtime dependencies**

Run from `backend/`:
```bash
npm install better-sqlite3@^11.7.0 drizzle-orm@^0.36.4
```

Expected: both packages added under `dependencies` in `backend/package.json`; `package-lock.json` updated.

- [ ] **Step 2: Install dev dependencies**

Run from `backend/`:
```bash
npm install --save-dev drizzle-kit@^0.30.1 @types/better-sqlite3@^7.6.12
```

Expected: both added under `devDependencies`.

- [ ] **Step 3: Add npm scripts**

Edit `backend/package.json`, add to the `scripts` object (keep existing entries):
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx --env-file=.env src/db/migrate.ts"
```

- [ ] **Step 4: Verify installation**

Run from `backend/`:
```bash
npx drizzle-kit --version
node -e "require('better-sqlite3')"
```

Expected: drizzle-kit prints a version string; `better-sqlite3` loads without error.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): add SQLite and Drizzle ORM dependencies"
```

---

## Task 2: Drizzle configuration

**Files:**
- Create: `backend/drizzle.config.ts`

- [ ] **Step 1: Create `backend/drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
```

- [ ] **Step 2: Commit**

```bash
git add backend/drizzle.config.ts
git commit -m "chore(backend): add drizzle-kit configuration"
```

---

## Task 3: Define the Drizzle schema

**Files:**
- Create: `backend/src/db/schema.ts`

- [ ] **Step 1: Write the schema**

```typescript
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email'),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  createdAt: text('created_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const userStockAccess = sqliteTable(
  'user_stock_access',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stockId: text('stock_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.stockId] }),
    stockIdIdx: index('user_stock_access_stock_id_idx').on(table.stockId),
  })
);

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
});

export type DbUser = typeof users.$inferSelect;
export type DbUserInsert = typeof users.$inferInsert;
export type DbStock = typeof stocks.$inferSelect;
export type DbStockInsert = typeof stocks.$inferInsert;
```

- [ ] **Step 2: Verify typecheck passes**

Run from `backend/`:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): define Drizzle schema for users and stocks"
```

---

## Task 4: Generate the initial migration

**Files:**
- Create: `backend/drizzle/0000_*.sql` (generated)
- Create: `backend/drizzle/meta/` (generated)

- [ ] **Step 1: Run drizzle-kit generate**

Run from `backend/`:
```bash
npx drizzle-kit generate --name init
```

Expected: a new SQL file appears under `backend/drizzle/` (e.g. `0000_init.sql`) and a `meta/` directory is created.

- [ ] **Step 2: Spot-check the generated SQL**

Open the new `.sql` file. Expected statements (order may vary):
- `CREATE TABLE users (...)` with `username UNIQUE`
- `CREATE TABLE user_stock_access (...)` with composite primary key + foreign key
- `CREATE TABLE stocks (...)`
- `CREATE INDEX user_stock_access_stock_id_idx ...`

If any of these are missing, return to Task 3 and fix the schema.

- [ ] **Step 3: Commit**

```bash
git add backend/drizzle
git commit -m "feat(backend): generate initial database migration"
```

---

## Task 5: DB connection factory

**Files:**
- Create: `backend/src/db/index.ts`
- Create: `backend/src/db/types.ts`

- [ ] **Step 1: Write `backend/src/db/types.ts`**

```typescript
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type SqliteHandle = Database.Database;

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
}

export { drizzle, schema };
```

- [ ] **Step 2: Write `backend/src/db/index.ts`**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { Db, SqliteHandle } from './types';

let sqlite: SqliteHandle | null = null;
let db: Db | null = null;

export interface CreateDbOptions {
  /** File path or `:memory:`. Required. */
  path: string;
}

/**
 * Opens a SQLite connection with sensible defaults.
 *
 * - WAL journal mode for durability + concurrency
 * - Foreign keys enabled
 * - Returns both the raw handle (for migrations) and a Drizzle wrapper
 */
export function createDb(opts: CreateDbOptions): { db: Db; sqlite: SqliteHandle } {
  const handle = new Database(opts.path);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  const wrapped = drizzle(handle, { schema, casing: 'snake_case' });
  return { db: wrapped, sqlite: handle };
}

/**
 * Initialises the singleton DB used by the application services.
 * Safe to call once during boot. Subsequent calls throw.
 */
export function initDb(opts: CreateDbOptions): Db {
  if (db !== null) {
    throw new Error('DB already initialised');
  }
  const created = createDb(opts);
  db = created.db;
  sqlite = created.sqlite;
  return db;
}

export function getDb(): Db {
  if (db === null) {
    throw new Error('DB not initialised; call initDb() first');
  }
  return db;
}

export function getSqliteHandle(): SqliteHandle {
  if (sqlite === null) {
    throw new Error('DB not initialised; call initDb() first');
  }
  return sqlite;
}

export function closeDb(): void {
  if (sqlite !== null) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
```

- [ ] **Step 3: Typecheck**

Run from `backend/`:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/index.ts backend/src/db/types.ts
git commit -m "feat(backend): add SQLite connection factory and DB singleton"
```

---

## Task 6: Migration runner

**Files:**
- Create: `backend/src/db/migrate.ts`

- [ ] **Step 1: Write the migration runner**

```typescript
import path from 'path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './types';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
```

Notes:
- `__dirname` resolves to `src/db/` in dev (tsx) and `dist/db/` after build. The `../../drizzle` path therefore points to `backend/drizzle/` in both layouts.

- [ ] **Step 2: Smoke-test via REPL-style script**

Run from `backend/` (one-off check, no commit yet):
```bash
npx tsx -e "
  import { createDb } from './src/db';
  import { runMigrations } from './src/db/migrate';
  const { db, sqlite } = createDb({ path: ':memory:' });
  runMigrations(db);
  const tables = sqlite.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();
  console.log(tables);
  sqlite.close();
"
```

Expected output includes: `__drizzle_migrations`, `stocks`, `user_stock_access`, `users`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/migrate.ts
git commit -m "feat(backend): add Drizzle migration runner"
```

---

## Task 7: Test database helper

**Files:**
- Create: `backend/tests/setup/db.ts`

- [ ] **Step 1: Write the helper**

```typescript
import { createDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import type { Db, SqliteHandle } from '../../src/db/types';

export interface TestDb {
  db: Db;
  sqlite: SqliteHandle;
  close: () => void;
}

export function createTestDb(): TestDb {
  const { db, sqlite } = createDb({ path: ':memory:' });
  runMigrations(db);
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
```

- [ ] **Step 2: Sanity check with an inline test**

Create temporary file `backend/tests/setup/db.smoke.test.ts`:
```typescript
import { createTestDb } from './db';

describe('createTestDb', () => {
  it('creates an in-memory DB with tables', () => {
    const { sqlite, close } = createTestDb();
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['users', 'user_stock_access', 'stocks']));
    close();
  });
});
```

Run:
```bash
npm test -- tests/setup/db.smoke.test.ts
```

Expected: PASS.

- [ ] **Step 3: Delete the smoke test**

```bash
rm backend/tests/setup/db.smoke.test.ts
```

The helper itself stays.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/setup/db.ts
git commit -m "test(backend): add in-memory database test helper"
```

---

## Task 8: UserRepository — find, insert, delete (TDD)

**Files:**
- Create: `backend/tests/db/repositories/user.repository.test.ts`
- Create: `backend/src/db/repositories/user.repository.ts`
- Create: `backend/src/db/repositories/index.ts`

- [ ] **Step 1: Write the failing test (find + insert + delete + stockAccess hydration)**

`backend/tests/db/repositories/user.repository.test.ts`:
```typescript
import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories/user.repository';
import type { User } from '../../../src/models';

describe('UserRepository', () => {
  let testDb: TestDb;
  let repo: UserRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new UserRepository(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  const sampleUser: User = {
    id: 'usr_001',
    username: 'alice',
    passwordHash: 'hash',
    role: 'admin',
    stockAccess: ['*'],
    createdAt: '2026-06-02T00:00:00.000Z',
    active: true,
  };

  it('returns null for unknown id', async () => {
    expect(await repo.findById('missing')).toBeNull();
  });

  it('returns null for unknown username', async () => {
    expect(await repo.findByUsername('ghost')).toBeNull();
  });

  it('inserts a user and hydrates stockAccess on read', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found).toEqual(sampleUser);
  });

  it('inserts a user with multiple stockAccess entries', async () => {
    const user: User = { ...sampleUser, id: 'usr_002', username: 'bob', stockAccess: ['grain-watch-1', 'grain-watch-2'] };
    await repo.insert(user);
    const found = await repo.findByUsername('bob');
    expect(found?.stockAccess.sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('persists optional email', async () => {
    const user: User = { ...sampleUser, id: 'usr_003', username: 'carol', email: 'carol@example.com' };
    await repo.insert(user);
    const found = await repo.findById('usr_003');
    expect(found?.email).toBe('carol@example.com');
  });

  it('omits email when not provided', async () => {
    await repo.insert(sampleUser);
    const found = await repo.findById('usr_001');
    expect(found?.email).toBeUndefined();
  });

  it('lists all users via findAll', async () => {
    await repo.insert(sampleUser);
    await repo.insert({ ...sampleUser, id: 'usr_002', username: 'bob' });
    const all = await repo.findAll();
    expect(all.map((u) => u.id).sort()).toEqual(['usr_001', 'usr_002']);
  });

  it('deletes a user and returns true', async () => {
    await repo.insert(sampleUser);
    expect(await repo.delete('usr_001')).toBe(true);
    expect(await repo.findById('usr_001')).toBeNull();
  });

  it('returns false when deleting an unknown user', async () => {
    expect(await repo.delete('nope')).toBe(false);
  });

  it('cascades stockAccess rows on delete', async () => {
    await repo.insert(sampleUser);
    await repo.delete('usr_001');
    const count = testDb.sqlite
      .prepare('SELECT COUNT(*) AS c FROM user_stock_access WHERE user_id = ?')
      .get('usr_001') as { c: number };
    expect(count.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run from `backend/`:
```bash
npm test -- tests/db/repositories/user.repository.test.ts
```

Expected: FAIL with "Cannot find module '../../../src/db/repositories/user.repository'".

- [ ] **Step 3: Implement `UserRepository` (find/insert/delete only)**

`backend/src/db/repositories/user.repository.ts`:
```typescript
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../types';
import { users, userStockAccess } from '../schema';
import type { User } from '../../models';

export class UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? this.hydrate(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.username, username)).get();
    return row ? this.hydrate(row) : null;
  }

  async findAll(): Promise<User[]> {
    const rows = this.db.select().from(users).all();
    if (rows.length === 0) return [];
    const access = this.db
      .select()
      .from(userStockAccess)
      .where(inArray(userStockAccess.userId, rows.map((r) => r.id)))
      .all();
    const grouped = new Map<string, string[]>();
    for (const entry of access) {
      const list = grouped.get(entry.userId) ?? [];
      list.push(entry.stockId);
      grouped.set(entry.userId, list);
    }
    return rows.map((row) => this.toUser(row, grouped.get(row.id) ?? []));
  }

  async insert(user: User): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(users)
        .values({
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          email: user.email ?? null,
          role: user.role,
          createdAt: user.createdAt,
          active: user.active,
        })
        .run();
      if (user.stockAccess.length > 0) {
        tx.insert(userStockAccess)
          .values(user.stockAccess.map((stockId) => ({ userId: user.id, stockId })))
          .run();
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(users).where(eq(users.id, id)).run();
    return result.changes > 0;
  }

  private hydrate(row: typeof users.$inferSelect): User {
    const access = this.db
      .select({ stockId: userStockAccess.stockId })
      .from(userStockAccess)
      .where(eq(userStockAccess.userId, row.id))
      .all();
    return this.toUser(row, access.map((a) => a.stockId));
  }

  private toUser(row: typeof users.$inferSelect, stockAccess: string[]): User {
    const user: User = {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role,
      stockAccess,
      createdAt: row.createdAt,
      active: row.active,
    };
    if (row.email !== null) {
      user.email = row.email;
    }
    return user;
  }
}
```

- [ ] **Step 4: Add barrel export**

`backend/src/db/repositories/index.ts`:
```typescript
export { UserRepository } from './user.repository';
```

- [ ] **Step 5: Run tests — expect pass**

Run from `backend/`:
```bash
npm test -- tests/db/repositories/user.repository.test.ts
```

Expected: PASS (all 9 cases).

- [ ] **Step 6: Commit**

```bash
git add backend/tests/db/repositories/user.repository.test.ts backend/src/db/repositories
git commit -m "feat(backend): add UserRepository with find/insert/delete"
```

---

## Task 9: UserRepository — update (TDD)

**Files:**
- Modify: `backend/tests/db/repositories/user.repository.test.ts`
- Modify: `backend/src/db/repositories/user.repository.ts`

- [ ] **Step 1: Add failing tests for `update`**

Append to `backend/tests/db/repositories/user.repository.test.ts`:
```typescript
describe('UserRepository.update', () => {
  let testDb: TestDb;
  let repo: UserRepository;

  beforeEach(async () => {
    testDb = createTestDb();
    repo = new UserRepository(testDb.db);
    await repo.insert({
      id: 'usr_001',
      username: 'alice',
      passwordHash: 'hash',
      role: 'admin',
      stockAccess: ['*'],
      createdAt: '2026-06-02T00:00:00.000Z',
      active: true,
    });
  });

  afterEach(() => testDb.close());

  it('updates scalar fields without touching stockAccess', async () => {
    await repo.update('usr_001', { username: 'alice2', active: false });
    const found = await repo.findById('usr_001');
    expect(found?.username).toBe('alice2');
    expect(found?.active).toBe(false);
    expect(found?.stockAccess).toEqual(['*']);
  });

  it('replaces stockAccess wholesale when provided', async () => {
    await repo.update('usr_001', { stockAccess: ['grain-watch-1'] });
    const found = await repo.findById('usr_001');
    expect(found?.stockAccess).toEqual(['grain-watch-1']);
  });

  it('clears email when set to null', async () => {
    await repo.update('usr_001', { email: 'alice@example.com' });
    await repo.update('usr_001', { email: null });
    const found = await repo.findById('usr_001');
    expect(found?.email).toBeUndefined();
  });

  it('throws when user does not exist', async () => {
    await expect(repo.update('missing', { active: false })).rejects.toThrow('User not found');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/db/repositories/user.repository.test.ts
```

Expected: FAIL for the 4 new cases ("repo.update is not a function").

- [ ] **Step 3: Implement `update`**

Add to `UserRepository` (before the private helpers):
```typescript
async update(
  id: string,
  patch: {
    username?: string;
    passwordHash?: string;
    email?: string | null;
    role?: 'admin' | 'viewer';
    active?: boolean;
    stockAccess?: string[];
  }
): Promise<void> {
  this.db.transaction((tx) => {
    const existing = tx.select().from(users).where(eq(users.id, id)).get();
    if (!existing) {
      throw new Error('User not found');
    }

    const scalarUpdates: Record<string, unknown> = {};
    if (patch.username !== undefined) scalarUpdates['username'] = patch.username;
    if (patch.passwordHash !== undefined) scalarUpdates['passwordHash'] = patch.passwordHash;
    if (patch.email !== undefined) scalarUpdates['email'] = patch.email;
    if (patch.role !== undefined) scalarUpdates['role'] = patch.role;
    if (patch.active !== undefined) scalarUpdates['active'] = patch.active;

    if (Object.keys(scalarUpdates).length > 0) {
      tx.update(users).set(scalarUpdates).where(eq(users.id, id)).run();
    }

    if (patch.stockAccess !== undefined) {
      tx.delete(userStockAccess).where(eq(userStockAccess.userId, id)).run();
      if (patch.stockAccess.length > 0) {
        tx.insert(userStockAccess)
          .values(patch.stockAccess.map((stockId) => ({ userId: id, stockId })))
          .run();
      }
    }
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/db/repositories/user.repository.test.ts
```

Expected: PASS (all 13 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/db/repositories/user.repository.test.ts backend/src/db/repositories/user.repository.ts
git commit -m "feat(backend): add UserRepository.update with transactional stockAccess replace"
```

---

## Task 10: StockRepository (TDD)

**Files:**
- Create: `backend/tests/db/repositories/stock.repository.test.ts`
- Create: `backend/src/db/repositories/stock.repository.ts`
- Modify: `backend/src/db/repositories/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createTestDb, TestDb } from '../../setup/db';
import { StockRepository } from '../../../src/db/repositories/stock.repository';
import type { Stock } from '../../../src/db/types';

describe('StockRepository', () => {
  let testDb: TestDb;
  let repo: StockRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new StockRepository(testDb.db);
  });

  afterEach(() => testDb.close());

  const sample: Stock = {
    id: 'grain-watch-1',
    name: 'Halle 8',
    description: 'Lagerhalle 8',
    deviceCount: 5,
    deviceGroup: 'corn-watch-1',
    devicePrefix: '1',
    hasHumidity: true,
    active: true,
    createdAt: '2026-06-02T00:00:00.000Z',
  };

  it('returns null when stock is missing', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('upserts a stock and reads it back', async () => {
    await repo.upsertMany([sample]);
    const found = await repo.findById('grain-watch-1');
    expect(found).toEqual(sample);
  });

  it('lists all stocks', async () => {
    const other: Stock = { ...sample, id: 'grain-watch-2', name: 'Halle 7', hasHumidity: false, active: false };
    await repo.upsertMany([sample, other]);
    const all = await repo.findAll();
    expect(all.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('is idempotent on repeated upsertMany calls', async () => {
    await repo.upsertMany([sample]);
    await repo.upsertMany([sample]);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
  });

  it('does not overwrite existing rows on conflict', async () => {
    await repo.upsertMany([sample]);
    await repo.upsertMany([{ ...sample, name: 'Renamed' }]);
    const found = await repo.findById('grain-watch-1');
    expect(found?.name).toBe('Halle 8'); // original kept (INSERT OR IGNORE semantics)
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/db/repositories/stock.repository.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `StockRepository`**

`backend/src/db/repositories/stock.repository.ts`:
```typescript
import { eq } from 'drizzle-orm';
import type { Db } from '../types';
import { stocks } from '../schema';
import type { Stock } from '../types';

export class StockRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Stock | null> {
    const row = this.db.select().from(stocks).where(eq(stocks.id, id)).get();
    return row ? this.toStock(row) : null;
  }

  async findAll(): Promise<Stock[]> {
    const rows = this.db.select().from(stocks).all();
    return rows.map((row) => this.toStock(row));
  }

  async upsertMany(values: Stock[]): Promise<void> {
    if (values.length === 0) return;
    this.db
      .insert(stocks)
      .values(
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
        }))
      )
      .onConflictDoNothing({ target: stocks.id })
      .run();
  }

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
    };
    if (row.description !== null) {
      stock.description = row.description;
    }
    return stock;
  }
}
```

- [ ] **Step 4: Update barrel export**

`backend/src/db/repositories/index.ts`:
```typescript
export { UserRepository } from './user.repository';
export { StockRepository } from './stock.repository';
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test -- tests/db/repositories/stock.repository.test.ts
```

Expected: PASS (all 5 cases).

- [ ] **Step 6: Commit**

```bash
git add backend/tests/db/repositories/stock.repository.test.ts backend/src/db/repositories
git commit -m "feat(backend): add StockRepository with idempotent upsert"
```

---

## Task 11: Stock seed data (TDD)

**Files:**
- Create: `backend/tests/db/seed.test.ts`
- Create: `backend/src/db/seed.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createTestDb, TestDb } from '../setup/db';
import { StockRepository } from '../../src/db/repositories';
import { seedStocks, SEED_STOCKS } from '../../src/db/seed';

describe('seedStocks', () => {
  let testDb: TestDb;
  let repo: StockRepository;

  beforeEach(() => {
    testDb = createTestDb();
    repo = new StockRepository(testDb.db);
  });

  afterEach(() => testDb.close());

  it('inserts the canonical stock metadata', async () => {
    await seedStocks(repo);
    const all = await repo.findAll();
    expect(all.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('matches the canonical metadata exactly', async () => {
    await seedStocks(repo);
    const watch1 = await repo.findById('grain-watch-1');
    expect(watch1).toMatchObject({
      id: 'grain-watch-1',
      name: 'Halle 8',
      description: 'Lagerhalle 8',
      deviceCount: 5,
      deviceGroup: 'corn-watch-1',
      devicePrefix: '1',
      hasHumidity: true,
      active: true,
    });
    const watch2 = await repo.findById('grain-watch-2');
    expect(watch2).toMatchObject({
      id: 'grain-watch-2',
      name: 'Halle 7',
      description: 'Lagerhalle 7 - inaktiv',
      deviceCount: 5,
      deviceGroup: 'corn-watch-2',
      devicePrefix: '2',
      hasHumidity: false,
      active: false,
    });
  });

  it('is idempotent when called twice', async () => {
    await seedStocks(repo);
    await seedStocks(repo);
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('exports the canonical seed data as SEED_STOCKS', () => {
    expect(SEED_STOCKS.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/db/seed.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the seed module**

`backend/src/db/seed.ts`:
```typescript
import type { StockRepository } from './repositories';
import type { Stock } from './types';

const SEED_TIMESTAMP = '2026-06-02T00:00:00.000Z';

export const SEED_STOCKS: Stock[] = [
  {
    id: 'grain-watch-1',
    name: 'Halle 8',
    description: 'Lagerhalle 8',
    deviceCount: 5,
    deviceGroup: 'corn-watch-1',
    devicePrefix: '1',
    hasHumidity: true,
    active: true,
    createdAt: SEED_TIMESTAMP,
  },
  {
    id: 'grain-watch-2',
    name: 'Halle 7',
    description: 'Lagerhalle 7 - inaktiv',
    deviceCount: 5,
    deviceGroup: 'corn-watch-2',
    devicePrefix: '2',
    hasHumidity: false,
    active: false,
    createdAt: SEED_TIMESTAMP,
  },
];

export async function seedStocks(repo: StockRepository): Promise<void> {
  await repo.upsertMany(SEED_STOCKS);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/db/seed.test.ts
```

Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/db/seed.test.ts backend/src/db/seed.ts
git commit -m "feat(backend): add idempotent stock seed data"
```

---

## Task 12: StockService (TDD)

**Files:**
- Create: `backend/tests/services/stock.service.test.ts`
- Create: `backend/src/services/stock/stock.service.ts`
- Create: `backend/src/services/stock/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createTestDb, TestDb } from '../setup/db';
import { StockRepository } from '../../src/db/repositories';
import { seedStocks } from '../../src/db/seed';
import { StockService } from '../../src/services/stock';

describe('StockService', () => {
  let testDb: TestDb;
  let service: StockService;

  beforeEach(async () => {
    testDb = createTestDb();
    const repo = new StockRepository(testDb.db);
    await seedStocks(repo);
    service = new StockService(repo);
  });

  afterEach(() => testDb.close());

  it('lists seeded stocks', async () => {
    const list = await service.listStocks();
    expect(list.map((s) => s.id).sort()).toEqual(['grain-watch-1', 'grain-watch-2']);
  });

  it('returns a single stock by id', async () => {
    const stock = await service.getStock('grain-watch-1');
    expect(stock?.name).toBe('Halle 8');
  });

  it('returns null for unknown id', async () => {
    expect(await service.getStock('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/services/stock.service.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

`backend/src/services/stock/stock.service.ts`:
```typescript
import type { StockRepository } from '../../db/repositories';
import type { Stock } from '../../db/types';

export class StockService {
  constructor(private readonly repo: StockRepository) {}

  async listStocks(): Promise<Stock[]> {
    return this.repo.findAll();
  }

  async getStock(id: string): Promise<Stock | null> {
    return this.repo.findById(id);
  }
}
```

`backend/src/services/stock/index.ts`:
```typescript
export { StockService } from './stock.service';
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/services/stock.service.test.ts
```

Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/services/stock.service.test.ts backend/src/services/stock
git commit -m "feat(backend): add StockService backed by StockRepository"
```

---

## Task 13: Refactor UserService to use UserRepository

**Files:**
- Modify: `backend/src/services/auth/user.service.ts`
- Modify: `backend/src/services/auth/index.ts`
- Modify: `backend/tests/services/auth/user.service.test.ts`

- [ ] **Step 1: Read existing tests**

Run from repo root:
```bash
cat backend/tests/services/auth/user.service.test.ts | head -80
```

Familiarise yourself with the existing test setup — many cases use a temp JSON file. The structure (CRUD + auth-related behaviour) is being preserved; only the persistence backend changes.

- [ ] **Step 2: Replace test setup with the in-memory DB**

Replace the top of `backend/tests/services/auth/user.service.test.ts` so that each `describe` block uses:
```typescript
import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories';
import { UserService, UserServiceError } from '../../../src/services/auth';

let testDb: TestDb;
let service: UserService;

beforeEach(() => {
  testDb = createTestDb();
  service = new UserService(new UserRepository(testDb.db));
});

afterEach(() => {
  testDb.close();
});
```

Remove every reference to a temp file, `os.tmpdir`, `fs.unlink`, and the old `customFilePath` constructor argument. Keep all behavioural assertions (CRUD, password hashing, duplicate username, stock access wildcard, default-admin init). Where the old tests asserted `code: 'FILE_ERROR'`, change to `code: 'DB_ERROR'`.

- [ ] **Step 3: Rewrite `UserService`**

Replace the entire contents of `backend/src/services/auth/user.service.ts` with:
```typescript
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../../db/repositories';
import { User, UserProfile, UserRole } from '../../models';

export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'USER_NOT_FOUND'
      | 'USERNAME_EXISTS'
      | 'INVALID_INPUT'
      | 'DB_ERROR'
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

export interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  role: UserRole;
  stockAccess: string[];
}

export interface UpdateUserData {
  username?: string;
  password?: string;
  email?: string;
  role?: UserRole;
  stockAccess?: string[];
  active?: boolean;
}

const BCRYPT_SALT_ROUNDS = 10;

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async findUserByUsername(username: string): Promise<User | null> {
    return this.repo.findByUsername(username);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  async getAllUsers(): Promise<UserProfile[]> {
    const users = await this.repo.findAll();
    return users.map((u) => this.toUserProfile(u));
  }

  async createUser(data: CreateUserData): Promise<UserProfile> {
    if (!data.username || data.username.trim().length === 0) {
      throw new UserServiceError('Username is required', 'INVALID_INPUT');
    }
    if (!data.password || data.password.length < 8) {
      throw new UserServiceError('Password must be at least 8 characters', 'INVALID_INPUT');
    }

    const existing = await this.repo.findByUsername(data.username);
    if (existing) {
      throw new UserServiceError(`Username '${data.username}' already exists`, 'USERNAME_EXISTS');
    }

    const id = await this.generateUserId();
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    const user: User = {
      id,
      username: data.username.trim(),
      passwordHash,
      role: data.role,
      stockAccess: data.stockAccess,
      createdAt: new Date().toISOString(),
      active: true,
    };
    const trimmedEmail = data.email?.trim();
    if (trimmedEmail !== undefined && trimmedEmail.length > 0) {
      user.email = trimmedEmail;
    }

    await this.repo.insert(user);
    return this.toUserProfile(user);
  }

  async updateUser(id: string, updates: UpdateUserData): Promise<UserProfile> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new UserServiceError(`User with ID '${id}' not found`, 'USER_NOT_FOUND');
    }

    if (updates.username && updates.username !== existing.username) {
      const duplicate = await this.repo.findByUsername(updates.username);
      if (duplicate) {
        throw new UserServiceError(
          `Username '${updates.username}' already exists`,
          'USERNAME_EXISTS'
        );
      }
    }

    if (updates.password !== undefined && updates.password.length < 8) {
      throw new UserServiceError('Password must be at least 8 characters', 'INVALID_INPUT');
    }

    const patch: Parameters<UserRepository['update']>[1] = {};
    if (updates.username !== undefined) patch.username = updates.username.trim();
    if (updates.role !== undefined) patch.role = updates.role;
    if (updates.active !== undefined) patch.active = updates.active;
    if (updates.stockAccess !== undefined) patch.stockAccess = updates.stockAccess;
    if (updates.password) {
      patch.passwordHash = await bcrypt.hash(updates.password, BCRYPT_SALT_ROUNDS);
    }
    if (updates.email !== undefined) {
      const trimmed = updates.email.trim();
      patch.email = trimmed.length > 0 ? trimmed : null;
    }

    await this.repo.update(id, patch);

    const updated = await this.repo.findById(id);
    if (!updated) {
      throw new UserServiceError('User disappeared after update', 'DB_ERROR');
    }
    return this.toUserProfile(updated);
  }

  async deleteUser(id: string): Promise<boolean> {
    const existed = await this.repo.delete(id);
    if (!existed) {
      throw new UserServiceError(`User with ID '${id}' not found`, 'USER_NOT_FOUND');
    }
    return true;
  }

  canAccessStock(user: User | UserProfile, stockId: string): boolean {
    if (user.stockAccess.includes('*')) return true;
    return user.stockAccess.includes(stockId);
  }

  async initializeDefaultUsers(): Promise<UserProfile | null> {
    const existing = await this.repo.findAll();
    if (existing.length > 0) return null;
    return this.createUser({
      username: 'admin',
      password: 'changeme123',
      role: 'admin',
      stockAccess: ['*'],
    });
  }

  toUserProfile(user: User): UserProfile {
    const profile: UserProfile = {
      id: user.id,
      username: user.username,
      role: user.role,
      stockAccess: user.stockAccess,
    };
    if (user.email !== undefined) profile.email = user.email;
    return profile;
  }

  private async generateUserId(): Promise<string> {
    const existing = await this.repo.findAll();
    const numbers = existing
      .map((u) => {
        const match = u.id.match(/^usr_(\d+)$/);
        const numStr = match?.[1];
        return numStr !== undefined ? parseInt(numStr, 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
    return `usr_${String(next).padStart(3, '0')}`;
  }
}
```

- [ ] **Step 4: Update barrel exports**

`backend/src/services/auth/index.ts`:
```typescript
export {
  UserService,
  UserServiceError,
  CreateUserData,
  UpdateUserData,
} from './user.service';

export {
  AuthService,
  AuthenticationError,
  LoginResult,
  DecodedToken,
} from './auth.service';
```

(No change to exported names — the constructor signature change is internal.)

- [ ] **Step 5: Run UserService tests — expect pass**

```bash
npm test -- tests/services/auth/user.service.test.ts
```

Expected: PASS (all cases). If any case fails because the temp-file setup wasn't fully replaced, finish the migration in the test file.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/auth backend/tests/services/auth/user.service.test.ts
git commit -m "refactor(backend): switch UserService to repository-backed persistence"
```

---

## Task 14: Wire DB into the services container

**Files:**
- Modify: `backend/src/services/index.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { getDb } from '../db';
import { UserRepository, StockRepository } from '../db/repositories';
import { InfluxDBService } from './influx';
import { UserService, AuthService } from './auth';
import { StockService } from './stock';

let _userService: UserService | null = null;
let _authService: AuthService | null = null;
let _stockService: StockService | null = null;

export const influxService = new InfluxDBService();

export function getUserService(): UserService {
  if (!_userService) {
    _userService = new UserService(new UserRepository(getDb()));
  }
  return _userService;
}

export function getAuthService(): AuthService {
  if (!_authService) {
    _authService = new AuthService(getUserService());
  }
  return _authService;
}

export function getStockService(): StockService {
  if (!_stockService) {
    _stockService = new StockService(new StockRepository(getDb()));
  }
  return _stockService;
}

/**
 * Backwards-compatible getters expressed as lazy properties.
 * Existing code can keep using `userService` / `authService`.
 */
export const userService = new Proxy({} as UserService, {
  get(_target, prop) {
    return Reflect.get(getUserService(), prop, getUserService());
  },
});

export const authService = new Proxy({} as AuthService, {
  get(_target, prop) {
    return Reflect.get(getAuthService(), prop, getAuthService());
  },
});

export const stockService = new Proxy({} as StockService, {
  get(_target, prop) {
    return Reflect.get(getStockService(), prop, getStockService());
  },
});

export { InfluxDBService } from './influx';
export { UserService, AuthService, UserServiceError, AuthenticationError } from './auth';
export { StockService } from './stock';
export type {
  CreateUserData,
  UpdateUserData,
  LoginResult,
  DecodedToken,
} from './auth';
export type { DeviceReading, SeriesPoint, HistoryReadings } from './influx';
```

Rationale for the Proxy wrappers: existing controllers import the singletons by name. Lazy resolution lets us defer instantiation until after `initDb()` runs in `bootstrap.ts`.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/index.ts
git commit -m "feat(backend): wire DB-backed user/auth/stock services with lazy resolution"
```

---

## Task 15: Update configuration

**Files:**
- Modify: `backend/src/config/index.ts`

- [ ] **Step 1: Replace `usersFilePath` with `database`**

In `backend/src/config/index.ts`:

- Remove the `usersFilePath` field from the `Config` interface.
- Add a `DatabaseConfig` interface and a `database` field.

```typescript
interface DatabaseConfig {
  /** Absolute or relative path to the SQLite file, or ':memory:' for tests. */
  path: string;
}

interface Config {
  port: number;
  nodeEnv: string;
  jwt: JWTConfig;
  influxdb: InfluxDBConfig;
  database: DatabaseConfig;
}
```

Replace the `config` object's last property:
```typescript
database: {
  path: getEnvVar('DATABASE_PATH', './data/grainwatch.db'),
},
```

(Delete the `usersFilePath: getEnvVar('USERS_FILE_PATH', './data/users.json'),` line.)

Also update the JSDoc comment at the top of `config` to replace the `USERS_FILE_PATH` reference with `DATABASE_PATH`.

- [ ] **Step 2: Update the export type list**

At the bottom of the file:
```typescript
export type { Config, InfluxDBConfig, JWTConfig, DatabaseConfig };
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: errors only in `bootstrap.ts` (still references old field) — that's intentional, fixed in the next task.

- [ ] **Step 4: Commit (with bootstrap fix from next task)**

Don't commit yet — bundle with Task 16.

---

## Task 16: Wire bootstrap to open + migrate + seed the DB

**Files:**
- Modify: `backend/src/bootstrap.ts`

- [ ] **Step 1: Rewrite `bootstrap.ts`**

```typescript
import { config } from './config';
import { initDb, closeDb } from './db';
import { runMigrations } from './db/migrate';
import { seedStocks } from './db/seed';
import { StockRepository } from './db/repositories';
import { getUserService } from './services';

interface BootstrapResult {
  defaultUsersCreated: boolean;
  defaultAdminUsername?: string;
}

export async function bootstrapApplication(): Promise<BootstrapResult> {
  const result: BootstrapResult = { defaultUsersCreated: false };

  const db = initDb({ path: config.database.path });
  runMigrations(db);
  await seedStocks(new StockRepository(db));

  try {
    const adminProfile = await getUserService().initializeDefaultUsers();
    if (adminProfile !== null) {
      result.defaultUsersCreated = true;
      result.defaultAdminUsername = adminProfile.username;
      console.log('\n========================================');
      console.log('Default Admin User Created');
      console.log('========================================');
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Username: ${adminProfile.username}`);
      console.log('Password: changeme123');
      console.log('========================================');
      console.log('IMPORTANT: Change the default password immediately!');
      console.log('========================================\n');
    } else {
      console.log('User bootstrap: Users already exist, skipping default user creation');
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to bootstrap application:', message);
    closeDb();
    throw new Error(`Bootstrap failed: ${message}`);
  }
}

export async function validateBootstrap(): Promise<boolean> {
  try {
    const users = await getUserService().getAllUsers();
    return users.length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Bootstrap validation failed:', message);
    return false;
  }
}
```

Behaviour change: bootstrap no longer swallows failures in development. Any failure here means the DB is unusable and the server should not start.

- [ ] **Step 2: Hook graceful shutdown**

Open `backend/src/index.ts` and add a shutdown hook after the server starts. Find the existing `process.on('SIGTERM', ...)` (or similar) and add a `closeDb()` call inside it. If no shutdown hook exists yet, add at the end of the file:

```typescript
import { closeDb } from './db';

const shutdown = (signal: string) => {
  console.log(`Received ${signal}, shutting down…`);
  closeDb();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

(Read the file first to confirm the right insertion point — there may already be shutdown handling.)

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit (config + bootstrap together)**

```bash
git add backend/src/config/index.ts backend/src/bootstrap.ts backend/src/index.ts
git commit -m "feat(backend): wire SQLite into bootstrap and shutdown lifecycle"
```

---

## Task 17: Replace STOCK_METADATA in stocks controller

**Files:**
- Modify: `backend/src/controllers/stocks.controller.ts`

- [ ] **Step 1: Read the full controller**

```bash
cat backend/src/controllers/stocks.controller.ts
```

Note every reference to `STOCK_METADATA`. Each one will become a `stockService` call.

- [ ] **Step 2: Apply edits**

- Remove the `interface StockMetadata { ... }` block and the `const STOCK_METADATA: Record<string, StockMetadata> = { ... }` block.
- Import `StockService` and the `Stock` type, and inject the service via constructor.

Replace the class declaration and constructor with:
```typescript
import { InfluxDBService, SeriesPoint, StockService } from '../services';
import type { Stock } from '../db/types';

// (keep other imports as they are)

export class StocksController {
  constructor(
    private readonly influxService: InfluxDBService,
    private readonly stockService: StockService
  ) {}
```

Then for each existing usage:
- `Object.keys(STOCK_METADATA).filter(...)` → `(await this.stockService.listStocks()).filter((s) => hasStockAccess(user, s.id))`
- `STOCK_METADATA[stockId]` → `await this.stockService.getStock(stockId)`
- The shape returned by `getStock` matches the previous `StockMetadata` 1:1 (field-for-field), so downstream property accesses (`metadata.name`, `metadata.deviceGroup`, etc.) are unchanged.

Be sure to await the new promise calls and adjust types where appropriate.

- [ ] **Step 3: Update wherever the controller is instantiated**

Search for `new StocksController(`:
```bash
grep -rn "new StocksController" backend/src
```

Update each instantiation to pass `stockService` as the second argument. Typically this is in `backend/src/routes/stocks.routes.ts` or `backend/src/app.ts` — add the import and pass `stockService` from `../services`.

- [ ] **Step 4: Run controller tests**

```bash
npm test -- tests/controllers
```

Expected: tests pass. If any test instantiated `StocksController` directly, update its constructor call too (pass a mock `StockService` or use a real one backed by `createTestDb`).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/stocks.controller.ts backend/src/routes backend/src/app.ts backend/tests
git commit -m "refactor(backend): consume StockService instead of hard-coded STOCK_METADATA"
```

(Only stage files you actually touched.)

---

## Task 18: Docker — install build toolchain and ship migrations

**Files:**
- Modify: `backend/Dockerfile`

- [ ] **Step 1: Add native build tools to the dependencies stage**

In `backend/Dockerfile`, change the `dependencies` stage:

```dockerfile
FROM node:24-alpine AS dependencies

WORKDIR /app

# Native build tools required by better-sqlite3 (node-gyp)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci
```

- [ ] **Step 2: Copy the drizzle/ directory into the runtime image**

In the `production` stage, after `COPY --from=builder --chown=appuser:nodejs /app/dist ./dist`, add:

```dockerfile
# Migration files (SQL + meta) generated by drizzle-kit
COPY --from=builder --chown=appuser:nodejs /app/drizzle ./drizzle
```

Also in the `builder` stage, ensure the `drizzle/` directory is copied alongside `src`:

```dockerfile
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
```

- [ ] **Step 3: Build the image locally**

From the repo root:
```bash
docker build -f backend/Dockerfile -t grainwatch-controller:test backend
```

Expected: the build completes without `node-gyp` errors and produces an image.

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile
git commit -m "build(backend): support native better-sqlite3 build and ship migrations"
```

---

## Task 19: Update docker-compose and .env.example

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/.env.example`

- [ ] **Step 1: docker-compose.yml**

In `docker-compose.yml`, inside the `grainwatch-controller.environment` list:
- Remove the line `- USERS_FILE_PATH=/app/data/users.json`
- Add `- DATABASE_PATH=/app/data/grainwatch.db`

The volume mount stays the same (`./backend/data:/app/data:rw`).

- [ ] **Step 2: backend/.env.example**

Replace the entire `# User Storage` section with:
```env
# -----------------------------------------------------------------------------
# Database (SQLite)
# -----------------------------------------------------------------------------

# Path to the SQLite database file
# For Docker deployment, this path is inside the container
# Default: ./data/grainwatch.db
DATABASE_PATH=/app/data/grainwatch.db

# NOTE: On first startup, if no users exist, a default admin user is created:
# Username: admin
# Password: changeme123
# IMPORTANT: Change this password immediately after first login!
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml backend/.env.example
git commit -m "chore: replace USERS_FILE_PATH with DATABASE_PATH in deployment config"
```

---

## Task 20: Clean up obsolete files and gitignore the DB

**Files:**
- Delete: `backend/data/users.json`
- Delete: `backend/data/test-users.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

Append (or merge into existing backend section):
```
# SQLite database files
backend/data/*.db
backend/data/*.db-wal
backend/data/*.db-shm
```

Keep `backend/data/` itself tracked (e.g., with a `.gitkeep` if needed) so the Docker volume mount target exists in the image:
```bash
touch backend/data/.gitkeep
```

- [ ] **Step 2: Remove obsolete JSON files**

```bash
git rm backend/data/users.json backend/data/test-users.json
```

- [ ] **Step 3: Verify no lingering references**

```bash
grep -rn "users.json\|USERS_FILE_PATH\|usersFilePath\|STOCK_METADATA" backend/src backend/tests docker-compose.yml backend/.env.example
```

Expected: no hits.

- [ ] **Step 4: Run full test + typecheck + lint**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add .gitignore backend/data/.gitkeep
git commit -m "chore(backend): remove obsolete JSON user store and ignore SQLite files"
```

---

## Task 21: Acceptance smoke run

**Files:** none modified.

- [ ] **Step 1: Start the dev server fresh**

```bash
rm -f backend/data/grainwatch.db backend/data/grainwatch.db-wal backend/data/grainwatch.db-shm
npm run dev:backend
```

Expected log lines (in order):
- (no error opening the DB)
- "Default Admin User Created" block with username `admin` and password `changeme123`
- Server listening on the configured port

Leave the server running.

- [ ] **Step 2: Verify login**

In a second terminal:
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}'
```

Expected: JSON response containing a JWT token.

- [ ] **Step 3: Verify stocks endpoint**

Capture the token from Step 2 (`TOKEN=...`), then:
```bash
curl -s http://localhost:3000/api/v1/stocks -H "Authorization: Bearer $TOKEN"
```

Expected: JSON with two stocks (`grain-watch-1`, `grain-watch-2`) and metadata matching the seed values exactly. Stop the dev server.

- [ ] **Step 4: Restart and verify persistence**

```bash
npm run dev:backend
```

Expected log: "User bootstrap: Users already exist, skipping default user creation". The DB file should still exist; stocks are not re-seeded with surprises (idempotency).

- [ ] **Step 5: Docker compose smoke**

```bash
docker compose up --build
```

Wait for `grainwatch-controller` healthcheck to succeed (`docker compose ps`). Repeat the login + stocks curl commands against `http://localhost:3000`. Expected: same successful behaviour.

```bash
docker compose down
```

- [ ] **Step 6: No-op commit gate**

If everything passed, nothing to commit. If you fixed anything during the smoke run, commit those fixes with a clear scope-prefixed message.

---

## Self-Review Notes

- Spec coverage: every acceptance criterion in the spec maps to at least one task — Tasks 3–6 (schema, migrations, connection), Task 11 (stock seed = AC#3), Task 16 (boot wiring = AC#1), Task 20 (cleanup = AC#4, AC#5), Tasks 7–13 (tests = AC#6), Tasks 18–19 (Docker = AC#7), Task 21 (acceptance run = AC#1, AC#2, AC#7), plus full typecheck/lint enforcement (AC#8).
- Type consistency: `Stock` type lives in `backend/src/db/types.ts` and is reused by `StockRepository`, `StockService`, seed data, and the stocks controller. `User` continues to be sourced from `backend/src/models`. `UserServiceError.code` enum is updated to `DB_ERROR` everywhere.
- No placeholders, all SQL and code shown in full; no "similar to Task N" shortcuts.
