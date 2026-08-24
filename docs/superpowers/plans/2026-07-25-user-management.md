# User Management & Password Self-Service Implementation Plan

**Status:** Implemented (2026-08-24) — all eight tasks are on `main`, commits
`e8fdb14`..`71d2504`. Backend 364 tests, frontend 62 tests, typecheck and lint
clean across both workspaces. The two manual smoke-check steps (Task 7 Step 6,
Task 8 Step 5) remain unticked: they are covered implicitly by the automated
suites and have not been walked through by hand.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user change their own password from the UI, and let admins create/edit/deactivate users and reset passwords, with new/reset passwords forcing a change on next login.

**Architecture:** Reuse the existing SQLite-backed user model and admin endpoints. Add one DB column (`must_change_password`), two backend endpoints (self-service change + admin reset), carry the flag through JWT/login, and build the React screens (`/account`, `/admin/users`) plus a lightweight `Dialog` primitive and route guards.

**Tech Stack:** Backend — Express 4, TypeScript, Drizzle ORM + better-sqlite3, Zod, bcrypt, JWT, Jest + Supertest. Frontend — React 19, Vite, React Router 7, Axios, Tailwind 4, Vitest + Testing Library.

## Global Constraints

- All code, comments, UI copy and commit messages in English (UK spelling: "authorise", "colour", "behaviour").
- German "Halle" is always rendered as **stock** — never "hall".
- Password policy everywhere: **min 8, max 100 characters** (matches existing Zod rules).
- `mustChangePassword` is treated as `false` whenever absent/undefined (optional field, DB column is `NOT NULL DEFAULT false`).
- Follow existing patterns: hand-rolled forms with `useState`, inline destructive alert boxes for errors (no toast library), reuse `Button`/`Input`/`Card`, `cn()` for classes. New UI text in English.
- Backend commands run from `backend/`; frontend commands from `frontend/`.
- Commit after every task.

---

### Task 1: Add `mustChangePassword` to the data model

**Files:**
- Modify: `backend/src/db/schema.ts:3-11`
- Modify: `backend/src/db/repositories/user.repository.ts`
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/services/auth/user.service.ts`
- Create: `backend/drizzle/0002_must_change_password.sql` (generated)
- Test: `backend/tests/unit/services/user.mustChangePassword.test.ts`

**Interfaces:**
- Produces: `User.mustChangePassword?: boolean`, `UserProfile.mustChangePassword?: boolean`, `CreateUserData.mustChangePassword?: boolean`, `UpdateUserData.mustChangePassword?: boolean`; the `users` table column `must_change_password`.

- [x] **Step 1: Write the failing test**

Create `backend/tests/unit/services/user.mustChangePassword.test.ts`:

```ts
import { createTestDb, TestDb } from '../../setup/db';
import { UserRepository } from '../../../src/db/repositories';
import { UserService } from '../../../src/services/auth';

describe('mustChangePassword persistence', () => {
  let testDb: TestDb;
  let service: UserService;

  beforeEach(() => {
    testDb = createTestDb();
    service = new UserService(new UserRepository(testDb.db));
  });

  afterEach(() => testDb.close());

  it('defaults mustChangePassword to false when not provided', async () => {
    const profile = await service.createUser({
      username: 'u1',
      password: 'password123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
    });
    const user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(false);
  });

  it('persists mustChangePassword=true and can clear it', async () => {
    const profile = await service.createUser({
      username: 'u2',
      password: 'password123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
      mustChangePassword: true,
    });
    let user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(true);

    await service.updateUser(profile.id, { mustChangePassword: false });
    user = await service.findUserById(profile.id);
    expect(user?.mustChangePassword).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/unit/services/user.mustChangePassword.test.ts`
Expected: FAIL — TypeScript error `mustChangePassword` does not exist on `CreateUserData`/`User`, or assertion fails.

- [x] **Step 3: Add the schema column**

In `backend/src/db/schema.ts`, add the column to the `users` table (after `active`):

```ts
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email'),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  createdAt: text('created_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull()
    .default(false),
});
```

- [x] **Step 4: Generate the migration**

Run: `cd backend && npm run db:generate -- --name must_change_password`
Expected: a new file `backend/drizzle/0002_must_change_password.sql` containing:

```sql
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;
```

If the generated SQL differs materially (e.g. table rebuild), inspect it and keep it — better-sqlite3 `ADD COLUMN` with a constant default is expected.

- [x] **Step 5: Add the field to model interfaces**

In `backend/src/models/user.model.ts`:
- Add to `interface User` (after `active`): `  /** Whether the user must change their password on next login */\n  mustChangePassword?: boolean;`
- Add to `interface UserProfile` (after `stockAccess`): `  /** Whether the user must change their password on next login */\n  mustChangePassword?: boolean;`

- [x] **Step 6: Propagate through the repository**

In `backend/src/db/repositories/user.repository.ts`:

In `insert()` values object, add after `active: user.active,`:
```ts
          mustChangePassword: user.mustChangePassword ?? false,
```

In `update()` patch parameter type, add `mustChangePassword?: boolean;` and in the scalar block add after the `active` line:
```ts
      if (patch.mustChangePassword !== undefined)
        scalarUpdates['mustChangePassword'] = patch.mustChangePassword;
```

In `toUser()`, add to the `user` object after `active: row.active,`:
```ts
      mustChangePassword: row.mustChangePassword,
```

- [x] **Step 7: Propagate through the service**

In `backend/src/services/auth/user.service.ts`:
- Add `mustChangePassword?: boolean;` to `interface CreateUserData` and to `interface UpdateUserData`.
- In `createUser()`, in the `user: User` literal add after `active: true,`:
  ```ts
      mustChangePassword: data.mustChangePassword ?? false,
  ```
- In `updateUser()`, after the `stockAccess` patch line, add:
  ```ts
    if (updates.mustChangePassword !== undefined)
      patch.mustChangePassword = updates.mustChangePassword;
  ```
- In `toUserProfile()`, add to the `profile` object after `stockAccess: user.stockAccess,`:
  ```ts
      mustChangePassword: user.mustChangePassword,
  ```

- [x] **Step 8: Run test to verify it passes**

Run: `cd backend && npx jest tests/unit/services/user.mustChangePassword.test.ts`
Expected: PASS (2 tests).

- [x] **Step 9: Run the full backend suite to check for regressions**

Run: `cd backend && npm test`
Expected: PASS (existing tests unaffected — the field is optional and defaults to false).

- [x] **Step 10: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/ backend/src/models/user.model.ts backend/src/db/repositories/user.repository.ts backend/src/services/auth/user.service.ts backend/tests/unit/services/user.mustChangePassword.test.ts
git commit -m "feat(backend): add mustChangePassword flag to user model"
```

---

### Task 2: Carry `mustChangePassword` through JWT and login

**Files:**
- Modify: `backend/src/models/user.model.ts` (`JWTPayload`)
- Modify: `backend/src/services/auth/auth.service.ts` (`DecodedToken`, `generateToken`, `verifyToken`)
- Modify: `backend/src/middleware/auth.middleware.ts` (`authenticate`)
- Modify: `backend/src/controllers/auth.controller.ts` (`login` response)
- Test: `backend/tests/unit/services/auth.mustChangePassword.test.ts`

**Interfaces:**
- Consumes: `User.mustChangePassword` (Task 1).
- Produces: `DecodedToken.mustChangePassword: boolean`; login response `user.mustChangePassword`; `req.user.mustChangePassword` set by `authenticate`.

- [x] **Step 1: Write the failing test**

Create `backend/tests/unit/services/auth.mustChangePassword.test.ts`:

```ts
import { AuthService } from '../../../src/services/auth';
import type { User } from '../../../src/models';

jest.mock('../../../src/config', () => ({
  config: {
    jwt: {
      secret: 'test-secret-key-for-testing-only-must-be-long-enough',
      expiresIn: '15m',
      refreshSecret: 'test-refresh-secret-key-must-also-be-long-enough',
      refreshExpiresIn: '30d',
    },
  },
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_001',
    username: 'admin',
    passwordHash: 'hash',
    role: 'admin',
    stockAccess: ['*'],
    createdAt: '2026-01-01T00:00:00Z',
    active: true,
    ...overrides,
  };
}

describe('AuthService JWT mustChangePassword claim', () => {
  const auth = new AuthService();

  it('encodes and decodes mustChangePassword=true', () => {
    const token = auth.generateToken(makeUser({ mustChangePassword: true }));
    expect(auth.verifyToken(token).mustChangePassword).toBe(true);
  });

  it('defaults to false when the user flag is absent', () => {
    const token = auth.generateToken(makeUser());
    expect(auth.verifyToken(token).mustChangePassword).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/unit/services/auth.mustChangePassword.test.ts`
Expected: FAIL — `mustChangePassword` missing on `DecodedToken`.

- [x] **Step 3: Add the JWT claim**

In `backend/src/models/user.model.ts`, add to `interface JWTPayload` (after `stockAccess`):
```ts
  /** Whether the user must change their password on next login */
  mustChangePassword?: boolean;
```

In `backend/src/services/auth/auth.service.ts`:
- Add to `interface DecodedToken` (after `stockAccess`): `  /** Whether the user must change their password on next login */\n  mustChangePassword: boolean;`
- In `generateToken()`, add to the `payload` object after `stockAccess: user.stockAccess,`:
  ```ts
      mustChangePassword: user.mustChangePassword ?? false,
  ```
- In `verifyToken()`, add to the returned object after `stockAccess: decoded.stockAccess as string[],`:
  ```ts
        mustChangePassword: decoded.mustChangePassword === true,
  ```
  (Leniently coerced — old tokens without the claim decode to `false`, so existing tests keep passing.)

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/unit/services/auth.mustChangePassword.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Expose the flag on `req.user` and in the login response**

In `backend/src/middleware/auth.middleware.ts`, in `authenticate()` add to the `userProfile` object after `stockAccess: decoded.stockAccess,`:
```ts
      mustChangePassword: decoded.mustChangePassword,
```

In `backend/src/controllers/auth.controller.ts`, in `login()` add to the response `user` object after `stockAccess: decoded.stockAccess,`:
```ts
          mustChangePassword: decoded.mustChangePassword,
```

- [x] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/services/auth/auth.service.ts backend/src/middleware/auth.middleware.ts backend/src/controllers/auth.controller.ts backend/tests/unit/services/auth.mustChangePassword.test.ts
git commit -m "feat(backend): carry mustChangePassword through JWT and login"
```

---

### Task 3: Self-service change-password endpoint

**Files:**
- Modify: `backend/src/middleware/validation.middleware.ts` (schemas)
- Modify: `backend/src/middleware/index.ts` (exports)
- Modify: `backend/src/services/auth/auth.service.ts` (`changePassword`)
- Modify: `backend/src/controllers/auth.controller.ts` (`changePassword` handler)
- Modify: `backend/src/routes/auth.routes.ts` (route)
- Test: `backend/tests/integration/auth.password.test.ts`

**Interfaces:**
- Consumes: `AuthService`, `UserService.updateUser`, `authenticate`, `validateBody`.
- Produces: `changePasswordSchema`, `ChangePasswordRequest`; `AuthService.changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>`; endpoint `POST /api/v1/auth/change-password` (204 on success).

- [x] **Step 1: Write the failing integration test**

Create `backend/tests/integration/auth.password.test.ts`:

```ts
import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { UserRepository } from '../../src/db/repositories';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    jwt: { secret: 'test-secret-key-for-testing-only-must-be-long-enough', expiresIn: '24h' },
    influxdb: { url: 'http://localhost:8086', token: 'test-token', org: 'test-org', bucket: 'testdb', measurement: 'Temp' },
  },
}));

jest.mock('../../src/services/influx/influx.service', () => ({
  InfluxDBService: jest.fn().mockImplementation(() => ({
    getDeviceGroups: jest.fn().mockResolvedValue(['corn-watch-1']),
    getLatestReadings: jest.fn().mockResolvedValue([]),
    testConnection: jest.fn().mockResolvedValue(true),
  })),
  isValidWindowDuration: jest.fn().mockReturnValue(true),
}));

function createToken(payload: { userId: string; username: string; role: 'admin' | 'viewer'; stockAccess: string[] }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('POST /api/v1/auth/change-password', () => {
  let app: Express;
  let userService: UserService;
  let viewerToken: string;

  beforeAll(() => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    userService = new UserService(new UserRepository(getDb()));
    setAuthService(new AuthService(userService));
    app = createApp();
    finaliseApp(app);
  });

  afterAll(() => {
    setAuthService(null);
    closeDb();
  });

  beforeEach(async () => {
    for (const u of await userService.listFullUsers()) await userService.deleteUser(u.id);
    const viewer = await userService.createUser({
      username: 'testviewer',
      password: 'viewerpassword123',
      role: 'viewer',
      stockAccess: ['corn-watch-1'],
      mustChangePassword: true,
    });
    viewerToken = createToken({ userId: viewer.id, username: 'testviewer', role: 'viewer', stockAccess: ['corn-watch-1'] });
  });

  it('changes the password with a correct current password and clears the flag', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'viewerpassword123', newPassword: 'brandnewpass123' });

    expect(res.status).toBe(204);
    const updated = await userService.findUserByUsername('testviewer');
    expect(updated?.mustChangePassword).toBe(false);
    const matches = await new AuthService(userService).comparePasswords('brandnewpass123', updated!.passwordHash);
    expect(matches).toBe(true);
  });

  it('rejects a wrong current password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'brandnewpass123' });
    expect(res.status).toBe(401);
  });

  it('rejects a too-short new password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'viewerpassword123', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'viewerpassword123', newPassword: 'brandnewpass123' });
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/integration/auth.password.test.ts`
Expected: FAIL — route returns 404 (endpoint not defined).

- [x] **Step 3: Add the validation schema + export**

In `backend/src/middleware/validation.middleware.ts`, after the `loginSchema`/`LoginRequest` block add:

```ts
/**
 * Self-service password change request body schema.
 */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password is required')
    .max(100, 'Password must be at most 100 characters'),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from changePasswordSchema */
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

/**
 * Admin password reset request body schema.
 */
export const resetPasswordSchema = z.object({
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

/** Type inferred from resetPasswordSchema */
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;
```

In `backend/src/middleware/index.ts`, add `changePasswordSchema,` and `resetPasswordSchema,` to the value export from `./validation.middleware`, and add `ChangePasswordRequest,` and `ResetPasswordRequest,` to the `export type { ... }` block.

- [x] **Step 4: Add `AuthService.changePassword`**

In `backend/src/services/auth/auth.service.ts`, add a method to the `AuthService` class (after `refreshAccessToken`):

```ts
  /**
   * Changes a user's password after verifying their current one.
   *
   * Clears the mustChangePassword flag on success.
   *
   * @param userId - ID of the user changing their password
   * @param currentPassword - The user's current plain text password
   * @param newPassword - The desired new plain text password
   * @throws AuthenticationError if the user is missing or the current password is wrong
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const userService = this.requireUserService();
    const user = await userService.findUserById(userId);

    if (!user) {
      throw new AuthenticationError('User not found', 'INVALID_CREDENTIALS');
    }

    const valid = await this.comparePasswords(currentPassword, user.passwordHash);
    if (!valid) {
      throw new AuthenticationError(
        'Current password is incorrect',
        'INVALID_CREDENTIALS'
      );
    }

    await userService.updateUser(userId, {
      password: newPassword,
      mustChangePassword: false,
    });
  }
```

- [x] **Step 5: Add the controller handler**

In `backend/src/controllers/auth.controller.ts`:
- Update the import on line 9 to include `UserServiceError`:
  ```ts
  import { AuthService, AuthenticationError, UserServiceError } from '../services/auth';
  ```
- Import the request type at the top (after the `LoginRequest` import):
  ```ts
  import { ChangePasswordRequest } from '../middleware';
  ```
- Add a handler method (after `logout`):

```ts
  /**
   * Handles self-service password changes.
   *
   * POST /api/v1/auth/change-password (authenticated)
   *
   * @param req - Express request with authenticated user and validated body
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async changePassword(
    req: Request<object, unknown, ChangePasswordRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: 'You must be logged in to change your password' },
        });
        return;
      }

      const { currentPassword, newPassword } = req.body;
      await this.authService.changePassword(user.id, currentPassword, newPassword);
      res.status(204).send();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        const statusCode = this.getAuthErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: { code: this.mapErrorCode(error.code), message: error.message, details: this.getErrorDetails(error.code) },
        });
        return;
      }
      if (error instanceof UserServiceError) {
        res.status(400).json({ error: { code: error.code, message: error.message, details: 'The provided input data is invalid' } });
        return;
      }
      next(error);
    }
  }
```

- [x] **Step 6: Wire the route**

In `backend/src/routes/auth.routes.ts`:
- Update the import to add `authenticate` and `changePasswordSchema`:
  ```ts
  import { validateBody, loginSchema, changePasswordSchema, authenticate, getAuthService } from '../middleware';
  ```
- Add the route before `return router;`:

```ts
  /**
   * POST /change-password
   *
   * Change the authenticated user's own password. Clears the
   * mustChangePassword flag on success.
   *
   * Response: 204 No Content
   * Errors: 400 validation, 401 unauthenticated or wrong current password
   */
  router.post(
    '/change-password',
    authenticate,
    validateBody(changePasswordSchema),
    (req, res, next) => controller.changePassword(req, res, next)
  );
```

- [x] **Step 7: Run test to verify it passes**

Run: `cd backend && npx jest tests/integration/auth.password.test.ts`
Expected: PASS (4 tests).

- [x] **Step 8: Typecheck + full suite**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add backend/src/middleware/validation.middleware.ts backend/src/middleware/index.ts backend/src/services/auth/auth.service.ts backend/src/controllers/auth.controller.ts backend/src/routes/auth.routes.ts backend/tests/integration/auth.password.test.ts
git commit -m "feat(backend): add self-service change-password endpoint"
```

---

### Task 4: Admin reset-password endpoint + force-change on create

**Files:**
- Modify: `backend/src/controllers/admin.controller.ts` (`createUser`, `resetPassword`)
- Modify: `backend/src/routes/admin.routes.ts` (route)
- Modify: `backend/src/services/auth/user.service.ts` (`initializeDefaultUsers`)
- Test: `backend/tests/integration/admin.password.test.ts`

**Interfaces:**
- Consumes: `UserService.updateUser`, `resetPasswordSchema`, `userIdParamsSchema`, `validateParams`, `validateBody`, `requireRole`.
- Produces: endpoint `POST /api/v1/admin/users/:userId/reset-password` (204); admin-created users have `mustChangePassword=true`; the seeded default admin has `mustChangePassword=true`.

- [x] **Step 1: Write the failing integration test**

Create `backend/tests/integration/admin.password.test.ts` (same harness as `admin.test.ts`):

```ts
import request from 'supertest';
import { Express } from 'express';
import * as jwt from 'jsonwebtoken';
import { createApp, finaliseApp } from '../../src/app';
import { initDb, closeDb, getDb } from '../../src/db';
import { runMigrations } from '../../src/db/migrate';
import { UserRepository } from '../../src/db/repositories';
import { UserService, AuthService } from '../../src/services/auth';
import { setAuthService } from '../../src/middleware';

const JWT_SECRET = 'test-secret-key-for-testing-only-must-be-long-enough';

jest.mock('../../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    jwt: { secret: 'test-secret-key-for-testing-only-must-be-long-enough', expiresIn: '24h' },
    influxdb: { url: 'http://localhost:8086', token: 'test-token', org: 'test-org', bucket: 'testdb', measurement: 'Temp' },
  },
}));

jest.mock('../../src/services/influx/influx.service', () => ({
  InfluxDBService: jest.fn().mockImplementation(() => ({
    getDeviceGroups: jest.fn().mockResolvedValue(['corn-watch-1']),
    getLatestReadings: jest.fn().mockResolvedValue([]),
    testConnection: jest.fn().mockResolvedValue(true),
  })),
  isValidWindowDuration: jest.fn().mockReturnValue(true),
}));

function createToken(payload: { userId: string; username: string; role: 'admin' | 'viewer'; stockAccess: string[] }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('Admin password management', () => {
  let app: Express;
  let userService: UserService;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(() => {
    initDb({ path: ':memory:' });
    runMigrations(getDb());
    userService = new UserService(new UserRepository(getDb()));
    setAuthService(new AuthService(userService));
    app = createApp();
    finaliseApp(app);
  });

  afterAll(() => {
    setAuthService(null);
    closeDb();
  });

  beforeEach(async () => {
    for (const u of await userService.listFullUsers()) await userService.deleteUser(u.id);
    const admin = await userService.createUser({ username: 'testadmin', password: 'adminpassword123', role: 'admin', stockAccess: ['*'] });
    const viewer = await userService.createUser({ username: 'testviewer', password: 'viewerpassword123', role: 'viewer', stockAccess: ['corn-watch-1'] });
    adminToken = createToken({ userId: admin.id, username: 'testadmin', role: 'admin', stockAccess: ['*'] });
    viewerToken = createToken({ userId: viewer.id, username: 'testviewer', role: 'viewer', stockAccess: ['corn-watch-1'] });
  });

  it('admin resets a password (204) and forces a change', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'resetpass123456' });

    expect(res.status).toBe(204);
    const updated = await userService.findUserByUsername('testviewer');
    expect(updated?.mustChangePassword).toBe(true);
    const matches = await new AuthService(userService).comparePasswords('resetpass123456', updated!.passwordHash);
    expect(matches).toBe(true);
  });

  it('rejects a reset for a non-admin caller (403)', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ newPassword: 'resetpass123456' });
    expect(res.status).toBe(403);
  });

  it('rejects a too-short reset password (400)', async () => {
    const viewer = await userService.findUserByUsername('testviewer');
    const res = await request(app)
      .post(`/api/v1/admin/users/${viewer?.id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users/usr_999/reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'resetpass123456' });
    expect(res.status).toBe(404);
  });

  it('admin-created users must change their password', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'freshuser', password: 'temppass123456', role: 'viewer', stockAccess: ['corn-watch-1'] });

    expect(res.status).toBe(201);
    const created = await userService.findUserByUsername('freshuser');
    expect(created?.mustChangePassword).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/integration/admin.password.test.ts`
Expected: FAIL — reset route 404; create-forces-change assertion fails (flag is false).

- [x] **Step 3: Force change on admin-created users**

In `backend/src/controllers/admin.controller.ts`:
- Update the import on line 11 to include `UserServiceError` (already imported) — confirm `UserServiceError` is in the import list.
- In `createUser()`, change the `createData` literal to set the flag:

```ts
      const createData: CreateUserData = {
        username,
        password,
        role,
        stockAccess,
        mustChangePassword: true,
      };
```

- [x] **Step 4: Add the `resetPassword` handler**

In `backend/src/controllers/admin.controller.ts`, add a method to `AdminController` (after `updateUserStatus`):

```ts
  /**
   * Resets a user's password and forces a change on their next login.
   *
   * POST /api/v1/admin/users/:userId/reset-password
   *
   * @param req - Express request with userId param and validated body
   * @param res - Express response object
   * @param next - Express next function for error handling
   */
  async resetPassword(
    req: Request<ParamsDictionary, unknown, { newPassword: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.params['userId'] as string;
      const { newPassword } = req.body;

      await this.userService.updateUser(userId, {
        password: newPassword,
        mustChangePassword: true,
      });

      res.status(204).send();
    } catch (error) {
      if (error instanceof UserServiceError) {
        const statusCode = this.getUserErrorStatusCode(error.code);
        res.status(statusCode).json({
          error: { code: error.code, message: error.message, details: this.getUserErrorDetails(error.code) },
        });
        return;
      }
      next(error);
    }
  }
```

- [x] **Step 5: Wire the route**

In `backend/src/routes/admin.routes.ts`:
- Add `resetPasswordSchema` to the import from `../middleware`.
- Add the route after the `PATCH /users/:userId` block, before `return router;`:

```ts
  /**
   * POST /users/:userId/reset-password
   *
   * Reset a user's password to a temporary value and force a change on next
   * login.
   *
   * Response: 204 No Content
   * Errors: 400 validation, 401 unauthenticated, 403 admin required, 404 not found
   */
  router.post(
    '/users/:userId/reset-password',
    validateParams(userIdParamsSchema),
    validateBody(resetPasswordSchema),
    (req, res, next) => controller.resetPassword(req, res, next)
  );
```

- [x] **Step 6: Force change on the seeded admin**

In `backend/src/services/auth/user.service.ts`, in `initializeDefaultUsers()` add `mustChangePassword: true,` to the `createUser` argument:

```ts
    return this.createUser({
      username: 'admin',
      password: 'changeme123',
      role: 'admin',
      stockAccess: ['*'],
      mustChangePassword: true,
    });
```

- [x] **Step 7: Run test to verify it passes**

Run: `cd backend && npx jest tests/integration/admin.password.test.ts`
Expected: PASS (5 tests).

- [x] **Step 8: Typecheck + full suite**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add backend/src/controllers/admin.controller.ts backend/src/routes/admin.routes.ts backend/src/services/auth/user.service.ts backend/tests/integration/admin.password.test.ts
git commit -m "feat(backend): admin reset-password endpoint and force-change on create"
```

---

### Task 5: Frontend API layer + types + access helpers

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/admin.ts`
- Modify: `frontend/src/api/index.ts`
- Create: `frontend/src/lib/access.ts`
- Test: `frontend/src/lib/access.test.ts`

**Interfaces:**
- Produces: `User.mustChangePassword?: boolean`; `ChangePasswordRequest`, `AdminUser`, `AdminUsersResponse`, `CreateUserRequest`, `UpdatePermissionsRequest` types; `authApi.changePassword`; `adminApi` (`listUsers`, `createUser`, `updatePermissions`, `resetPassword`, `setActive`); `shouldForcePasswordChange(user, pathname)` and `isAdmin(user)` helpers.

- [x] **Step 1: Write the failing helper test**

Create `frontend/src/lib/access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldForcePasswordChange, isAdmin } from './access';
import { User } from '../types/api';

const base: User = { id: 'usr_001', username: 'a', role: 'viewer', stockAccess: ['s1'] };

describe('access helpers', () => {
  it('forces a change when the flag is set and not already on /account', () => {
    expect(shouldForcePasswordChange({ ...base, mustChangePassword: true }, '/')).toBe(true);
  });

  it('does not force a change when already on /account', () => {
    expect(shouldForcePasswordChange({ ...base, mustChangePassword: true }, '/account')).toBe(false);
  });

  it('does not force a change without the flag', () => {
    expect(shouldForcePasswordChange(base, '/')).toBe(false);
  });

  it('does not force a change for a null user', () => {
    expect(shouldForcePasswordChange(null, '/')).toBe(false);
  });

  it('detects admins', () => {
    expect(isAdmin({ ...base, role: 'admin' })).toBe(true);
    expect(isAdmin(base)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/access.test.ts`
Expected: FAIL — `./access` does not exist.

- [x] **Step 3: Extend the types**

In `frontend/src/types/api.ts`, replace the `User` interface and add new types after it:

```ts
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  stockAccess: string[]; // ['*'] for admin, specific stock IDs for viewers
  mustChangePassword?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// Admin user management
export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
  active: boolean;
  createdAt: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  role: 'admin' | 'viewer';
  stockAccess: string[];
}

export interface UpdatePermissionsRequest {
  role?: 'admin' | 'viewer';
  stockAccess?: string[];
}
```

- [x] **Step 4: Add `authApi.changePassword` and read the flag from the token**

In `frontend/src/api/auth.ts`:
- Update the import on line 3 to add `ChangePasswordRequest`:
  ```ts
  import { LoginRequest, LoginResponse, User, ChangePasswordRequest } from '../types/api';
  ```
- In `userFromToken`, add the flag to the returned object (after `stockAccess: ...`):
  ```ts
      mustChangePassword: payload.mustChangePassword === true,
  ```
- Add a method to the `authApi` object (after `logout`):
  ```ts
    /**
     * Change the current user's own password.
     */
    async changePassword(data: ChangePasswordRequest): Promise<void> {
      await axios.post('/auth/change-password', data);
    },
  ```

- [x] **Step 5: Create the admin API module**

Create `frontend/src/api/admin.ts`:

```ts
import axios from './client';
import {
  AdminUser,
  AdminUsersResponse,
  CreateUserRequest,
  UpdatePermissionsRequest,
} from '../types/api';

/**
 * Admin user-management API. All endpoints require an admin token.
 */
export const adminApi = {
  async listUsers(): Promise<AdminUser[]> {
    const response = await axios.get<AdminUsersResponse>('/admin/users');
    return response.data.users;
  },

  async createUser(data: CreateUserRequest): Promise<AdminUser> {
    const response = await axios.post<AdminUser>('/admin/users', data);
    return response.data;
  },

  async updatePermissions(
    userId: string,
    data: UpdatePermissionsRequest
  ): Promise<void> {
    await axios.put(`/admin/users/${userId}/permissions`, data);
  },

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await axios.post(`/admin/users/${userId}/reset-password`, { newPassword });
  },

  async setActive(userId: string, active: boolean): Promise<void> {
    await axios.patch(`/admin/users/${userId}`, { active });
  },
};
```

In `frontend/src/api/index.ts`, add:
```ts
export { adminApi } from './admin';
```

- [x] **Step 6: Create the access helpers**

Create `frontend/src/lib/access.ts`:

```ts
import { User } from '../types/api';

/**
 * Whether the user must be redirected to the password-change screen.
 * True when the flag is set and they are not already on /account.
 */
export function shouldForcePasswordChange(
  user: User | null,
  pathname: string
): boolean {
  return !!user?.mustChangePassword && pathname !== '/account';
}

/** Whether the user is an administrator. */
export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin';
}
```

- [x] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/access.test.ts`
Expected: PASS (5 tests).

- [x] **Step 8: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 9: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/api/auth.ts frontend/src/api/admin.ts frontend/src/api/index.ts frontend/src/lib/access.ts frontend/src/lib/access.test.ts
git commit -m "feat(frontend): add user-management API layer, types and access helpers"
```

---

### Task 6: Dialog UI primitive

**Files:**
- Create: `frontend/src/components/ui/dialog.tsx`
- Test: `frontend/src/components/ui/dialog.test.tsx`

**Interfaces:**
- Produces: `Dialog` component — `{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }`. Renders nothing when `open` is false; renders an overlay + titled panel when true; calls `onClose` on overlay click and on the close button.

- [x] **Step 1: Write the failing test**

Create `frontend/src/components/ui/dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}} title="Hidden">body</Dialog>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders title and children when open', () => {
    render(
      <Dialog open onClose={() => {}} title="My Dialog"><p>hello</p></Dialog>
    );
    expect(screen.getByText('My Dialog')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="X">body</Dialog>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/dialog.test.tsx`
Expected: FAIL — `./dialog` does not exist.

- [x] **Step 3: Implement the Dialog**

Create `frontend/src/components/ui/dialog.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * Minimal modal dialog: a full-screen overlay with a centred panel.
 * Clicking the overlay or the close button calls onClose.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-lg'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/dialog.test.tsx`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx frontend/src/components/ui/dialog.test.tsx
git commit -m "feat(frontend): add Dialog UI primitive"
```

---

### Task 7: Account page + forced-change gate + Header link

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx` (`reloadUser`)
- Create: `frontend/src/pages/AccountPage.tsx`
- Modify: `frontend/src/App.tsx` (route + forced-change gate)
- Modify: `frontend/src/components/Header.tsx` (Account link)

**Interfaces:**
- Consumes: `authApi.changePassword`, `authApi.refresh`, `shouldForcePasswordChange`, `useAuth`.
- Produces: `AuthContextType.reloadUser: () => Promise<void>`; route `/account`; `ProtectedRoute` redirects to `/account` while `mustChangePassword` is set.

- [x] **Step 1: Add `reloadUser` to AuthContext**

In `frontend/src/contexts/AuthContext.tsx`:
- Add to `interface AuthContextType` (after `logout`):
  ```ts
    reloadUser: () => Promise<void>;
  ```
- Add the implementation (after the `logout` function):
  ```ts
    const reloadUser = async () => {
      const refreshed = await authApi.refresh();
      setUser(refreshed);
    };
  ```
- Add `reloadUser` to the `value` object.

- [x] **Step 2: Create the Account page**

Create `frontend/src/pages/AccountPage.tsx`:

```tsx
import { useState } from 'react';
import { Wheat, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AccountPage() {
  const { user, logout, reloadUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const forced = !!user?.mustChangePassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      await reloadUser();
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
          : null;
      setError(message || 'Could not change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Wheat className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Change Password</CardTitle>
          <CardDescription>
            {forced
              ? 'You must set a new password before continuing'
              : 'Update your account password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            {success && (
              <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">Password changed successfully</div>
            )}

            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-sm font-medium">Current password</label>
              <Input id="currentPassword" type="password" value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium">New password</label>
              <Input id="newPassword" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</label>
              <Input id="confirmPassword" type="password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : 'Change password'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={logout} disabled={loading}>
              <LogOut className="h-4 w-4 mr-2" />Logout
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [x] **Step 3: Wire the route and the forced-change gate**

In `frontend/src/App.tsx`:
- Add imports at the top (after the existing page imports):
  ```ts
  import { useLocation } from 'react-router-dom';
  import AccountPage from './pages/AccountPage';
  import { shouldForcePasswordChange } from './lib/access';
  ```
  (Merge `useLocation` into the existing `react-router-dom` import line: `import { Routes, Route, Navigate, useLocation } from 'react-router-dom';`.)
- Replace `ProtectedRoute` with a version that reads `user` and enforces the gate:

```tsx
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (shouldForcePasswordChange(user, location.pathname)) {
    return <Navigate to="/account" replace />;
  }

  return <>{children}</>;
}
```

- Add the `/account` route inside `<Routes>` (before the catch-all `path="*"`):

```tsx
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />
```

- [x] **Step 4: Add the Header link**

In `frontend/src/components/Header.tsx`:
- Replace the import line for lucide icons with: `import { LogOut, Wheat, UserCog } from 'lucide-react';`
- Add `import { Link } from 'react-router-dom';` after the lucide import.
- In the right-hand controls, add an Account link before the Logout button (inside the `justify-end` div, after the username span). The existing `Button` has no `asChild` prop, so use a plain styled `Link`:

```tsx
          <Link
            to="/account"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <UserCog className="h-4 w-4 mr-2" />
            Account
          </Link>
```

- [x] **Step 5: Typecheck and run tests**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 6: Manual smoke check (optional but recommended)**

Run backend + frontend (`npm run dev` from repo root). Log in as the seeded admin (`admin` / `changeme123`) → you should be redirected to `/account` and unable to navigate away until you set a new password.

- [x] **Step 7: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/pages/AccountPage.tsx frontend/src/App.tsx frontend/src/components/Header.tsx
git commit -m "feat(frontend): account page with forced password-change gate"
```

---

### Task 8: Admin user-management page + route guard

**Files:**
- Create: `frontend/src/pages/AdminUsersPage.tsx`
- Modify: `frontend/src/App.tsx` (`AdminRoute` + route)
- Modify: `frontend/src/components/Header.tsx` (admin link)

**Interfaces:**
- Consumes: `adminApi`, `stocksApi.getStocks`, `isAdmin`, `Dialog`, `useAuth`.
- Produces: `AdminRoute` wrapper (admin-only); route `/admin/users`; admin CRUD UI (create/edit/reset/deactivate) over stocks.

- [x] **Step 1: Add the `AdminRoute` guard and route**

In `frontend/src/App.tsx`:
- Add imports: `import AdminUsersPage from './pages/AdminUsersPage';` and add `isAdmin` to the access import: `import { shouldForcePasswordChange, isAdmin } from './lib/access';`
- Add the guard component (after `ProtectedRoute`):

```tsx
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin(user)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

- Add the route (before the catch-all):

```tsx
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <AdminUsersPage />
          </AdminRoute>
        }
      />
```

- [x] **Step 2: Create the Admin users page**

Create `frontend/src/pages/AdminUsersPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { adminApi, stocksApi } from '@/api';
import { AdminUser, GrainStock } from '@/types/api';

type Editing = { user: AdminUser } | null;
type Resetting = { user: AdminUser } | null;

const ALL = '*';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stocks, setStocks] = useState<GrainStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [resetting, setResetting] = useState<Resetting>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([adminApi.listUsers(), stocksApi.getStocks()]);
      setUsers(u);
      setStocks(s.stocks);
    } catch {
      setError('Could not load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (user: AdminUser) => {
    try {
      await adminApi.setActive(user.id, !user.active);
      await load();
    } catch {
      setError('Could not update user status');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">User Management</h1>
          <Button onClick={() => setCreating(true)}>New user</Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Username</th>
                  <th className="p-3 text-left">Role</th>
                  <th className="p-3 text-left">Stocks</th>
                  <th className="p-3 text-left">Active</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="p-3">{u.username}</td>
                    <td className="p-3">{u.role}</td>
                    <td className="p-3">{u.stockAccess.includes(ALL) ? 'All stocks' : u.stockAccess.join(', ')}</td>
                    <td className="p-3">{u.active ? 'Yes' : 'No'}</td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button variant="outline" size="sm" onClick={() => setEditing({ user: u })}>Edit</Button>
                      <Button variant="outline" size="sm" onClick={() => setResetting({ user: u })}>Reset password</Button>
                      <Button variant={u.active ? 'destructive' : 'secondary'} size="sm" onClick={() => toggleActive(u)}>
                        {u.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {creating && (
        <CreateUserDialog stocks={stocks} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />
      )}
      {editing && (
        <EditUserDialog user={editing.user} stocks={stocks} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {resetting && (
        <ResetPasswordDialog user={resetting.user} onClose={() => setResetting(null)} onSaved={() => setResetting(null)} />
      )}
    </div>
  );
}

function StockSelect({ stocks, value, onChange }: { stocks: GrainStock[]; value: string[]; onChange: (v: string[]) => void }) {
  const allSelected = value.includes(ALL);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allSelected} onChange={(e) => onChange(e.target.checked ? [ALL] : [])} />
        All stocks
      </label>
      {!allSelected && stocks.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((v) => v !== s.id))}
          />
          {s.name}
        </label>
      ))}
    </div>
  );
}

function extractError(err: unknown, fallback: string): string {
  const message =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
      : null;
  return message || fallback;
}

function CreateUserDialog({ stocks, onClose, onSaved }: { stocks: GrainStock[]; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [stockAccess, setStockAccess] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (username.length < 3) return setError('Username must be at least 3 characters');
    if (password.length < 8) return setError('Temporary password must be at least 8 characters');
    const access = role === 'admin' ? ['*'] : stockAccess;
    if (access.length === 0) return setError('Select at least one stock');
    setSaving(true);
    try {
      await adminApi.createUser({ username, password, role, stockAccess: access });
      onSaved();
    } catch (err) {
      setError(extractError(err, 'Could not create user'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="New user">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm font-medium">Username</label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Temporary password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">The user must change this on first login.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {role === 'viewer' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock access</label>
            <StockSelect stocks={stocks} value={stockAccess} onChange={setStockAccess} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Saving...' : 'Create user'}
        </Button>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, stocks, onClose, onSaved }: { user: AdminUser; stocks: GrainStock[]; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<'admin' | 'viewer'>(user.role);
  const [stockAccess, setStockAccess] = useState<string[]>(user.stockAccess);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const access = role === 'admin' ? ['*'] : stockAccess;
    if (access.length === 0) return setError('Select at least one stock');
    setSaving(true);
    try {
      await adminApi.updatePermissions(user.id, { role, stockAccess: access });
      onSaved();
    } catch (err) {
      setError(extractError(err, 'Could not update user'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Edit ${user.username}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {role === 'viewer' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock access</label>
            <StockSelect stocks={stocks} value={stockAccess} onChange={setStockAccess} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) return setError('Password must be at least 8 characters');
    setSaving(true);
    try {
      await adminApi.resetPassword(user.id, newPassword);
      setDone(true);
    } catch (err) {
      setError(extractError(err, 'Could not reset password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Reset password: ${user.username}`}>
      {done ? (
        <div className="space-y-4">
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            Password reset. The user must change it on next login.
          </div>
          <Button className="w-full" onClick={onSaved}>Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div className="space-y-2">
            <label className="text-sm font-medium">Temporary password</label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Reset password'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
```

- [x] **Step 3: Add the admin link to the Header**

In `frontend/src/components/Header.tsx`:
- Add `Users` to the lucide import: `import { LogOut, Wheat, UserCog, Users } from 'lucide-react';`
- After the Account link (added in Task 7), add an admin-only link:

```tsx
          {user?.role === 'admin' && (
            <Link
              to="/admin/users"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <Users className="h-4 w-4 mr-2" />
              Users
            </Link>
          )}
```

- [x] **Step 4: Typecheck and run tests**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Manual smoke check**

Run backend + frontend. As admin (after changing the default password): open **Users** in the header → create a viewer assigned to one stock, edit its stocks, reset its password, deactivate/reactivate it. Log in as that viewer with the temp password → forced onto `/account`.

- [x] **Step 6: Commit**

```bash
git add frontend/src/pages/AdminUsersPage.tsx frontend/src/App.tsx frontend/src/components/Header.tsx
git commit -m "feat(frontend): admin user-management page with stock assignment"
```

---

## Post-implementation notes

- **Pre-existing admin rows:** migration `0002` backfills `must_change_password = false`, so an `admin` row that already exists keeps the `changeme123` default without the force-change gate. Not an issue today — nothing is deployed yet, and a fresh install seeds the admin with the flag set. It becomes relevant if this plan is ever applied to a live database; fix with `UPDATE users SET must_change_password = 1 WHERE username = 'admin';`.
- **Docs:** done (2026-08-24) — `docs/specs/API.md` now lists every route from `backend/src/routes/*.ts`, including the two new password endpoints.
