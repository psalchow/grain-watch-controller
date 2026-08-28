/**
 * Stand-in for `virtual:pwa-register/react` under test.
 *
 * The virtual module only exists while the VitePWA plugin is active, and the
 * Vitest config deliberately runs without it. Tests that care about the update
 * flow mock this specifier; this implementation is the neutral fallback for
 * everything else, reporting no waiting worker so no banner appears.
 */

interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined
  ) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(_options?: RegisterSWOptions) {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
