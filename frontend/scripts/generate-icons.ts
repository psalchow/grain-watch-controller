/**
 * Writes the committed icon set. Run by hand via `npm run icons` after changing
 * the geometry in src/brand/wheatmark.ts — deliberately not part of the build,
 * so neither `vite build` nor the Docker image needs the rasteriser.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_SPECS, renderIcons } from './renderIcons.ts';

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public'
);

await renderIcons(publicDir);

console.log(`Wrote ${ICON_SPECS.length} icons to ${publicDir}`);
