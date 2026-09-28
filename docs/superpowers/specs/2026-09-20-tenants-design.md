# Tenants — Design Spec

**Date:** 2026-09-20 (revised 2026-09-22)
**Status:** Approved for planning
**Part of:** [Automatic Fan Control — Concept](2026-09-20-automatic-fan-control-concept.md), sub-project A

## 1. Overview

Introduce a tenant (Mandant) that owns halls, and to which users belong. A user
sees the halls of the tenants they belong to; an administrator sees everything.
The per-user hall list (`user_stock_access`) is replaced by that rule.

This exists to give ventilation profiles an owner: tenant 1 may run different
parameters for wheat than tenant 2. It is built first because it is cheap while
little depends on it — adding tenancy underneath existing profiles would mean
migrating ownership afterwards.

Nothing about ventilation changes in this sub-project.

### Deliberately small

An earlier draft grew a deactivation flag, a tenant CRUD API with its own screen,
unique names, and a 404-instead-of-403 rule with the client-side carve-out that
followed from it. None of that was asked for, and each piece brought its own
edge cases. It is all out. What remains is the sentence at the top of this
section, and the plumbing that makes it true.

Consequences of that, stated plainly so they are not rediscovered as gaps:

- Tenants are created with SQL on the NAS, exactly like hall configuration
  (`docs/BACKLOG.md`, "Stock configuration cannot be edited without SQL"). The
  API only *lists* them, so the administrator can pick one when creating a user.
- A tenant cannot be switched off. One that is no longer used simply has no
  users and no halls left.
- Tenant names are free text. Two tenants may share one; nothing depends on the
  name, and an administrator fixes it by renaming — also with SQL.

## 2. Data model

New table `tenants`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | text, PK | Opaque; `tnt_default` is the one readable value |
| `name` | text, not null | Display name, free text |
| `created_at` | text, not null | ISO 8601 |

New join table `user_tenants`, mirroring the shape `user_stock_access` has today:

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | text, FK → `users.id`, on delete cascade | |
| `tenant_id` | text, FK → `tenants.id` | |
| | PK (`user_id`, `tenant_id`), index on `tenant_id` | The index serves "who belongs to this tenant" |

Changed tables:

| Table | Change |
|-------|--------|
| `stocks` | `tenant_id` text, not null, default `tnt_default`, no FK (see below) |
| `user_stock_access` | dropped |
| `users` | unchanged |

**A hall belongs to exactly one tenant; a user may belong to several.** The
asymmetry is deliberate. A hall with two owners has no meaningful answer to
"whose wheat profile applies", so `stocks.tenant_id` stays a column. A person
managing storage for two businesses is an ordinary situation, so membership gets
a table.

Today every user has exactly one row in `user_tenants`, and the API enforces
that (§4). The structure is multi-valued from the start — table, claim,
predicate, client type — because the token shape is the expensive thing to change
once sessions are live, while a database table is a migration like any other.

`stocks.tenant_id` carries **no foreign key**, unlike `user_tenants.tenant_id`.
SQLite refuses `ALTER TABLE … ADD COLUMN` when the column has both a `REFERENCES`
clause and a non-null default, and foreign keys are enforced
(`PRAGMA foreign_keys = ON` in `backend/src/db/index.ts`). Rebuilding `stocks`
would drag `fan_state` and `fan_events` along — not worth it for a column the
application always writes itself, where a wrong value hides a hall rather than
corrupting anything.

### Migration 0005

1. Create `tenants` and insert `tnt_default` ("Standard").
2. Create `user_tenants` and add one row per existing user, pointing at
   `tnt_default`.
3. Add `tenant_id` to `stocks`, defaulting existing rows to `tnt_default`.
4. Drop `user_stock_access`.

Step 3 is a plain `ADD COLUMN` with a non-null default, which SQLite accepts
because the column carries no `REFERENCES` clause. Step 4 comes last so a failed
migration leaves the old grants intact. As with migration 0004, rollback is a
database restore.

`tnt_default` comes from the migration, not from a seed function — a fresh
database runs every migration, so the row exists before `bootstrap.ts` creates
the default administrator. `backend/src/db/seed.ts` only contributes the
`DEFAULT_TENANT_ID` constant and the `tenantId` on the seeded halls.

**The migration widens access for a user who held a partial hall grant.** Every
user and every hall lands in `tnt_default`, so somebody granted one of two halls
now sees both, and `DROP TABLE user_stock_access` removes the record of what they
were meant to see. A pre-upgrade query in `docs/DEPLOYMENT.md` names those users
so the operator decides before running it.

## 3. Authorisation

### Claim

The JWT access token carries `tenants: Array<{ id, name }>` instead of
`stockAccess`.

The ids are what authorise. The names ride along as display data, because the
client rebuilds the whole `User` from the token (`frontend/src/api/auth.ts`,
`userFromToken`): with ids alone the header would have nothing to show, and
fetching the user on every start would log somebody out whenever the PWA opens
without a network, despite a valid token. The price is that a renamed tenant
shows its old name for at most one access-token lifetime.

Verification rejects a payload whose `tenants` is missing, is not an array, is
empty, or holds an element without a string `id` — so a token issued before this
change cannot authorise under a retired model.

"Non-empty" and the element check are worth their two conditions. `tenants: []`
would verify, leave `tenantIds` empty, and give the user a session that answers
403 to every hall without saying why; a claim of bare strings would survive and
yield `undefined` ids. Both fail closed, but a 401 is the better failure — the
client already recovers from one silently.

That does not end anybody's session. The refresh cookie is untouched, and the
client recovers on its own — `AuthContext` falls through to a silent refresh when
`userFromToken` returns `null`, and `apiClient` retries a 401 once behind a
transparent refresh. With `JWT_REFRESH_EXPIRES_IN` at 30 days, only a user whose
cookie has expired or been cleared logs in again. `docs/DEPLOYMENT.md` should say
that rather than promise a forced re-login.

The refresh token is unaffected — it carries only `userId` and `type`, and
`refreshAccessToken` re-reads the user before issuing a new access token.

### `requireStockAccess`

Today the middleware compares `:stockId` against the `stockAccess` claim and is
synchronous. It becomes:

1. no `req.user` → 401, unchanged;
2. no `:stockId` → 400, unchanged;
3. administrator → pass, without a lookup;
4. look the hall up via `StockService.getStock`;
5. hall missing or of another tenant → **403**, unchanged in shape and message.

Keeping 403 is deliberate. A 404 would hide whether a hall id exists, which is
tidier in principle, but it collides with the client: `useFanStream` reads any
404 on the stream as fan control having been withdrawn and latches the page into
"keine Lüftersteuerung". Untangling that means a new error code, a change to the
hook and three more tests — machinery to conceal hall ids from a handful of
known users on a private NAS. The existing 403 path already does the right thing
on that page.

`getStock` is `async`, so the middleware becomes `async` and forwards thrown
errors to `next` explicitly — Express 4 does not do that for rejected promises.
The lookup is a primary-key read in better-sqlite3 on a table with a handful of
rows; no cache.

`hasStockAccess` in `backend/src/models/user.model.ts` keeps its name and its
place — it is the one predicate every access decision goes through — but takes
the hall rather than a hall id, and its body becomes
`user.tenantIds.includes(stock.tenantId)`. The `['*']` convention disappears
with it. `StocksController.listStocks` uses the same predicate, with
administrators skipping the filter.

## 4. API

### Tenants

One route, read-only, under `/api/v1/admin` (which already applies
`authenticate` and `requireRole('admin')`):

| Method | Path | Response |
|--------|------|----------|
| GET | `/tenants` | `{ tenants: [{ id, name }] }` |

It exists so the administrator can choose a tenant when creating a user. There
is no create, rename or delete: a second tenant is a rare, deliberate act, and
the hall it owns has to be reassigned with SQL anyway.

### User administration

`POST /admin/users` and `PUT /admin/users/:userId/permissions` take
`tenantIds: string[]` where they took `stockAccess`. The Zod schema requires a
non-empty array and **caps the length at one**; an unknown tenant is a 400.

The cap is where "prepared but not enabled" is enforced, and it is one line to
lift. Without it the API would accept memberships the user interface cannot show
and no feature has thought through — which tenant owns a profile such a user
creates, what the header displays.

`GET /admin/users`, `POST /admin/users` and
`PUT /admin/users/:userId/permissions` all answer `tenants: [{ id, name }]` per
user, so the three agree on one shape and the list is readable without a second
request.

### Login response

`POST /auth/login` returns `tenants: [{ id, name }]` in the user object instead
of `stockAccess`, taken from the token it has just issued. `POST /auth/refresh`
is unchanged and keeps answering `{ token, expiresIn }`; the client rebuilds the
user from the new token's claims.

## 5. Frontend

- `frontend/src/types/api.ts`: `User.stockAccess` → `tenants: { id, name }[]`.
- `frontend/src/lib/token.ts`: `decodeJwtPayload` reads the payload with `atob`,
  which yields one character per byte, so `Müller` arrives as `MÃ¼ller`. Latent
  while only `username` came through it; putting tenant names in the claim makes
  it visible, in the very name class this deployment has. The bytes must be
  decoded with `TextDecoder`.
- `frontend/src/api/auth.ts`: `userFromToken` rebuilds the `User` from the claims
  and returns `null` unless the expected claim is present. It must move from
  `stockAccess` to `tenants` in the same change as the claim — left behind, it
  returns `null` for a valid token, so the session fails to restore on every page
  load and every refresh logs the user out.
- `AdminUsersPage`: the hall multi-select becomes a single tenant select, fed by
  `GET /admin/tenants`, sending a one-element `tenantIds`. Both roles need one —
  an administrator belongs to a tenant too.
- `Header`: shows the tenant name beside the user name when the account is not an
  administrator **and has exactly one tenant**. Written as a condition, so a
  second membership degrades to showing nothing rather than a wrong name.
- `frontend/src/lib/access.ts` keeps `isAdmin`; nothing else in the client makes
  an access decision.

## 6. Tests

Backend:

- `TenantRepository`: list, find by id.
- `UserRepository`: create and update write `user_tenants`; reading a user
  returns its memberships with names; deleting a user removes its rows.
- `hasStockAccess`: **a user with two memberships reaches halls of both.** The
  membership table is multi-valued from the start, so the predicate is tested
  that way even though no endpoint currently produces such a user. This is the
  test that keeps the preparation real rather than nominal.
- `requireStockAccess`: own tenant passes; foreign tenant and unknown hall give
  403; administrator passes for any hall; missing user gives 401.
- Auth: a token whose `tenants` is missing, not an array, empty, or holding an
  element without a string `id` is rejected; login carries the new field.
- `userFromToken` on the client: restores a user from a token carrying
  `tenants`, returns `null` for one carrying the retired `stockAccess`, and
  keeps umlauts in a tenant name intact.
- **Denied access stays covered.** `stocks.test.ts` asserts 403 for a hall the
  viewer was not granted. Both seeded halls land in `tnt_default`, so that user
  cannot exist any more and a naive rewrite turns the case green while testing
  nothing. The fixture moves one hall to a second tenant and keeps the 403. The
  suite's existing filter case — the restricted viewer sees one hall — becomes
  the tenant-filter test by the same move; no new case, and a second one would
  have to be placed carefully, since a later `beforeAll` in the file inserts a
  third hall.
- Admin routes: unknown tenant on user creation gives 400; two entries in
  `tenantIds` give 400 while the cap stands.

Frontend:

- `AdminUsersPage`: tenant select renders, creating a user sends a one-element
  `tenantIds`.
- `Header`: shows the tenant name for a non-administrator with one tenant;
  nothing for an administrator, nothing for a user with two.

## 7. Out of scope

- Creating, renaming or deleting tenants through the API or a screen — SQL, like
  hall configuration.
- Deactivating a tenant. A tenant that is no longer used has no members.
- Unique tenant names.
- Hall-to-tenant assignment through a screen — sub-project B.
- Tenant-scoped ventilation profiles — sub-project D.
- A tenant administrator role. Administrators edit everything, ordinary users
  maintain their own; a third role is machinery without a case behind it.
- Users in more than one tenant. Storage, claim, predicate and client type carry
  a list; the API caps it at one and the interface offers a single choice.
  Enabling it means lifting the cap and answering the questions in §9.

## 8. Deferred items

To be moved into `docs/BACKLOG.md` when the work lands.

### The `viewer` role already writes

`POST /api/v1/stocks/:stockId/fan/command` applies `authenticate` and
`requireStockAccess`, not `requireRole`. A `viewer` can therefore switch a fan,
while `backend/src/models/user.model.ts` documents the role as "read-only access
to assigned stocks" and `docs/specs/AUTHENTICATION.md` repeats it. Automation and
profiles will add further write endpoints for exactly that role. Renaming it to
`operator` costs a migration on `users.role`, the enum in
`updatePermissionsSchema`, the frontend strings and the two documents above.

### Per-hall grants inside a tenant are gone

Migration 0005 widens access for users who held a partial grant (§2). Reinstating
finer granularity means a filter *inside* a tenant, not a return to
`user_stock_access`.

### A wrong `stocks.tenant_id` disappears silently

There is no foreign key (§2), assignment is manual SQL until sub-project B, and a
typo is therefore the expected way this goes wrong. The hall simply drops out of
its tenant's `GET /stocks` — and an administrator, who bypasses the filter by
role, still sees it, so the account most likely to investigate sees nothing
wrong.

`initFanControl` already reads every stock at startup. Warning there about a
`tenant_id` with no matching `tenants` row would turn a silent disappearance into
a log line, for a few lines of code.

### Changing a user's tenancy does not close an open SSE stream

`requireStockAccess` runs once when the fan stream connects, so moving a hall or
removing a membership takes effect only at the next reconnect or when the access
token expires (15 minutes by default). Pre-existing; restated in tenant terms
because the current backlog entry names a table this change drops.

## 9. Risks

| Risk | Handling |
|------|----------|
| **The migration widens access for a user who held a partial grant** | Real and irreversible. A pre-upgrade query in `docs/DEPLOYMENT.md` names the affected users so the operator decides before running it. |
| Sessions break on the claim change | They do not: the refresh cookie survives and the client re-mints silently (§3). Accepting old access tokens instead would authorise under the retired model. |
| Losing per-hall granularity | Accepted. A tenant whose halls must not all be visible to the same people is not the operating reality. |
| Tenants can only be created with SQL | Accepted. A second tenant is rare and deliberate, and its halls need a SQL edit anyway. If it becomes frequent, it joins sub-project B — the hall configuration screen is the same kind of work. |

### Open questions for the day the membership cap is lifted

- Which tenant owns a profile a multi-tenant user creates? An explicit choice at
  creation is the obvious answer, but it is a screen that does not exist.
- What does the header show? Currently nothing for such a user (§5) — acceptable
  as a placeholder, not as a design.
- Does the hall list group by tenant? Two businesses both having a "Halle 1" is
  likely.
