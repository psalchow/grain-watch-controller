import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

/**
 * How often to ask the server whether a newer build has been deployed.
 *
 * The app is installed as a PWA and can stay open for days, so without polling
 * a deployment would only be noticed on the next cold start.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Offers the user a new version once the service worker has one waiting.
 *
 * Registration uses 'prompt' mode, so the waiting worker stays parked until
 * `updateServiceWorker(true)` activates it and reloads. Dismissing only hides
 * the banner — the worker keeps waiting and the banner returns on the next
 * check or reload.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    // Below the header's z-50 so a dialog and the sticky header still win.
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card text-card-foreground shadow-lg"
    >
      <div className="container flex max-w-screen-xl items-center gap-3 px-4 py-3">
        <span className="flex-1 text-sm">A new version is available.</span>
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
      </div>
    </div>
  );
}
