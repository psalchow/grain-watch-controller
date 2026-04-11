# Authentication & Authorisation

## Authentication

- Local users stored in a JSON file (`data/users.json`)
- Passwords hashed with bcrypt
- JWT tokens for session management (access token + refresh)
- Default admin user created on first startup
- No SSO/OIDC — external auth providers (e.g. Google) may be added later

## Authorisation

- **Roles**: `admin` (full access, user management) and `viewer` (read-only)
- **Stock access**: Each user has a list of permitted stock IDs, or `['*']` for all stocks
- Admins implicitly have access to all stocks

## Authentication Flow

```
1. POST /api/v1/auth/login {username, password}
   ↓
2. Validate credentials
   ↓
3. Generate JWT with user claims (id, role, stockAccess)
   ↓
4. Return {token, expiresIn}

Subsequent requests:
   Authorization: Bearer <JWT>
   ↓
   Middleware validates token & extracts user context
   ↓
   Controller uses user context for authorisation
```
