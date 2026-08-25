import { describe, it, expect, vi, afterEach } from 'vitest';
import { API_CACHE_NAME, clearApiCache } from './apiCache';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clearApiCache', () => {
  it('deletes the API cache', async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: del });

    await clearApiCache();

    expect(del).toHaveBeenCalledWith(API_CACHE_NAME);
  });

  it('does nothing where Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);

    await expect(clearApiCache()).resolves.toBeUndefined();
  });

  it('swallows cache errors so logout still completes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('caches', {
      delete: vi.fn().mockRejectedValue(new Error('quota')),
    });

    await expect(clearApiCache()).resolves.toBeUndefined();
  });
});
