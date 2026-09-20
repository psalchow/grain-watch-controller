import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { apiClient } from '@/api';
import type { FanSnapshot } from '../types/fan';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');

/**
 * Subscribes to the fan SSE stream for a stock. Sends the bearer token as a
 * header (so it never lands in server logs), refreshes it on a 401, and
 * exposes the latest snapshot plus a connected flag.
 *
 * The server ends the stream with a `disabled` event when fan control is taken
 * out of service underneath an open connection. That is reported through
 * `disabled` so the page can drop the fan section instead of sitting on a stale
 * snapshot — a clean end of body otherwise looks like success to
 * fetch-event-source and triggers no reconnect.
 *
 * Reconnect strategy: on 401 the effect aborts the current connection, calls
 * apiClient.refreshAccessToken(), then increments `retry` to re-run the effect so the
 * token header is re-evaluated fresh. A refresh is attempted at most once per
 * disconnected period; the guard resets on every successful open so a later
 * token expiry can trigger another single refresh.
 */
export function useFanStream(
  stockId: string | undefined,
  enabled: boolean,
): { snapshot: FanSnapshot | null; connected: boolean; disabled: boolean } {
  const [snapshot, setSnapshot] = useState<FanSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  // Keyed by stock so navigating to another stock starts clean without having
  // to reset state from inside the effect — resetting there would re-enable the
  // stream the page just dropped and oscillate.
  const [disabledFor, setDisabledFor] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const refreshAttempts = useRef(0);
  // fetch-event-source retries at a flat second unless onerror returns a delay,
  // so a proxy answering 502 during a backend restart would be hammered once a
  // second by every open fan page.
  const retryDelayMs = useRef(1000);

  useEffect(() => {
    if (!stockId || !enabled) return;
    const controller = new AbortController();
    // A fresh stream starts from the short delay: the ref outlives the effect,
    // so a stock change or a token refresh would otherwise inherit the backoff
    // reached by the previous connection.
    retryDelayMs.current = 1000;

    void fetchEventSource(`${API_BASE_URL}/stocks/${stockId}/fan/stream`, {
      signal: controller.signal,
      // Token is re-evaluated on every effect run so reconnects after a
      // refresh pick up the new token rather than the expired one.
      headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` },
      openWhenHidden: true,
      onopen: async (res) => {
        // A custom onopen replaces the library's content-type check, so the
        // non-stream answers have to be handled here. A 404 is the endpoint
        // refusing the stock — same outcome as the `disabled` event, reached by
        // opening the page after fan control was withdrawn rather than while
        // the stream was open.
        if (res.status === 404) {
          setDisabledFor(stockId);
          setConnected(false);
          controller.abort();
          return;
        }
        if (res.status === 401) {
          if (refreshAttempts.current < 1) {
            refreshAttempts.current += 1;
            await apiClient.refreshAccessToken();
            controller.abort();
            setRetry((n) => n + 1); // re-run effect → fresh token header
          } else {
            // Second consecutive 401: give up to avoid an infinite refresh loop.
            setConnected(false);
          }
          return;
        }
        if (
          !res.ok ||
          !res.headers.get('content-type')?.startsWith('text/event-stream')
        ) {
          // Not a stream: a clean end of body would otherwise read as success.
          setConnected(false);
          // Access was withdrawn — no point reconnecting.
          if (res.status === 403) {
            controller.abort();
            return;
          }
          // Anything else is transient (a proxy 502 while the backend restarts,
          // say). Throwing hands over to the library's retry path; aborting
          // here would end the stream for good.
          throw new Error(`Fan stream: unexpected response ${res.status}`);
        }
        // Successful open: reset the refresh guard so a future expiry can
        // trigger another single refresh cycle, and drop a withdrawal latched
        // from an earlier attempt — a live stream contradicts it.
        refreshAttempts.current = 0;
        retryDelayMs.current = 1000;
        setDisabledFor((prev) => (prev === stockId ? null : prev));
        setConnected(true);
      },
      onmessage: (ev) => {
        if (ev.event === 'disabled') {
          setDisabledFor(stockId);
          setConnected(false);
          controller.abort();
          return;
        }
        if (!ev.data) return;
        setSnapshot(JSON.parse(ev.data) as FanSnapshot);
      },
      onerror: () => {
        setConnected(false);
        // The return value is the delay before the next attempt: back off up to
        // half a minute so an outage is not retried once a second.
        const delay = retryDelayMs.current;
        retryDelayMs.current = Math.min(delay * 2, 30000);
        return delay;
      },
    });

    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [stockId, enabled, retry]);

  return { snapshot, connected, disabled: disabledFor === stockId };
}
