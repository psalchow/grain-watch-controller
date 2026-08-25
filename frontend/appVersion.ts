import fs from 'fs';
import path from 'path';

/**
 * Reads the product version from the workspace root manifest.
 *
 * The root manifest is the single source of truth for the version — the PWA and
 * the BFF ship as one Docker image, so one version describes the whole release.
 * The value is injected into the bundle as `__APP_VERSION__` (see vite.config.ts
 * and vitest.config.ts), because `import.meta.env` carries no version and the
 * runtime bundle cannot read a manifest from disk.
 *
 * @param repoRoot - Absolute path to the workspace root holding the manifest
 * @returns The version string, or 'unknown' if the manifest cannot be read
 */
export function readAppVersion(repoRoot: string): string {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ) as { version?: string };
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
