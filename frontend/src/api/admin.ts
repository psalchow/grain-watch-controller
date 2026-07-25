import axios from './client';
import {
  AdminUser,
  AdminUsersResponse,
  CreateUserRequest,
  UpdatePermissionsRequest,
} from '../types/api';

/**
 * Admin user-management API. All endpoints require an admin token.
 */
export const adminApi = {
  async listUsers(): Promise<AdminUser[]> {
    const response = await axios.get<AdminUsersResponse>('/admin/users');
    return response.data.users;
  },

  async createUser(data: CreateUserRequest): Promise<AdminUser> {
    const response = await axios.post<AdminUser>('/admin/users', data);
    return response.data;
  },

  async updatePermissions(
    userId: string,
    data: UpdatePermissionsRequest
  ): Promise<void> {
    await axios.put(`/admin/users/${userId}/permissions`, data);
  },

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await axios.post(`/admin/users/${userId}/reset-password`, { newPassword });
  },

  async setActive(userId: string, active: boolean): Promise<void> {
    await axios.patch(`/admin/users/${userId}`, { active });
  },
};
