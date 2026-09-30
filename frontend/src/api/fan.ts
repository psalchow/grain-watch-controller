import axios from './client';
import type { AutomationConfig, FanSnapshot } from '../types/fan';

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

  /** The stored configuration, or the defaults while no row exists yet (design spec §7). */
  async getAutomation(stockId: string): Promise<AutomationConfig> {
    const response = await axios.get<AutomationConfig>(`/stocks/${stockId}/fan/automation`);
    return response.data;
  },

  /** Stores the switch and the seven parameters in one call (design spec §7). */
  async putAutomation(stockId: string, config: AutomationConfig): Promise<AutomationConfig> {
    const response = await axios.put<AutomationConfig>(
      `/stocks/${stockId}/fan/automation`,
      config,
    );
    return response.data;
  },
};
