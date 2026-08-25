/**
 * Name of the Cache Storage entry holding API responses.
 *
 * Shared with the Workbox runtime caching rule in `vite.config.ts` so the two
 * cannot drift apart — clearing a cache under a stale name would silently do
 * nothing.
 */
export const API_CACHE_NAME = 'api-cache';

/**
 * Removes every cached API response.
 *
 * Called when a session ends, so responses fetched with a user's token are not
 * left readable by whoever uses the browser next. A no-op where the Cache
 * Storage API is unavailable, which includes the test environment and any
 * non-secure context.
 */
export async function clearApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;

  try {
    await caches.delete(API_CACHE_NAME);
  } catch (error) {
    // Never let cache cleanup break the logout flow.
    console.error('Error clearing API cache:', error);
  }
}
