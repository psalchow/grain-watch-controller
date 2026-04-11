import axios from './client';
import { apiClient } from './client';
import { LoginRequest, LoginResponse } from '../types/api';

/**
 * Authentication API
 */
export const authApi = {
  /**
   * Login with username and password
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await axios.post<LoginResponse>('/auth/login', credentials);

    // Store token for future requests
    apiClient.setToken(response.data.token);

    return response.data;
  },

  /**
   * Refresh JWT token
   */
  async refresh(): Promise<LoginResponse> {
    const response = await axios.post<LoginResponse>('/auth/refresh');

    // Update stored token
    apiClient.setToken(response.data.token);

    return response.data;
  },

  /**
   * Logout (clear token)
   */
  logout(): void {
    apiClient.clearToken();
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return apiClient.isAuthenticated();
  },
};
