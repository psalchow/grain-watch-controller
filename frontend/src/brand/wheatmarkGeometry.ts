/**
 * Single source of truth for the Grainwatch brand mark.
 *
 * The geometry is stated once, in a 512x512 coordinate system, and consumed by
 * both the React component (WheatMark.tsx) and the icon generator
 * (scripts/renderIcons.ts). Nothing else may restate these coordinates —
 * that is what let the three hand-drawn icon files drift apart previously.
 *
 * File is named wheatmarkGeometry.ts, not wheatmark.ts, to avoid a
 * case-insensitive filesystem collision with WheatMark.tsx.
 */

/** The brand mark's coordinate system is square; this is both its side length
 * in the geometry below and the icon generator's canvas size. */
export const WHEATMARK_SIZE = 512;

export const WHEATMARK_VIEWBOX = `0 0 ${WHEATMARK_SIZE} ${WHEATMARK_SIZE}`;

/**
 * Brand blue. This is the same colour as --color-primary in src/index.css:
 * hsl(204 70% 53%) is rgb(51, 152, 219), #3498db is rgb(52, 152, 219).
 */
export const BRAND_BLUE = '#3498db';

/** The mark itself on the generated icons. */
export const MARK_WHITE = '#ffffff';

export type WheatmarkShape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** Degrees, applied around the ellipse's own centre. */
      rotate?: number;
    };

/**
 * A wheat ear: an upright stalk, a terminal grain, and three mirrored grain
 * pairs. Every point stays within roughly 160 units of the centre, well inside
 * the 204.8-unit radius of Android's maskable safe zone.
 */
export const WHEATMARK_SHAPES: readonly WheatmarkShape[] = [
  { kind: 'rect', x: 247, y: 180, width: 18, height: 216, rx: 9 },
  { kind: 'ellipse', cx: 256, cy: 152, rx: 27, ry: 54 },
  { kind: 'ellipse', cx: 206, cy: 214, rx: 25, ry: 50, rotate: -32 },
  { kind: 'ellipse', cx: 306, cy: 214, rx: 25, ry: 50, rotate: 32 },
  { kind: 'ellipse', cx: 206, cy: 278, rx: 25, ry: 50, rotate: -32 },
  { kind: 'ellipse', cx: 306, cy: 278, rx: 25, ry: 50, rotate: 32 },
  { kind: 'ellipse', cx: 206, cy: 342, rx: 25, ry: 50, rotate: -32 },
  { kind: 'ellipse', cx: 306, cy: 342, rx: 25, ry: 50, rotate: 32 },
];

/**
 * The share of the inline mark's viewBox that the artwork fills.
 *
 * The icon files keep the padded 512 canvas above — Android's mask needs that
 * headroom. In the header the padding is dead weight: the artwork occupies only
 * 168 x 298 of the 512 square, so at the same CSS size it rendered at roughly a
 * third of the width of the lucide icons beside it.
 */
export const WHEATMARK_CONTENT_FILL = 0.96;

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function shapeBounds(shape: WheatmarkShape): Bounds {
  if (shape.kind === 'rect') {
    return {
      minX: shape.x,
      maxX: shape.x + shape.width,
      minY: shape.y,
      maxY: shape.y + shape.height,
    };
  }

  // Axis-aligned half-extents of a rotated ellipse, from the maximum of its
  // parametric form — no need to walk the outline.
  const theta = ((shape.rotate ?? 0) * Math.PI) / 180;
  const halfWidth = Math.hypot(
    shape.rx * Math.cos(theta),
    shape.ry * Math.sin(theta)
  );
  const halfHeight = Math.hypot(
    shape.rx * Math.sin(theta),
    shape.ry * Math.cos(theta)
  );

  return {
    minX: shape.cx - halfWidth,
    maxX: shape.cx + halfWidth,
    minY: shape.cy - halfHeight,
    maxY: shape.cy + halfHeight,
  };
}

function contentViewBox(): string {
  const art = WHEATMARK_SHAPES.map(shapeBounds).reduce((total, one) => ({
    minX: Math.min(total.minX, one.minX),
    maxX: Math.max(total.maxX, one.maxX),
    minY: Math.min(total.minY, one.minY),
    maxY: Math.max(total.maxY, one.maxY),
  }));

  // Square, so a square CSS size cannot distort the mark.
  const side =
    Math.max(art.maxX - art.minX, art.maxY - art.minY) / WHEATMARK_CONTENT_FILL;
  const x = (art.minX + art.maxX) / 2 - side / 2;
  const y = (art.minY + art.maxY) / 2 - side / 2;

  const round = (value: number) => Math.round(value * 100) / 100;

  return `${round(x)} ${round(y)} ${round(side)} ${round(side)}`;
}

/**
 * viewBox for the mark drawn inline in the UI: cropped to the artwork, derived
 * from the shapes above so it follows any change to them.
 */
export const WHEATMARK_CONTENT_VIEWBOX = contentViewBox();
