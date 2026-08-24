# Authentication & Authorisation

## Authentication

- Users stored in SQLite (Drizzle ORM + better-sqlite3), file at `DATABASE_PATH`
- Passwords hashed with bcrypt
- Short-lived JWT access token (default 15 minutes) held in memory by the client
- Long-lived refresh token (default 30 days) delivered as an httpOnly cookie
- Default admin created on first startup — see [BOOTSTRAP.md](../BOOTSTRAP.md)
- No SSO/OIDC — external auth providers (e.g. Google) may be added later

### Token Split

Access and refresh tokens are signed with **separate secrets** (`JWT_SECRET` and
`JWT_REFRESH_SECRET`), which must differ from each other; the configuration
validator rejects a production boot otherwise.

The refresh token is never exposed to JavaScript. It is set as a cookie named
`refresh_token` with `httpOnly`, `secure` (per `COOKIE_SECURE`) and `sameSite`
(per `COOKIE_SAMESITE`), scoped to path `/api/v1/auth` so it is only sent to the
endpoints that need it. Each successful refresh rotates the cookie.

## Authorisation

- **Roles**: `admin` (full access, user management) and `viewer` (read-only)
- **Stock access**: each user has a list of permitted stock IDs, or `['*']` for all
- Admins implicitly have access to all stocks
- Stock-scoped routes run `requireStockAccess`, which matches the `:stockId`
  route parameter against the caller's `stockAccess` claim
- Admin routes run `requireRole('admin')` for the whole router

## Forced Password Change

A user carries a `mustChangePassword` flag, persisted on the user row and carried
through the JWT claims into `req.user` and the login response.

The flag is set when:

- the default admin is seeded on first startup
- an admin creates a user
- an admin resets a user's password

While it is set, the frontend's `ProtectedRoute` redirects every route to
`/account`, so the account cannot be used for anything else until a new password
is set. Successfully changing the password clears the flag.

The gate is a client-side redirect, not a server-side block: the API still
accepts requests from a user whose flag is set. It exists to steer real users
away from leaving a default password in place, not as an authorisation boundary.

## Authentication Flow

```
1. POST /api/v1/auth/login {username, password}
   ↓
2. Validate credentials (bcrypt), reject inactive accounts
   ↓
3. Sign access token (JWT_SECRET) + refresh token (JWT_REFRESH_SECRET)
   ↓
4. Set httpOnly refresh_token cookie, scoped to /api/v1/auth
   ↓
5. Return {token, expiresIn, user{id, username, role, stockAccess,
                                 mustChangePassword}}

Subsequent requests:
   Authorization: Bearer <access token>
   ↓
   authenticate middleware verifies the token and populates req.user
   ↓
   requireRole / requireStockAccess apply authorisation
   ↓
   Controller uses the user context

When the access token expires:
   POST /api/v1/auth/refresh   (no Authorization header; cookie carries it)
   ↓
   Verify refresh token, reject if the account was deactivated meanwhile
   ↓
   Issue a new access token and rotate the refresh cookie
   ↓
   On failure, clear the cookie so the client stops retrying and logs out

Logout:
   POST /api/v1/auth/logout — clears the cookie, always 204
```

## Password Policy

Minimum 8, maximum 100 characters, enforced by Zod on every endpoint that sets a
password. Login is the exception: it only requires presence and caps length at
100, so that tightening the policy never locks out an existing account.

## Endpoints

See [API.md](API.md) for the full route table, request bodies and status codes.
