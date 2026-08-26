import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  BRAND_BLUE,
  MARK_WHITE,
  WHEATMARK_SHAPES,
  WHEATMARK_VIEWBOX,
  type WheatmarkShape,
} from '../src/brand/wheatmark.ts';

/**
 * Rounded artwork is what a browser tab and Android's `any` purpose show
 * unaltered. Full-bleed artwork is for the surfaces that apply their own mask —
 * Android's `maskable` purpose and iOS's home screen — where baked-in rounding
 * would leave visible gaps at the corners.
 */
export type IconCorner = 'rounded' | 'full-bleed';

export interface IconSpec {
  file: string;
  size: number;
  corner: IconCorner;
}

export const ICON_SPECS: readonly IconSpec[] = [
  { file: 'favicon.svg', size: 32, corner: 'rounded' },
  { file: 'pwa-192x192.svg', size: 192, corner: 'rounded' },
  { file: 'pwa-512x512.svg', size: 512, corner: 'rounded' },
  { file: 'pwa-192x192.png', size: 192, corner: 'rounded' },
  { file: 'pwa-512x512.png', size: 512, corner: 'rounded' },
  { file: 'pwa-maskable-512x512.png', size: 512, corner: 'full-bleed' },
  { file: 'apple-touch-icon.png', size: 180, corner: 'full-bleed' },
];

const CORNER_RADIUS = 112;

function shapeToSvg(shape: WheatmarkShape): string {
  if (shape.kind === 'rect') {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx}"/>`;
  }

  const transform =
    shape.rotate === undefined
      ? ''
      : ` transform="rotate(${shape.rotate} ${shape.cx} ${shape.cy})"`;

  return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"${transform}/>`;
}

/**
 * Every size shares one viewBox and one set of paths — only width and height
 * differ. That is what keeps the sizes from drifting apart.
 */
export function buildIconSvg(size: number, corner: IconCorner): string {
  const radius = corner === 'rounded' ? ` rx="${CORNER_RADIUS}"` : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${WHEATMARK_VIEWBOX}">`,
    `  <rect width="512" height="512"${radius} fill="${BRAND_BLUE}"/>`,
    `  <g fill="${MARK_WHITE}">`,
    ...WHEATMARK_SHAPES.map((shape) => `    ${shapeToSvg(shape)}`),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

/** Width and height sit at fixed offsets in a PNG's IHDR chunk. */
export function readPngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export async function renderIcons(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });

  for (const spec of ICON_SPECS) {
    const svg = buildIconSvg(spec.size, spec.corner);
    const target = path.join(outDir, spec.file);

    if (spec.file.endsWith('.svg')) {
      await writeFile(target, svg, 'utf8');
      continue;
    }

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: spec.size },
    })
      .render()
      .asPng();

    await writeFile(target, png);
  }
}
