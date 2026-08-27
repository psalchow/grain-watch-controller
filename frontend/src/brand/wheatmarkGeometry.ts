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

export const WHEATMARK_VIEWBOX = '0 0 512 512';

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
