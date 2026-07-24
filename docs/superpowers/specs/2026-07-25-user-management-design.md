# User Management & Password Self-Service — Design

**Date:** 2026-07-25
**Status:** Approved (design), pending implementation plan

## Goal

Give the Grainwatch app two capabilities it currently lacks a UI for:

1. **Self-service password change** — any authenticated user can change their own
   password from the UI.
2. **Admin user management** — an admin can create users, edit them (including
   assignment to stocks), "delete" (deactivate) them, and reset their passwords.

The backend already has most authorisation primitives (SQLite `users` +
`user_stock_access` tables, JWT auth, `admin`/`viewer` roles, per-user
`stockAccess`, and admin routes for list/create/update-permissions/set-active).
The gaps are: no password-change endpoint is exposed, no forced-rotation concept,
and no frontend for any of it.

## Key decisions

- **Password lifecycle:** admin sets a temporary password on create/reset; a
  `mustChangePassword` flag forces the user to set their own on next login.
  Admin never knows the lasting password.
- **Delete = deactivate** (reversible, `active=false`). No hard delete. History
  is preserved; the existing `PATCH .../active` endpoint covers it.
- **UI language:** English (matches Login/Home pages).
- **Admin UI:** dedicated, admin-only `/admin/users` route.
- **Self-service:** dedicated `/account` page, reachable by all users from the
  Header; also serves as the forced-change screen.
- **Password policy:** reuse the existing rule — min 8, max 100 characters.
- **Terminology:** German "Halle" is always "stock" in this project.

## Architecture

Chosen approach: **reuse existing admin endpoints, add two password endpoints and
one DB column.** Rejected alternatives: rebuilding the admin controller from
scratch (discards working code + tests) and modelling forced-change as a separate
table (over-engineered vs a boolean).

### 1. Data model

- Add `must_change_password` (integer boolean, default `false`) to the `users`
  table — Drizzle schema (`backend/src/db/schema.ts`) plus a migration.
- Add `mustChangePassword` to `User`, `UserProfile`, and `JWTPayload`
  (`backend/src/models/user.model.ts`).
- `initializeDefaultUsers()` creates the seeded admin with the flag `true`, so the
  first login forces a change and removes the `changeme123` default-password risk.

**Migration caveat:** an admin row that already exists in a deployed database
keeps `false` via the column default (the migration cannot know its password is
the default). After deploying, the admin resets their own password once via the
new `/account` screen. This is a one-off manual step, documented in the plan.

### 2. Backend endpoints

| Method + path | Who | Body | Effect |
|---|---|---|---|
| `POST /api/v1/auth/change-password` | any auth user | `{currentPassword, newPassword}` | verify current password (bcrypt), update hash, clear `mustChangePassword` |
| `POST /api/v1/admin/users/:userId/reset-password` | admin | `{newPassword}` | set hash, set `mustChangePassword=true` |
| `POST /api/v1/admin/users` *(exists)* | admin | create payload | now also sets `mustChangePassword=true` |
| `PUT /api/v1/admin/users/:userId/permissions` *(exists)* | admin | `{role, stockAccess}` | edit role + stock assignment |
| `PATCH /api/v1/admin/users/:userId/active` *(exists)* | admin | `{active}` | "delete" = deactivate / reactivate |
| `GET /api/v1/admin/users` *(exists)* | admin | — | list users |
| `GET /api/v1/stocks` *(exists)* | any auth user | — | stock list for the assignment picker |

- New Zod schemas in `validation.middleware.ts`: `changePasswordSchema`,
  `resetPasswordSchema` (both reuse the min-8 / max-100 password rule).
- Login response and JWT payload carry `mustChangePassword` so the frontend can
  gate. `UserService.updateUser()` already supports password updates; the new
  endpoints reuse it and toggle the flag.
- Guardrail retained: an admin cannot deactivate their own account.
- The self-service endpoint lives in `auth.routes.ts`; the admin reset endpoint in
  `admin.routes.ts` behind `requireRole('admin')`.

### 3. Frontend

- **API layer:** add `authApi.changePassword`; add `adminApi` with
  `listUsers`, `createUser`, `updateUser` (role + stockAccess), `resetPassword`,
  `setActive`; add the corresponding TypeScript types in `src/types/api.ts`.
- **Auth state:** `AuthContext` exposes `user.mustChangePassword`, read from the
  JWT claims / login response like the other user fields.
- **Routing (`App.tsx`):**
  - Add an `AdminRoute` wrapper that requires `user.role === 'admin'` (redirect
    non-admins to `/`).
  - Add a forced-change gate inside `ProtectedRoute`: if
    `user.mustChangePassword` is true, redirect to `/account` and block every
    other route except `/account` and logout until the password is changed.
- **`/account` page** (all authenticated users): a change-own-password form
  (`currentPassword`, `newPassword`, confirm). Linked from the Header. When
  reached via the forced-change gate, it shows an explanatory banner. On success
  it clears the flag and returns the user to `/`.
- **`/admin/users` page** (admin only): a table of users (username, role, stock
  access, active). Actions:
  - **Create** — dialog with username, temporary password, role, stock
    multi-select.
  - **Edit** — dialog to change role and stock assignment.
  - **Reset password** — dialog to set a new temporary password.
  - **Deactivate / reactivate** — inline toggle (the "delete" action).
- **Stock assignment control:** a multi-select populated from `GET /api/v1/stocks`;
  selecting all (or an explicit "all stocks" checkbox) maps to `['*']`.
- **New shared component:** a lightweight `Dialog`/modal in `src/components/ui/`
  (none exists yet), styled with Tailwind and `cn()`, following the existing
  forwardRef primitive style.
- **Header:** add an `/account` link for everyone and an `/admin/users` link shown
  only when `user.role === 'admin'`.
- **Patterns to follow:** hand-rolled forms with `useState`, inline destructive
  alert boxes for errors (no toast system exists), reuse `Button`/`Input`/`Card`,
  English UI text.

### 4. Error handling

- Backend reuses the existing error-handling middleware and error types
  (`AuthError`, validation errors → 400, unauthorised → 401/403).
- `change-password` returns a clear error when the current password is wrong.
- Frontend surfaces API errors as inline destructive alerts, matching LoginPage.

### 5. Testing

- **Backend (Jest + Supertest):**
  - `change-password`: success (flag cleared), wrong current password rejected,
    too-short new password rejected, unauthenticated rejected.
  - `reset-password`: admin succeeds (flag set), non-admin gets 403.
  - `create user`: sets `mustChangePassword=true`.
  - `login`: response/JWT includes `mustChangePassword`.
- **Frontend:** light tests for the forced-change redirect gate and the
  `AdminRoute` guard where they add value; follow the existing (minimal) test
  style.

## Out of scope

- Hard deletion of users.
- Email-based password reset / "forgot password" flow.
- Self-service username or email editing.
- Any i18n/translation infrastructure.
- Password-strength rules beyond the existing length bounds.
