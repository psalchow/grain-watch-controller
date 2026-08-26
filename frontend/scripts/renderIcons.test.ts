import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ICON_SPECS,
  buildIconSvg,
  readPngSize,
  renderIcons,
} from './renderIcons.ts';

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
  });

  it('renders the maskable and Apple icons full-bleed', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'grainwatch-icons-'));

    await renderIcons(outDir);

    const fullBleed = ICON_SPECS.filter((spec) => spec.corner === 'full-bleed');
    expect(fullBleed.map((spec) => spec.file)).toEqual([
      'pwa-maskable-512x512.png',
      'apple-touch-icon.png',
    ]);
  });
});
