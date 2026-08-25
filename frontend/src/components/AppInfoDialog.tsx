import { useEffect, useState } from 'react';
import { systemApi } from '@/api';
import { Dialog } from '@/components/ui/dialog';

interface AppInfoDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Version of the loaded PWA bundle, baked in at build time. */
const FRONTEND_VERSION = __APP_VERSION__;

/**
 * Shows which versions are actually running, so a deployment can be verified
 * from the app itself.
 *
 * The frontend version comes from the bundle, the backend version from the live
 * /health response. Both derive from the same root manifest, so a mismatch means
 * the browser still holds a cached bundle from an earlier release.
 */
export function AppInfoDialog({ open, onClose }: AppInfoDialogProps) {
  // Mounting the body only while open keeps the probe fresh on every opening:
  // the state starts empty again instead of needing a reset.
  if (!open) return null;

  return (
    <Dialog open onClose={onClose} title="App info">
      <AppInfoBody />
    </Dialog>
  );
}

/** Version list, fetching the backend version once on mount. */
function AppInfoBody() {
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    systemApi
      .getHealth()
      .then((health) => {
        if (!cancelled) setBackendVersion(health.version);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Warnings and errors are German, the rest of the interface is English
  // (see lib/messages.ts for the same policy on device and API messages).
  const backendLabel = failed ? 'nicht erreichbar' : (backendVersion ?? '…');
  const stale =
    backendVersion !== null && backendVersion !== FRONTEND_VERSION;

  return (
    <>
      <dl className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Frontend</dt>
          <dd className="font-mono">{FRONTEND_VERSION}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Backend</dt>
          <dd className="font-mono">{backendLabel}</dd>
        </div>
      </dl>

      {stale && (
        <p className="mt-4 text-sm text-amber-600">
          Versionen weichen ab — App neu laden, um das ausgelieferte Frontend zu
          verwenden.
        </p>
      )}
    </>
  );
}
