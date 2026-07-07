import axios from './client';
import { apiClient } from './client';
import { LoginRequest, LoginResponse, User } from '../types/api';
import { decodeJwtPayload, isTokenValid } from '../lib/token';

/**
 * Builds a User from the claims embedded in an access token.
 *
 * The access token carries userId, username, role and stockAccess, so the
 * client can restore the current user without an extra API call.
 */
function userFromToken(token: string | null): User | null {
  if (!token) {
    return null;
  }
  const payload = decodeJwtPayload(token);
  if (
    !payload ||
    typeof payload.userId !== 'string' ||
    typeof payload.username !== 'string' ||
    typeof payload.role !== 'string' ||
    !Array.isArray(payload.stockAccess)
  ) {
    return null;
  }
  return {
    id: payload.userId,
    username: payload.username,
    role: payload.role as User['role'],
    stockAccess: payload.stockAccess as string[],
  };
}

/**
 * Authentication API
 */
export const authApi = {
  /**
   * Login with username and password.
   *
   * The refresh token is set by the server as an httpOnly cookie; only the
   * access token is returned in the body and stored locally.
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await axios.post<LoginResponse>('/auth/login', credentials);

    // Store token for future requests
    apiClient.setToken(response.data.token);

    return response.data;
  },

  /**
   * Exchange the refresh cookie for a new access token.
   *
   * @returns The current user derived from the new access token
   * @throws if the refresh token is missing/expired (session ended)
   */
  async refresh(): Promise<User | null> {
    const response = await axios.post<{ token: string; expiresIn: string }>(
      '/auth/refresh'
    );
    apiClient.setToken(response.data.token);
    return userFromToken(response.data.token);
  },

  /**
   * Logout: clear the server refresh cookie and the local access token.
   */
  async logout(): Promise<void> {
    try {
      await axios.post('/auth/logout');
    } catch {
      // Ignore network/errors — always clear the local token below.
    }
    apiClient.clearToken();
  },

  /**
   * The current user derived from the stored access token, if any.
   */
  getCurrentUser(): User | null {
    return userFromToken(apiClient.getToken());
  },

  /**
   * Whether a non-expired access token is currently stored.
   */
  isAuthenticated(): boolean {
    return isTokenValid(apiClient.getToken());
  },
};
