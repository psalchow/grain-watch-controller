/**
 * Shared API configuration.
 *
 * Kept separate from client.ts so modules that only need the base URL — such as
 * the /health probe, which sits outside the versioned API prefix — do not pull
 * in the authenticated axios instance.
 */

// Use environment variable or fallback to localhost for development
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');
