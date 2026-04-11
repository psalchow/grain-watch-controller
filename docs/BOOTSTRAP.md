# Application Bootstrap

This document describes the bootstrap functionality that initialises the application on first startup.

## Overview

The bootstrap system automatically creates a default admin user when the application starts for the first time and no users exist. This solves the "chicken and egg" problem where you need a user to log in, but can't create users without being logged in.

## How It Works

### Startup Sequence

When the application starts (`src/index.ts`):

1. **Bootstrap Phase**: The `bootstrapApplication()` function is called
2. **User Check**: The system checks if any users exist in the user storage
3. **Default User Creation**: If no users exist, a default admin user is created
4. **Application Start**: The Express server starts and begins accepting requests

### Default Admin User

When created, the default admin user has the following credentials:

```
Username: admin
Password: changeme123
Role: admin
Stock Access: * (all stocks)
```

**Security Warning**: This is a weak default password. You should change it immediately after first login.

### Idempotency

The bootstrap process is idempotent:

- Calling `bootstrapApplication()` multiple times is safe
- If users already exist, no changes are made
- The function returns information about what was initialised

### Error Handling

The bootstrap process handles errors differently based on environment:

**Production Mode**:
- Bootstrap failures cause the application to exit with an error
- This ensures you don't start a non-functional application in production

**Development Mode**:
- Bootstrap failures are logged but don't stop the application
- This allows development to continue even if user storage has issues

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

**Example**:
```typescript
const isValid = await validateBootstrap();
if (!isValid) {
  console.error('No users exist in the system');
}
```

## Implementation Files

- **Core Logic**: `src/bootstrap.ts` - Bootstrap functions
- **Integration**: `src/index.ts` - Application entry point that calls bootstrap
- **User Service**: `src/services/auth/user.service.ts` - Contains `initializeDefaultUsers()` method
- **Tests**: `tests/unit/bootstrap.test.ts` - Comprehensive test coverage

## Changing the Default Password

After first login, you should immediately change the default admin password or create a new admin user:

### Option 1: Create a New Admin User

```bash
# 1. Login with default credentials
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "changeme123"}'

# 2. Use the token to create a new admin user
curl -X POST http://localhost:3000/api/v1/admin/users \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your-username",
    "password": "your-secure-password",
    "role": "admin",
    "stockAccess": ["*"]
  }'

# 3. Login with the new user and delete the default admin
# (Implementation of user deletion would be needed)
```

### Option 2: Manually Edit the Users File

You can also manually edit the `data/users.json` file to remove the default user or change credentials, but this is not recommended in production.

## Testing

The bootstrap functionality is thoroughly tested with the following scenarios:

- Creating default admin when no users exist
- Skipping user creation when users already exist
- Idempotent behaviour (multiple calls)
- Error handling in development and production modes
- Validation of bootstrap state
- Verification of default admin credentials

Run tests with:
```bash
npm test tests/unit/bootstrap.test.ts
```

## Production Considerations

### Security

1. **Change Default Password**: The default password is weak by design. Change it immediately.
2. **File Permissions**: Ensure the `data/users.json` file has appropriate permissions (readable/writable only by the application user).
3. **Docker Volumes**: When running in Docker, mount the data directory as a persistent volume to preserve users across container restarts.

### Monitoring

The bootstrap process logs its actions:

- When a default user is created (with credentials displayed in console)
- When users already exist (skip message)
- When errors occur during bootstrap

Review these logs on first startup to ensure the application is properly initialised.

### Environment Variables

The bootstrap process respects the following environment variables:

- `NODE_ENV`: Determines error handling behaviour
- `USERS_FILE_PATH`: Location of the user storage file

See `.env.example` for complete configuration options.

## Future Enhancements

Potential improvements to the bootstrap system:

1. **Configurable Default Credentials**: Allow setting default admin credentials via environment variables
2. **Multiple Default Users**: Support creating multiple users on first startup
3. **Migration System**: Add support for running migrations on user data structure
4. **Health Checks**: Integrate bootstrap validation into health check endpoints
5. **Setup Wizard**: Interactive first-run setup for production deployments

## Troubleshooting

### Bootstrap Fails with File Permission Error

**Problem**: Cannot write to user storage file.

**Solution**: Ensure the application has write permissions to the data directory:
```bash
chmod 755 data/
chmod 644 data/users.json
```

### Default User Not Created

**Problem**: Application starts but no default user exists.

**Solution**: Check logs for bootstrap errors. Delete `data/users.json` and restart the application to trigger default user creation.

### Cannot Login with Default Credentials

**Problem**: Default credentials don't work.

**Solution**: Users might already exist. Check `data/users.json` to see what users are registered. The default user is only created if the file is empty or doesn't exist.

## Related Documentation

- [User Service Documentation](../src/services/auth/user.service.ts) - User management implementation
- [Authentication](../docs/design/API_DESIGN.md) - Authentication and authorisation design
- [Deployment Guide](../docs/DEPLOYMENT.md) - Production deployment instructions
