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
 *
 * Reconnect strategy: on 401 the effect aborts the current connection, calls
 * apiClient.refresh(), then increments `retry` to re-run the effect so the
 * token header is re-evaluated fresh. A refresh is attempted at most once per
 * disconnected period; the guard resets on every successful open so a later
 * token expiry can trigger another single refresh.
 */
export function useFanStream(
  stockId: string | undefined,
  enabled: boolean,
): { snapshot: FanSnapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<FanSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [retry, setRetry] = useState(0);
  const refreshAttempts = useRef(0);

  useEffect(() => {
    if (!stockId || !enabled) return;
    const controller = new AbortController();

    void fetchEventSource(`${API_BASE_URL}/stocks/${stockId}/fan/stream`, {
      signal: controller.signal,
      // Token is re-evaluated on every effect run so reconnects after a
      // refresh pick up the new token rather than the expired one.
      headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` },
      openWhenHidden: true,
      onopen: async (res) => {
        if (res.status === 401) {
          if (refreshAttempts.current < 1) {
            refreshAttempts.current += 1;
            await apiClient.refresh();
            controller.abort();
            setRetry((n) => n + 1); // re-run effect → fresh token header
          } else {
            // Second consecutive 401: give up to avoid an infinite refresh loop.
            setConnected(false);
          }
          return;
        }
        // Successful open: reset the refresh guard so a future expiry can
        // trigger another single refresh cycle.
        refreshAttempts.current = 0;
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
  }, [stockId, enabled, retry]);

  return { snapshot, connected };
}
