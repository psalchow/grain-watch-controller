import axios from './client';
import {
  AdminStock,
  AdminStocksResponse,
  AdminUser,
  AdminUsersResponse,
  CreateStockRequest,
  CreateUserRequest,
  Tenant,
  TenantsResponse,
  UpdatePermissionsRequest,
  UpdateStockRequest,
} from '../types/api';

/**
 * Admin API: user management and stock administration. All endpoints require an admin token.
 */
export const adminApi = {
  async listUsers(): Promise<AdminUser[]> {
    const response = await axios.get<AdminUsersResponse>('/admin/users');
    return response.data.users;
  },

  /**
   * Lists all tenants, so one can be chosen when creating or editing a user.
   * Read-only: there is no create, rename or delete from the client.
   */
  async listTenants(): Promise<Tenant[]> {
    const response = await axios.get<TenantsResponse>('/admin/tenants');
    return response.data.tenants;
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

  async listStocks(): Promise<AdminStock[]> {
    const response = await axios.get<AdminStocksResponse>('/admin/stocks');
    return response.data.stocks;
  },

  async createStock(data: CreateStockRequest): Promise<AdminStock> {
    const response = await axios.post<AdminStock>('/admin/stocks', data);
    return response.data;
  },

  async updateStock(
    stockId: string,
    data: UpdateStockRequest
  ): Promise<AdminStock> {
    const response = await axios.patch<AdminStock>(
      `/admin/stocks/${stockId}`,
      data
    );
    return response.data;
  },

  async deleteStock(stockId: string): Promise<void> {
    await axios.delete(`/admin/stocks/${stockId}`);
  },
};
