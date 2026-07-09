import axios from './client';
import type { FanSnapshot } from '../types/fan';

export const fanApi = {
  async getStatus(stockId: string): Promise<FanSnapshot> {
    const response = await axios.get<FanSnapshot>(`/stocks/${stockId}/fan`);
    return response.data;
  },

  async sendCommand(stockId: string, action: 'on' | 'off'): Promise<FanSnapshot> {
    const response = await axios.post<FanSnapshot>(
      `/stocks/${stockId}/fan/command`,
      { action },
    );
    return response.data;
  },
};
