# Tenants — Design Spec

**Date:** 2026-09-20
**Status:** Awaiting review
**Part of:** [Automatic Fan Control — Concept](2026-09-20-automatic-fan-control-concept.md), sub-project A

## 1. Overview

Introduce a tenant (Mandant) that owns halls, and to which users belong. A user
sees the halls of the tenants they belong to; an administrator sees everything.
The per-user hall list (`user_stock_access`) is replaced by that rule.

This exists to give ventilation profiles an owner: tenant 1 may run different
parameters for wheat than tenant 2. It is built first because it is cheap while
little depends on it — adding tenancy underneath existing profiles would mean
migrating ownership afterwards.

Membership is modelled as a list throughout — table, claim, predicate, client
type — although every user has exactly one tenant today and the API enforces
that. Somebody managing storage for two businesses is a foreseeable situation,
and the token shape is the part that is expensive to change once sessions are
live.

Nothing about ventilation changes in this sub-project.

## 2. Data model

New table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | text, PK | e.g. `tnt_default` |
| `name` | text, not null | Display name |
| `active` | boolean, not null, default `true` | Mirrors the flag on `users` and `stocks` |
| `created_at` | text, not null | ISO 8601 |

Membership of users, as a join table mirroring the shape `user_stock_access` has
today:

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | text, FK → `users.id`, on delete cascade | |
| `tenant_id` | text, FK → `tenants.id` | |
| | PK (`user_id`, `tenant_id`), index on `tenant_id` | The index serves "who belongs to this tenant" |

Changed tables:

| Table | Change |
|-------|--------|
| `stocks` | `tenant_id` text, not null, FK → `tenants.id` |
| `user_stock_access` | dropped |
| `users` | unchanged |

**A hall belongs to exactly one tenant; a user may belong to several.** The
asymmetry is deliberate. A hall with two owners has no meaningful answer to
"whose wheat profile applies", so `stocks.tenant_id` stays a column. A person
managing storage for two businesses is an ordinary situation, so membership gets
a table.

Today every user has exactly one row in `user_tenants`. Nothing in this
sub-project creates a second one — see §4 and §5. The structure is built now so
that allowing it later is a feature decision rather than a migration plus a
change to the token shape.

`stocks.tenant_id` is `NOT NULL`, including for halls an administrator looks
after. A nullable column would add a "belongs to nobody" case to every query for
no gain; an administrator sees every hall by role, not by membership.

### Migration 0005

1. Create `tenants`.
2. Insert `tnt_default` with name `Standard`.
3. Create `user_tenants` and add one row per existing user, pointing at
   `tnt_default`.
4. Add `tenant_id` to `stocks`, defaulting existing rows to `tnt_default`.
5. Drop `user_stock_access`.

SQLite cannot add a `NOT NULL` column with a foreign key to a populated table in
one statement, so step 4 follows the table-rebuild pattern Drizzle already
generates. As with migration 0004, rollback is a database restore; that is
acceptable for the same reason it was there.

`backend/src/db/seed.ts` seeds `tnt_default` first, then users with their
membership row and stocks with their `tenantId`. The stock seed keeps
`onConflictDoNothing`, so an existing hall is not reassigned by a redeploy —
assigning a hall to another tenant is a SQL edit until sub-project B, exactly as
the other hall configuration is today (`docs/BACKLOG.md`, "Stock configuration
cannot be edited without SQL").

## 3. Authorisation

### Claim

The JWT access token carries `tenantIds: string[]` instead of `stockAccess`. The
refresh token payload changes the same way.

A list, although every user has exactly one entry today. The token shape is the
expensive thing to change later — it is validated in the middleware, typed in
the frontend and held in every live session — while a database table is a
migration like any other. Preparing the shape costs one array literal now.

Tokens issued before the update carry the old shape. Verification rejects a
payload whose `tenantIds` is missing or not a non-empty array of strings, rather
than defaulting it, so nobody keeps a session whose authorisation was computed
under the previous model. Users log in again once after the update; this belongs
in `docs/DEPLOYMENT.md`.

An administrator's `tenantIds` is their own membership, not every tenant. It is
carried for completeness; the role is what grants the wide view, and no code path
reads an administrator's list.

### `requireStockAccess`

Today the middleware compares `:stockId` against the `stockAccess` claim and is
synchronous. It becomes:

1. no `req.user` → 401, unchanged;
2. no `:stockId` → 400, unchanged;
3. administrator → pass;
4. look the hall up via `StockService.getStock`;
5. hall missing, or `!user.tenantIds.includes(stock.tenantId)` → **404**, not 403.

Step 5 returns 404 on purpose: a 403 confirms that a hall id exists, which a
caller from another tenant has no business learning. The response body is the
same "Stock not found" shape the controllers already produce, so the frontend
needs no new case.

`getStock` is `async`, so the middleware becomes `async` and forwards thrown
errors to `next` explicitly — Express 4 does not do that for rejected promises.
The lookup itself is a primary-key read in better-sqlite3 on a table with a
handful of rows; no cache.

`hasStockAccess(user, stockId)` in `backend/src/models/user.model.ts` keeps its
name and its place — it is the one predicate every access decision goes through —
but its body becomes `user.tenantIds.includes(stock.tenantId)`, so it now takes
the hall rather than a hall id. The `['*']` convention disappears with it.
`StocksController.listStocks` uses the same predicate, with administrators
skipping the filter.

## 4. API

### Tenant administration

Under `/api/v1/admin`, which already applies `authenticate` and
`requireRole('admin')` to the whole router.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/tenants` | — | `{ tenants: [{ id, name, active, createdAt, userCount, stockCount }] }` |
| POST | `/tenants` | `{ name }` | 201, the created tenant. Id generated as `tnt_<slug>` |
| PATCH | `/tenants/:tenantId` | `{ name?, active? }` | 200, the updated tenant |

Deactivating a tenant does not cascade. Its users keep their own `active` flag
and are rejected at login by the tenant check, which is one place rather than a
bulk update that cannot be undone.

No delete. A tenant with halls and a switching history is not something to remove
through an endpoint; deactivation covers the real case.

### User administration

`POST /admin/users` and `PATCH /admin/users/:userId/permissions` take
`tenantIds: string[]` where they took `stockAccess`. The Zod schema requires a
non-empty array; **in this sub-project it also caps the length at one**. An
unknown or inactive tenant in the list is a 400.

The cap is where "prepared but not enabled" is enforced, and it is one line to
lift. Without it the API would accept memberships the user interface cannot
show and no feature has thought through — which tenant owns a profile a user
creates, what the header displays, how a hall list is grouped.

`GET /admin/users` returns `tenants: [{ id, name }]` per user, so the list is
readable without a second request.

### Login response

`POST /auth/login` and `POST /auth/refresh` return `tenants: [{ id, name }]` in
the user object instead of `stockAccess`. The names are there for the header; the
ids for nothing the client decides on its own — authorisation stays server-side.

## 5. Frontend

- `frontend/src/types/api.ts`: `User.stockAccess` → `tenants: { id, name }[]`.
  The client type is a list from the start, for the same reason the claim is.
- `AdminUsersPage`: the hall multi-select becomes a **single** tenant select, fed
  by `GET /admin/tenants`, sending a one-element `tenantIds`. Creating and
  editing a user requires a tenant. A multi-select here would promise something
  the rest of the application does not yet answer (§4).
- A tenant list with create and rename lands on the same page as a second
  section, rather than a new route — there will be one or two tenants for a long
  time, and a route of its own for three rows is furniture.
- `Header`: shows the tenant name next to the user name when the account is not
  an administrator **and has exactly one tenant**. Written as a condition rather
  than an assumption, so a second membership degrades to showing nothing instead
  of showing a wrong name.
- `frontend/src/lib/access.ts` keeps `isAdmin`; nothing else in the client makes
  an access decision.

## 6. Tests

Backend:

- `UserRepository`: create and update write `user_tenants`; reading a user
  returns its memberships with names; deleting a user removes its rows.
- `TenantRepository`: create, rename, deactivate, counts.
- `requireStockAccess`: own tenant passes; foreign tenant gives 404; unknown hall
  gives 404; administrator passes for any hall; missing user gives 401.
- `hasStockAccess`: **a user with two memberships reaches halls of both.** The
  membership table is multi-valued from the start, so the predicate is tested
  that way even though no endpoint currently produces such a user. This is the
  test that keeps the preparation real rather than nominal.
- Auth: a token without `tenantIds`, or with a non-array or empty one, is
  rejected; login and refresh carry the new fields.
- Admin routes: tenant CRUD; unknown or inactive tenant on user creation gives
  400; **two entries in `tenantIds` give 400** while the cap stands;
  non-administrator gives 403.
- `StocksController.listStocks`: filters by membership, administrator sees all.
- Seed: a fresh database gets `tnt_default` and one membership row per user; a
  second run changes nothing.

Frontend:

- `AdminUsersPage`: tenant select renders, creating a user sends a one-element
  `tenantIds`.
- `Header`: shows the tenant name for a non-administrator with one tenant; shows
  nothing for an administrator, and nothing for a user with two.

## 7. Out of scope

- Hall to tenant assignment through a screen — sub-project B.
- Tenant-scoped ventilation profiles — sub-project D.
- **Users in more than one tenant.** Storage, claim, predicate and client type
  carry a list; the API caps it at one entry and the user interface offers a
  single choice. Enabling it means lifting the cap and answering the questions in
  §9 — no migration, no token change.
- A tenant administrator role. The user asked for administrators to edit every
  profile and for ordinary users to maintain their own; a third role is
  machinery without a case behind it.
- Renaming the `viewer` role — see §8.

## 8. Deferred items

To be moved into `docs/BACKLOG.md` when that file is committed. Kept here so
they are not lost in the meantime.

### The `viewer` role already writes

`POST /api/v1/stocks/:stockId/fan/command` applies `authenticate` and
`requireStockAccess`, not `requireRole`. A `viewer` can therefore switch a fan,
while `backend/src/models/user.model.ts` documents the role as "read-only access
to assigned stocks", and `docs/specs/AUTHENTICATION.md` repeats it.

Automation and profiles will add further write endpoints for exactly that role,
so the name drifts further from the truth with each sub-project. Renaming it to
`operator` costs a migration on `users.role`, the enum in
`updatePermissionsSchema`, the frontend strings and the two documents above.

Deferred because renaming a role is not what introducing a tenant asks for, and
the change is cheap to make at any later point.

## 9. Risks

| Risk | Handling |
|------|----------|
| Everybody is logged out by the claim change | Announced in `docs/DEPLOYMENT.md`; the alternative, accepting old tokens, would authorise under the retired model. |
| A hall left on the default tenant becomes visible to the wrong users | With one tenant after the migration, nothing changes for anybody. The risk appears with the second tenant, and assigning halls is then a deliberate SQL edit. |
| Losing per-hall granularity | Accepted. A tenant with halls that must not all be visible to the same people is not the operating reality; when it appears, a per-user hall list can be reintroduced as a filter *inside* a tenant. |
| Multi-tenant membership is prepared but untested in anger | The predicate is tested with two memberships (§6), so the read path is real. The write path is capped at one, so nothing can create a state the UI cannot render. |

### Open questions for the day the cap is lifted

Recorded here because they are the reason for the cap, not objections to it:

- Which tenant owns a profile a multi-tenant user creates? An explicit choice at
  creation is the obvious answer, but it is a screen that does not exist.
- What does the header show? Currently nothing for such a user (§5) — acceptable
  as a placeholder, not as a design.
- Does the hall list group by tenant, and does a hall name need its tenant beside
  it to stay unambiguous? Two businesses both having a "Halle 1" is likely.
