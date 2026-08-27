import { describe, it, expect } from 'vitest';
import {
  WHEATMARK_CONTENT_FILL,
  WHEATMARK_CONTENT_VIEWBOX,
  WHEATMARK_SHAPES,
  WHEATMARK_SIZE,
  WHEATMARK_VIEWBOX,
  type WheatmarkShape,
} from './wheatmarkGeometry';

/**
 * Bounds computed by sampling the outline, deliberately not by the closed-form
 * formula the module uses — otherwise the test would only restate the
 * implementation instead of checking it.
 */
function shapeBounds(shape: WheatmarkShape) {
  if (shape.kind === 'rect') {
    return {
      minX: shape.x,
      maxX: shape.x + shape.width,
      minY: shape.y,
      maxY: shape.y + shape.height,
    };
  }

  const theta = ((shape.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const samples = 7200;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let step = 0; step < samples; step += 1) {
    const t = (step / samples) * 2 * Math.PI;
    const localX = shape.rx * Math.cos(t);
    const localY = shape.ry * Math.sin(t);
    const x = shape.cx + localX * cos - localY * sin;
    const y = shape.cy + localX * sin + localY * cos;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return { minX, maxX, minY, maxY };
}

function artworkBounds() {
  return WHEATMARK_SHAPES.map(shapeBounds).reduce((total, one) => ({
    minX: Math.min(total.minX, one.minX),
    maxX: Math.max(total.maxX, one.maxX),
    minY: Math.min(total.minY, one.minY),
    maxY: Math.max(total.maxY, one.maxY),
  }));
}

function parseViewBox(viewBox: string) {
  const [x, y, width, height] = viewBox.split(' ').map(Number);
  return { x: x!, y: y!, width: width!, height: height! };
}

describe('WHEATMARK_VIEWBOX', () => {
  it('keeps the padded canvas the icon files need', () => {
    // Android masks the icon itself, so the artwork needs headroom around it.
    expect(parseViewBox(WHEATMARK_VIEWBOX)).toEqual({
      x: 0,
      y: 0,
      width: WHEATMARK_SIZE,
      height: WHEATMARK_SIZE,
    });
  });
});

describe('WHEATMARK_CONTENT_VIEWBOX', () => {
  it('encloses every shape', () => {
    const box = parseViewBox(WHEATMARK_CONTENT_VIEWBOX);
    const art = artworkBounds();

    expect(box.x).toBeLessThanOrEqual(art.minX);
    expect(box.y).toBeLessThanOrEqual(art.minY);
    expect(box.x + box.width).toBeGreaterThanOrEqual(art.maxX);
    expect(box.y + box.height).toBeGreaterThanOrEqual(art.maxY);
  });

  it('is square, so the mark is not distorted by a square CSS size', () => {
    const box = parseViewBox(WHEATMARK_CONTENT_VIEWBOX);

    expect(box.width).toBeCloseTo(box.height, 6);
  });

  it('centres the artwork', () => {
    const box = parseViewBox(WHEATMARK_CONTENT_VIEWBOX);
    const art = artworkBounds();

    expect(box.x + box.width / 2).toBeCloseTo((art.minX + art.maxX) / 2, 1);
    expect(box.y + box.height / 2).toBeCloseTo((art.minY + art.maxY) / 2, 1);
  });

  it('lets the artwork fill the declared share of the box', () => {
    const box = parseViewBox(WHEATMARK_CONTENT_VIEWBOX);
    const art = artworkBounds();
    const longest = Math.max(art.maxX - art.minX, art.maxY - art.minY);

    expect(longest / box.width).toBeCloseTo(WHEATMARK_CONTENT_FILL, 2);
  });

  it('crops tighter than the padded icon canvas', () => {
    // The whole point: the padded canvas rendered the mark far smaller than the
    // lucide icons sitting beside it in the header.
    expect(parseViewBox(WHEATMARK_CONTENT_VIEWBOX).width).toBeLessThan(
      WHEATMARK_SIZE
    );
  });
});
