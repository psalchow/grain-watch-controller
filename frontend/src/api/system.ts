import axios from 'axios';
import { API_BASE_URL } from './config';

/** Payload returned by the backend health endpoint. */
export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

/**
 * Derives the health endpoint URL from the API base URL.
 *
 * `/health` sits outside the `/api/v1` prefix, so the versioned segment is
 * stripped. A relative base ('/api/v1', the production default) yields the
 * relative '/health', which keeps the request on the serving origin.
 *
 * @param apiBaseUrl - Configured API base URL
 * @returns URL of the health endpoint
 */
export function resolveHealthUrl(apiBaseUrl: string = API_BASE_URL): string {
  const withoutTrailingSlash = apiBaseUrl.replace(/\/+$/, '');
  const origin = withoutTrailingSlash.replace(/\/api\/v\d+$/, '');
  return `${origin}/health`;
}

export const systemApi = {
  /**
   * Reads the backend health payload, including the running backend version.
   *
   * Uses a bare axios call rather than the shared client: the endpoint needs no
   * authentication, sits outside the API base path, and must not trigger the
   * client's token-refresh interceptor.
   *
   * @returns The health payload
   */
  async getHealth(): Promise<HealthResponse> {
    const response = await axios.get<HealthResponse>(resolveHealthUrl(), {
      timeout: 5000,
    });
    return response.data;
  },
};
