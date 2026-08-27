import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import {
  ICON_SPECS,
  buildIconSvg,
  readPngSize,
  renderIcons,
} from './renderIcons.ts';

/** RGBA of the pixel at (0, 0), matching what `renderIcons` rasterises. */
function topLeftRgba(svg: string, size: number): [number, number, number, number] {
  const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render().pixels;

  return [pixels[0], pixels[1], pixels[2], pixels[3]];
}

describe('buildIconSvg', () => {
  it('rounds the background corners for the rounded variant', () => {
    expect(buildIconSvg(512, 'rounded')).toContain(
      '<rect width="512" height="512" rx="112" fill="#3498db"/>'
    );
  });

  it('leaves the background square for the full-bleed variant', () => {
    const svg = buildIconSvg(512, 'full-bleed');

    expect(svg).toContain('<rect width="512" height="512" fill="#3498db"/>');
    expect(svg).not.toContain('rx="112"');
  });

  it('keeps one coordinate system across every output size', () => {
    const small = buildIconSvg(32, 'rounded');
    const large = buildIconSvg(512, 'rounded');

    expect(small).toContain('viewBox="0 0 512 512"');
    expect(large).toContain('viewBox="0 0 512 512"');
    expect(small.replace('width="32" height="32"', 'width="512" height="512"')).toBe(
      large
    );
  });

  it('draws the stalk and all seven grains', () => {
    const svg = buildIconSvg(512, 'rounded');

    expect(svg).toContain('<rect x="247" y="180" width="18" height="216" rx="9"/>');
    expect(svg.match(/<ellipse /g)).toHaveLength(7);
    expect(svg).toContain('transform="rotate(-32 206 214)"');
  });
});

describe('renderIcons', () => {
  it('writes every declared icon at its declared size', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'grainwatch-icons-'));

    try {
      await renderIcons(outDir);

      for (const spec of ICON_SPECS) {
        const bytes = await readFile(path.join(outDir, spec.file));

        if (spec.file.endsWith('.png')) {
          expect(readPngSize(bytes)).toEqual({
            width: spec.size,
            height: spec.size,
          });
        } else {
          expect(bytes.toString('utf8')).toContain(
            `width="${spec.size}" height="${spec.size}"`
          );
        }
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('renders the maskable and Apple icons full-bleed, unlike the rounded variants', () => {
    // The top-left pixel separates the two treatments cleanly: rounded
    // corners leave it transparent, full-bleed backgrounds paint it in brand
    // blue right into the corner.
    for (const spec of ICON_SPECS.filter((spec) => spec.corner === 'full-bleed')) {
      expect(topLeftRgba(buildIconSvg(spec.size, spec.corner), spec.size)).toEqual([
        0x34, 0x98, 0xdb, 255,
      ]);
    }

    for (const spec of ICON_SPECS.filter(
      (spec) => spec.corner === 'rounded' && spec.file.endsWith('.png')
    )) {
      expect(topLeftRgba(buildIconSvg(spec.size, spec.corner), spec.size)).toEqual([
        0, 0, 0, 0,
      ]);
    }
  });
  // 20s timeout: @resvg/resvg-js's native binding has a slow cold start on
  // first invocation, which can exceed Vitest's default 5s on a cold CI cache.
}, 20_000);

describe('committed icons', () => {
  const publicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'public'
  );

  it('match what the generator produces', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'grainwatch-drift-'));

    try {
      await renderIcons(outDir);

      for (const spec of ICON_SPECS) {
        const committed = await readFile(path.join(publicDir, spec.file));

        if (spec.file.endsWith('.svg')) {
          const generated = await readFile(path.join(outDir, spec.file), 'utf8');
          // Byte-exact: the SVGs are pure text output of the generator, so any
          // difference means someone edited public/ by hand or forgot
          // `npm run icons` after changing the geometry.
          expect(committed.toString('utf8')).toBe(generated);
        } else {
          // Byte-exact: any difference in the generated PNG — whether from a
          // geometry change or a rasteriser update — should be regenerated via
          // `npm run icons` and committed.
          const generated = await readFile(path.join(outDir, spec.file));
          expect(committed).toEqual(generated);
          expect(readPngSize(committed)).toEqual({
            width: spec.size,
            height: spec.size,
          });
        }
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
  // 20s timeout: this test rasterises all seven icons via renderIcons, so
  // it is even more exposed to @resvg/resvg-js's native cold-start delay
  // than the renderIcons describe block above.
}, 20_000);
