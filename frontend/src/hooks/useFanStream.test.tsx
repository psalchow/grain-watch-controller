import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useFanStream } from './useFanStream';

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: vi.fn() }));
vi.mock('@/api', () => ({
  apiClient: { getToken: () => 'token', refreshAccessToken: vi.fn() },
}));

type Options = Parameters<typeof fetchEventSource>[1];

/** Drives the hook's callbacks with a response the endpoint would send. */
function answerWith(response: Response): void {
  vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
    await options.onopen?.(response);
  });
}

const streamResponse = (): Response =>
  new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('useFanStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a connected stream', async () => {
    answerWith(streamResponse());

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.disabled).toBe(false);
  });

  it('treats a 404 as fan control having been withdrawn', async () => {
    answerWith(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }));

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));

    await waitFor(() => expect(result.current.disabled).toBe(true));
    expect(result.current.connected).toBe(false);
  });

  it('retries a transient failure instead of ending the stream', async () => {
    const failure = new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } });
    let thrown: unknown;
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
      try {
        await options.onopen?.(failure);
      } catch (error) {
        // What the library does with a throw: run its retry path.
        thrown = error;
      }
    });

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));

    await waitFor(() => expect(thrown).toBeInstanceOf(Error));
    expect(result.current.disabled).toBe(false);
  });

  it('clears a latched withdrawal once a stream opens again', async () => {
    let open: ((res: Response) => Promise<void>) | undefined;
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
      open = async (res) => { await options.onopen?.(res); };
      await open(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }));
    });

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));
    await waitFor(() => expect(result.current.disabled).toBe(true));

    await open!(streamResponse());

    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(result.current.connected).toBe(true);
  });

  it('latches the withdrawal when the server ends the stream', async () => {
    let message: ((ev: { event: string; data: string }) => void) | undefined;
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
      await options.onopen?.(streamResponse());
      message = options.onmessage as typeof message;
    });

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));
    await waitFor(() => expect(result.current.connected).toBe(true));

    message!({ event: 'disabled', data: '{}' });

    await waitFor(() => expect(result.current.disabled).toBe(true));
    expect(result.current.connected).toBe(false);
  });

  it('backs off between reconnection attempts', async () => {
    let error: (() => number) | undefined;
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
      error = options.onerror as typeof error;
    });

    renderHook(() => useFanStream('grain-watch-1', true));
    await waitFor(() => expect(error).toBeDefined());

    expect(error!()).toBe(1000);
    expect(error!()).toBe(2000);
    expect(error!()).toBe(4000);
  });

  it('does not report a non-stream response as connected', async () => {
    const wrongType = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options: Options) => {
      await options.onopen?.(wrongType).catch(() => {});
    });

    const { result } = renderHook(() => useFanStream('grain-watch-1', true));

    await waitFor(() => expect(vi.mocked(fetchEventSource)).toHaveBeenCalled());
    expect(result.current.connected).toBe(false);
    expect(result.current.disabled).toBe(false);
  });
});
