import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';

const TOKEN_KEY = 'grainwatch_token';

/** Event dispatched when the session ends and the user must log in again. */
export const AUTH_LOGOUT_EVENT = 'auth:logout';

// Use environment variable or fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');

/** Request config extended with our one-shot retry flag. */
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * API Client for Grainwatch Controller Backend
 *
 * - Sends the short-lived access token as a Bearer header.
 * - Sends the httpOnly refresh cookie automatically (withCredentials).
 * - On a 401, transparently refreshes the access token once via
 *   POST /auth/refresh and retries the original request. Concurrent 401s
 *   share a single refresh call (single-flight). If the refresh fails, the
 *   token is cleared and an `auth:logout` event is dispatched so the UI can
 *   redirect to login.
 */
class ApiClient {
  private client: AxiosInstance;

  /** Shared in-flight refresh promise (null when no refresh is running). */
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      // Required so the browser sends/receives the httpOnly refresh cookie
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor: Add auth token to requests
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: transparent refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => this.handleResponseError(error)
    );
  }

  /**
   * Handles response errors, attempting a single transparent token refresh
   * when a request fails with 401.
   */
  private async handleResponseError(error: AxiosError): Promise<unknown> {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    const isAuthEndpoint =
      originalRequest?.url?.includes('/auth/refresh') ||
      originalRequest?.url?.includes('/auth/login');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const newToken = await this.refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return this.client(originalRequest);
    } catch (refreshError) {
      this.clearToken();
      this.emitLogout();
      return Promise.reject(refreshError);
    }
  }

  /**
   * Refreshes the access token, coalescing concurrent callers onto a single
   * in-flight request. The refresh token travels in the httpOnly cookie.
   */
  private refreshAccessToken(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.client
        .post<{ token: string; expiresIn: string }>('/auth/refresh')
        .then((response) => {
          const newToken = response.data.token;
          this.setToken(newToken);
          return newToken;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  /** Dispatches the logout event (no-op outside a browser environment). */
  private emitLogout(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
    }
  }

  /**
   * Get stored auth token
   */
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  }

  /**
   * Store auth token
   */
  setToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      console.error('Error setting token:', error);
    }
  }

  /**
   * Clear auth token
   */
  clearToken(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  }

  /**
   * Check if a (non-expired) access token is present
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * Get axios instance for direct use
   */
  getClient(): AxiosInstance {
    return this.client;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient.getClient();
