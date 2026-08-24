# Application Bootstrap

This document describes the bootstrap functionality that initialises the application on startup.

## Overview

The bootstrap system prepares the SQLite database and creates a default admin user when the application starts for the first time and no users exist. This solves the "chicken and egg" problem where you need a user to log in, but can't create users without being logged in.

## How It Works

### Startup Sequence

When the application starts (`backend/src/index.ts` → `bootstrapApplication()`):

1. **Database**: open the SQLite file at `DATABASE_PATH`, creating it if absent
2. **Migrations**: run the Drizzle migrations from `backend/drizzle/`
3. **Stock seeding**: insert the stock configuration if not already present
4. **User check**: count existing users
5. **Default user creation**: if no users exist, create the default admin
6. **Fan control**: start the MQTT fan manager for every fan-enabled stock
7. **Application start**: the Express server begins accepting requests

### Default Admin User

When created, the default admin user has the following credentials:

```
Username: admin
Password: changeme123
Role: admin
Stock Access: * (all stocks)
Must change password: yes
```

**Security Warning**: This is a weak default password, and it is public knowledge.

The account is created with `mustChangePassword` set, so the first login is
forced through the password-change screen at `/account`: the frontend redirects
every other route there until a new password is set, and changing it clears the
flag. This makes the default hard to leave in place through the UI, but it is a
client-side gate rather than a server-side block — see
[AUTHENTICATION.md](specs/AUTHENTICATION.md#forced-password-change).

### Idempotency

The bootstrap process is idempotent:

- Calling `bootstrapApplication()` multiple times is safe
- Migrations and stock seeding skip work that is already applied
- If users already exist, no user is created
- The function returns information about what was initialised

### Error Handling

If `bootstrapApplication()` throws, the database is closed and the error is
re-thrown; `startServer()` logs it and exits with code 1. This applies in **every
environment** — a failed bootstrap never yields a half-started server.

Fan control is the deliberate exception: if no stock has fan control configured,
or the MQTT/fan configuration is missing, initialisation is skipped with a log
message instead of failing the boot.

## API Reference

### `bootstrapApplication()`

Initialises the application by running startup tasks.

**Returns**: `Promise<BootstrapResult>`

```typescript
interface BootstrapResult {
  defaultUsersCreated: boolean;
  defaultAdminUsername?: string;
}
```

**Example**:
```typescript
const result = await bootstrapApplication();
if (result.defaultUsersCreated) {
  console.log(`Created default admin: ${result.defaultAdminUsername}`);
}
```

### `validateBootstrap()`

Validates that the application is properly bootstrapped by checking that at least one user exists.

**Returns**: `Promise<boolean>`

### `initFanControl()` / `shutdownFanControl()`

Start and stop the fan control manager. `shutdownFanControl()` runs on `SIGTERM`
and `SIGINT` so the MQTT connection closes cleanly.

## Implementation Files

- **Core Logic**: `backend/src/bootstrap.ts`
- **Integration**: `backend/src/index.ts` — entry point, signal handling
- **User Service**: `backend/src/services/auth/user.service.ts` — `initializeDefaultUsers()`
- **Migrations**: `backend/src/db/migrate.ts` and `backend/drizzle/`
- **Tests**: `backend/tests/unit/bootstrap.test.ts`

## Changing the Default Password

The intended route is the UI: log in as `admin` / `changeme123` and set a new
password on the screen you are redirected to.

To do it over the API instead:

```bash
# 1. Login with the default credentials
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "changeme123"}'

# 2. Change the password using the returned token
curl -X POST http://localhost:3000/api/v1/auth/change-password \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "changeme123", "newPassword": "your-secure-password"}'
```

To retire the default account entirely, create a second admin and stop using
`admin`. Note that user deletion exists in `UserService` but is **not exposed as
an API endpoint** — the admin UI offers deactivation (`PATCH
/api/v1/admin/users/:userId` with `{active: false}`) instead, and self-deactivation
is rejected, so deactivate `admin` from the other admin account.

## Testing

The bootstrap functionality is covered by `backend/tests/unit/bootstrap.test.ts`:

- Creating the default admin when no users exist
- Skipping user creation when a user already exists
- Propagating failures from `initializeDefaultUsers()`
- `validateBootstrap()` for both the populated and the error case
- The default admin's credentials, and logging in with them

The seeded admin's `mustChangePassword` flag is not asserted there; the flag's
behaviour is covered by `tests/unit/services/user.mustChangePassword.test.ts`
and `tests/integration/admin.password.test.ts`.

Run the tests with:

```bash
cd backend && npx jest tests/unit/bootstrap.test.ts
```

## Production Considerations

### Security

1. **Change the default password** on first login — the forced-change screen
   prompts for it, but the default is public until you act on it.
2. **File permissions**: the SQLite database at `DATABASE_PATH` must be
   readable/writable only by the application user (UID 1001 in the image).
3. **Docker volumes**: mount the data directory as a persistent volume. Without
   one the database is recreated empty on every container replacement, and the
   default admin is seeded again.

### Monitoring

The bootstrap process logs its actions:

- Default user creation, with the credentials printed to the console
- A skip message when users already exist
- Fan control initialisation, or the reason it was skipped
- Errors during bootstrap

Review these logs on first startup to confirm initialisation:

```bash
docker logs grainwatch-controller | grep -A 6 "Default Admin User Created"
```

### Environment Variables

The bootstrap process is affected by:

- `DATABASE_PATH`: location of the SQLite database file
- `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`: broker connection for fan control
- `FAN_*`: fan timing and retention settings

See `backend/.env.example` for the complete configuration.

## Future Enhancements

1. **Configurable default credentials**: set the initial admin via environment variables
2. **Server-side enforcement** of `mustChangePassword`, so the gate is not purely client-side
3. **User deletion endpoint**, to complement the existing service method
4. **Health checks**: integrate bootstrap validation into the health endpoint
5. **Setup wizard**: interactive first-run setup for production deployments

## Troubleshooting

### Bootstrap Fails with a File Permission Error

**Problem**: `SQLITE_CANTOPEN`, or the container exits on start.

**Solution**: ensure the application user can write to the data directory:

```bash
chmod 755 /volume1/docker/grainwatch/backend/data
chown 1001:1001 /volume1/docker/grainwatch/backend/data
```

### Default User Not Created

**Problem**: the application starts but no default user exists.

**Solution**: the admin is only seeded when the user table is empty. Check the
logs for `Users already exist, skipping default user creation`, and inspect the
table directly if needed:

```bash
docker exec grainwatch-controller node -e "
  const db = require('better-sqlite3')(process.env.DATABASE_PATH);
  console.log(db.prepare('SELECT username, role, active FROM users').all());
"
```

### Cannot Login with the Default Credentials

**Problem**: `admin` / `changeme123` is rejected.

**Solution**: either the password was already changed, or the account was
deactivated. Query the users table as above. A database that keeps reverting to
the default admin points the other way — `DATABASE_PATH` is outside the mounted
volume, so the file is lost on every restart.

## Related Documentation

- [Authentication & Authorisation](specs/AUTHENTICATION.md)
- [API Specification](specs/API.md)
- [Deployment Guide](DEPLOYMENT.md)
