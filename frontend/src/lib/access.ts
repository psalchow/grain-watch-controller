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
