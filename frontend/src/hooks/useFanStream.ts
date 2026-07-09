import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { apiClient } from '../api/client';
import type { FanSnapshot } from '../types/fan';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');

/**
 * Subscribes to the fan SSE stream for a stock. Sends the bearer token as a
 * header (so it never lands in server logs), refreshes it on a 401, and
 * exposes the latest snapshot plus a connected flag.
 */
export function useFanStream(
  stockId: string | undefined,
  enabled: boolean,
): { snapshot: FanSnapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<FanSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (!stockId || !enabled) return;
    const controller = new AbortController();

    void fetchEventSource(`${API_BASE_URL}/stocks/${stockId}/fan/stream`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` },
      openWhenHidden: true,
      onopen: async (res) => {
        if (res.status === 401 && !refreshedRef.current) {
          refreshedRef.current = true;
          await apiClient.refresh();
          throw new Error('retry-after-refresh');
        }
        refreshedRef.current = false;
        setConnected(true);
      },
      onmessage: (ev) => {
        if (!ev.data) return;
        setSnapshot(JSON.parse(ev.data) as FanSnapshot);
      },
      onerror: () => {
        setConnected(false);
        // returning undefined lets fetch-event-source retry with backoff
      },
    });

    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [stockId, enabled]);

  return { snapshot, connected };
}
