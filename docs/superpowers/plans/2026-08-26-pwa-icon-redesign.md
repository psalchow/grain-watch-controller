# PWA Icon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the Grainwatch wheat mark from a single geometry source, use that same mark in the header, and generate the full icon set — including the PNGs iOS and Android require — with a committed generator script.

**Architecture:** One TypeScript module (`frontend/src/brand/wheatmark.ts`) holds the geometry as data. A React component renders it inline for the header; a Node script renders it into SVG strings and rasterises those with `@resvg/resvg-js` into `frontend/public/`. Generated files are committed; the generator runs on demand via `npm run icons`, never during `npm run build` or the Docker build. A Vitest drift test re-runs the generator into a temp directory and fails if the committed files no longer match.

**Tech Stack:** TypeScript, React 19, Vite 7, Vitest 4, `@resvg/resvg-js`, Node 22.12+ / 24 (type stripping).

**Spec:** `docs/superpowers/specs/2026-08-26-pwa-icon-redesign-design.md`

## Global Constraints

- All code, comments, documentation and commit messages in **English (UK)**: "colour", "organise", "behaviour", "initialise".
- Brand blue is exactly `#3498db`. Do not change `--color-primary` or anything else in `frontend/src/index.css`.
- Mark colour on the icons is exactly `#ffffff`.
- All geometry lives in `frontend/src/brand/wheatmark.ts`. No other file may restate the coordinates.
- Icon coordinate system is `viewBox="0 0 512 512"` for every output size.
- Rounded background corner radius is `112`; full-bleed variants carry no `rx`.
- The generator must not run as part of `npm run build`, `vite build`, or the Dockerfile.
- Node scripts under `frontend/scripts/` are run with `node --experimental-strip-types` and must therefore use erasable-only TypeScript syntax: no `enum`, no `namespace`, no parameter properties. Relative imports must carry the `.ts` extension.
- Work on a branch, not on `main`.

---

### Task 1: Brand geometry and header mark

Creates the single geometry source, the React component that draws it, and swaps the header over from lucide's `Wheat`.

**Files:**
- Create: `frontend/src/brand/wheatmark.ts`
- Create: `frontend/src/brand/WheatMark.tsx`
- Create: `frontend/src/brand/WheatMark.test.tsx`
- Modify: `frontend/src/components/Header.tsx` (the brand `<Link>` near the top of the header, and the `lucide-react` import)
- Modify: `frontend/src/components/Header.test.tsx` (append a new `describe` block at the end)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `WHEATMARK_VIEWBOX: string` — `'0 0 512 512'`
  - `BRAND_BLUE: string` — `'#3498db'`
  - `MARK_WHITE: string` — `'#ffffff'`
  - `type WheatmarkShape` — `{ kind: 'rect'; x: number; y: number; width: number; height: number; rx: number } | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number }`
  - `WHEATMARK_SHAPES: readonly WheatmarkShape[]`
  - `WheatMark({ className }: { className?: string })` — React component
- Task 2 imports `WHEATMARK_VIEWBOX`, `WHEATMARK_SHAPES`, `BRAND_BLUE`, `MARK_WHITE` and `WheatmarkShape` from `../src/brand/wheatmark.ts`.

- [ ] **Step 1: Create a branch**

```bash
git checkout -b feat/pwa-icon-redesign
```

- [ ] **Step 2: Write the geometry module**

The component test needs this module to exist before it can fail for the right reason, so the data comes first. It is pure data — there is no behaviour here to drive with a test.

Create `frontend/src/brand/wheatmark.ts`:

```ts
/**
 * Single source of truth for the Grainwatch brand mark.
 *
 * The geometry is stated once, in a 512x512 coordinate system, and consumed by
 * both the React component (WheatMark.tsx) and the icon generator
 * (scripts/renderIcons.ts). Nothing else may restate these coordinates —
 * that is what let the three hand-drawn icon files drift apart previously.
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
```

- [ ] **Step 3: Write the failing component test**

Create `frontend/src/brand/WheatMark.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WheatMark } from './WheatMark';
import { WHEATMARK_SHAPES } from './wheatmark';

describe('WheatMark', () => {
  it('draws every shape from the shared geometry', () => {
    const { container } = render(<WheatMark />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 512 512');
    expect(svg?.querySelectorAll('rect, ellipse')).toHaveLength(
      WHEATMARK_SHAPES.length
    );
  });

  it('rotates a grain around its own centre', () => {
    const { container } = render(<WheatMark />);

    const grain = container.querySelector('ellipse[cx="206"][cy="214"]');
    expect(grain?.getAttribute('transform')).toBe('rotate(-32 206 214)');
  });

  it('leaves the upright grain unrotated', () => {
    const { container } = render(<WheatMark />);

    const grain = container.querySelector('ellipse[cx="256"][cy="152"]');
    expect(grain?.getAttribute('transform')).toBeNull();
  });

  it('takes its colour from the surrounding text colour', () => {
    const { container } = render(<WheatMark className="text-primary" />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('class')).toBe('text-primary');
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<WheatMark />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm run test --workspace=frontend -- src/brand/WheatMark.test.tsx
```

Expected: FAIL — `Failed to resolve import "./WheatMark"`.

- [ ] **Step 5: Write the component**

Create `frontend/src/brand/WheatMark.tsx`:

```tsx
import { WHEATMARK_SHAPES, WHEATMARK_VIEWBOX } from './wheatmark';

interface WheatMarkProps {
  className?: string;
}

/**
 * The Grainwatch brand mark, drawn from the shared geometry so the header and
 * the installed app icon cannot drift apart.
 *
 * Decorative: the header spells the product name out next to it, so announcing
 * the mark as well would only repeat that.
 */
export function WheatMark({ className }: WheatMarkProps) {
  return (
    <svg
      viewBox={WHEATMARK_VIEWBOX}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {WHEATMARK_SHAPES.map((shape, index) =>
        shape.kind === 'rect' ? (
          <rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        ) : (
          <ellipse
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            rx={shape.rx}
            ry={shape.ry}
            transform={
              shape.rotate === undefined
                ? undefined
                : `rotate(${shape.rotate} ${shape.cx} ${shape.cy})`
            }
          />
        )
      )}
    </svg>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm run test --workspace=frontend -- src/brand/WheatMark.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Write the failing header test**

Append to the end of `frontend/src/components/Header.test.tsx`, after the existing `describe('Header mobile menu', ...)` block:

```tsx
describe('Header brand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser('admin');
  });

  it('shows the shared brand mark beside the product name', () => {
    renderHeader();

    const brand = screen.getByRole('link', { name: 'Grainwatch' });
    expect(brand.querySelector('svg[viewBox="0 0 512 512"]')).not.toBeNull();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

```bash
npm run test --workspace=frontend -- src/components/Header.test.tsx
```

Expected: FAIL on the new test — `expected null not to be null`. Lucide's `Wheat` renders `viewBox="0 0 24 24"`, so the selector finds nothing. The other tests in the file stay green.

- [ ] **Step 9: Swap the header over**

In `frontend/src/components/Header.tsx`:

Remove `Wheat` from the `lucide-react` import. The line currently reads:

```tsx
import { Info, LogOut, Wheat, UserCog, Users } from 'lucide-react';
```

Change it to:

```tsx
import { Info, LogOut, UserCog, Users } from 'lucide-react';
```

Add the new import below the existing `lucide-react` and `react-router-dom` imports:

```tsx
import { WheatMark } from '@/brand/WheatMark';
```

In the brand `<Link to="/">`, replace:

```tsx
<Wheat className="h-6 w-6 text-primary" />
```

with:

```tsx
<WheatMark className="h-6 w-6 text-primary" />
```

Leave every other lucide icon (`Info`, `LogOut`, `UserCog`, `Users`) alone — those are functional UI icons, not brand.

- [ ] **Step 10: Run the full frontend test suite**

```bash
npm run test --workspace=frontend
```

Expected: PASS, all files.

- [ ] **Step 11: Lint and typecheck**

```bash
npm run lint --workspace=frontend && npm run typecheck --workspace=frontend
```

Expected: both exit 0, no new warnings.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/brand frontend/src/components/Header.tsx frontend/src/components/Header.test.tsx
git commit -m "feat: draw the brand mark from one shared geometry source"
```

---

### Task 2: Icon generator

Builds the SVG strings and rasterises the PNGs. Writes nothing into `public/` yet — that is Task 3, so this task can be reviewed on its own output.

**Files:**
- Create: `frontend/scripts/renderIcons.ts`
- Create: `frontend/scripts/generate-icons.ts`
- Create: `frontend/scripts/renderIcons.test.ts`
- Modify: `frontend/package.json` (devDependencies, `scripts`)
- Modify: `package.json` (root, `scripts`)
- Modify: `frontend/tsconfig.node.json` (`include`)
- Modify: `frontend/eslint.config.js` (add a Node override block)

**Interfaces:**
- Consumes: `WHEATMARK_VIEWBOX`, `WHEATMARK_SHAPES`, `BRAND_BLUE`, `MARK_WHITE`, `WheatmarkShape` from Task 1.
- Produces:
  - `type IconCorner = 'rounded' | 'full-bleed'`
  - `interface IconSpec { file: string; size: number; corner: IconCorner }`
  - `ICON_SPECS: readonly IconSpec[]` — the seven output files
  - `buildIconSvg(size: number, corner: IconCorner): string`
  - `renderIcons(outDir: string): Promise<void>`
  - `readPngSize(bytes: Buffer): { width: number; height: number }`
- Task 3 imports `ICON_SPECS`, `renderIcons` and `readPngSize` from `./renderIcons.ts`.

- [ ] **Step 1: Install the rasteriser**

```bash
npm install --save-dev --workspace=frontend @resvg/resvg-js
```

Expected: `frontend/package.json` gains `"@resvg/resvg-js"` under `devDependencies`, and `package-lock.json` changes.

- [ ] **Step 2: Write the failing generator test**

Create `frontend/scripts/renderIcons.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test --workspace=frontend -- scripts/renderIcons.test.ts
```

Expected: FAIL — `Failed to resolve import "./renderIcons.ts"`.

- [ ] **Step 4: Write the renderer**

Create `frontend/scripts/renderIcons.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test --workspace=frontend -- scripts/renderIcons.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Write the CLI entry point**

Create `frontend/scripts/generate-icons.ts`:

```ts
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
```

- [ ] **Step 7: Wire up the npm scripts**

In `frontend/package.json`, add to `"scripts"` after `"preview"`:

```json
    "icons": "node --experimental-strip-types scripts/generate-icons.ts",
```

In the root `package.json`, add to `"scripts"` after `"dev:backend"`:

```json
    "icons": "npm run icons --workspace=frontend"
```

The `--experimental-strip-types` flag is what lets Node 22.12+ run the TypeScript directly. Node 24 strips types without it and accepts the flag as a no-op, so one script string covers both.

- [ ] **Step 8: Teach the tooling about `scripts/`**

In `frontend/tsconfig.node.json`, extend `include`:

```json
  "include": ["vite.config.ts", "vitest.config.ts", "appVersion.ts", "scripts"]
```

In `frontend/eslint.config.js`, add a block after the existing main config object, as the last argument to `tseslint.config(...)`:

```js
  {
    // The icon generator is a Node script, not browser code, and reports what
    // it wrote on stdout.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
```

- [ ] **Step 9: Verify the generator runs**

```bash
npm run icons --workspace=frontend
```

Expected: `Wrote 7 icons to /…/frontend/public`.

This overwrites `favicon.svg`, `pwa-192x192.svg` and `pwa-512x512.svg` and adds four PNGs — that is intended, and Task 3 reviews the result. Confirm with:

```bash
git status --short frontend/public
```

Expected: three `M` entries and four `??` entries.

- [ ] **Step 10: Lint, typecheck and full test run**

```bash
npm run lint --workspace=frontend && npm run typecheck --workspace=frontend && npm run test --workspace=frontend
```

Expected: all three exit 0.

- [ ] **Step 11: Commit the generator only**

The regenerated assets belong to Task 3, so leave `frontend/public/` out of this commit.

```bash
git add frontend/scripts frontend/package.json frontend/tsconfig.node.json frontend/eslint.config.js package.json package-lock.json
git commit -m "feat: add an icon generator driven by the shared brand geometry"
```

---

### Task 3: Generated assets and PWA wiring

Commits the generated icons, points the manifest and `index.html` at them, and locks the pair together with a drift test.

**Files:**
- Modify: `frontend/public/favicon.svg`, `frontend/public/pwa-192x192.svg`, `frontend/public/pwa-512x512.svg` (regenerated)
- Create: `frontend/public/pwa-192x192.png`, `frontend/public/pwa-512x512.png`, `frontend/public/pwa-maskable-512x512.png`, `frontend/public/apple-touch-icon.png` (generated)
- Modify: `frontend/vite.config.ts` (`includeAssets`, `manifest.icons`)
- Modify: `frontend/index.html` (the `apple-touch-icon` link)
- Modify: `frontend/scripts/renderIcons.test.ts` (append a drift `describe`)

**Interfaces:**
- Consumes: `ICON_SPECS`, `renderIcons`, `readPngSize` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Regenerate the assets**

If Task 2's step 9 has already been run and the files are still present, skip. Otherwise:

```bash
npm run icons --workspace=frontend
```

- [ ] **Step 2: Write the failing drift test**

Append to `frontend/scripts/renderIcons.test.ts`. Add `fileURLToPath` to the existing `node:url` imports — the file has none yet, so add a new import line alongside the others at the top:

```ts
import { fileURLToPath } from 'node:url';
```

Then append at the end of the file:

```ts
describe('committed icons', () => {
  const publicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'public'
  );

  it('match what the generator produces', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'grainwatch-drift-'));
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
        // Only the dimensions: a @resvg/resvg-js upgrade re-encodes the pixels
        // without anything about the design having changed.
        expect(readPngSize(committed)).toEqual({
          width: spec.size,
          height: spec.size,
        });
      }
    }
  });
});
```

- [ ] **Step 3: Run the drift test to verify it passes, then that it can fail**

```bash
npm run test --workspace=frontend -- scripts/renderIcons.test.ts
```

Expected: PASS.

Now prove the test actually guards something:

```bash
printf '\n<!-- tampered -->\n' >> frontend/public/favicon.svg
npm run test --workspace=frontend -- scripts/renderIcons.test.ts
```

Expected: FAIL on `committed icons > match what the generator produces`.

Restore:

```bash
npm run icons --workspace=frontend
npm run test --workspace=frontend -- scripts/renderIcons.test.ts
```

Expected: PASS again.

- [ ] **Step 4: Update the PWA manifest**

In `frontend/vite.config.ts`, replace the `includeAssets` line:

```ts
      includeAssets: ['favicon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg'],
```

with:

```ts
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.svg',
        'pwa-512x512.svg',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png'
      ],
```

Replace the whole `icons` array inside `manifest`:

```ts
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          // Full-bleed artwork: Android applies its own mask, so a rounded
          // source would leave gaps at the corners.
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
```

Leave `theme_color: '#3498db'`, `background_color`, `display` and `orientation` untouched.

- [ ] **Step 5: Point iOS at a PNG**

In `frontend/index.html`, replace:

```html
    <link rel="apple-touch-icon" href="/pwa-192x192.svg" />
```

with:

```html
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

iOS does not support SVG here; it was silently falling back to a screenshot of the page. Leave the `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` line and the `theme-color` meta as they are.

- [ ] **Step 6: Build and inspect the manifest**

```bash
npm run build --workspace=frontend
```

Expected: exit 0. Then check the generated manifest lists five icons and that every referenced file was emitted:

```bash
cat frontend/dist/manifest.webmanifest
ls frontend/dist/*.png frontend/dist/*.svg
```

Expected: five entries in `icons`; `dist/` contains `apple-touch-icon.png`, `favicon.svg`, `pwa-192x192.png`, `pwa-192x192.svg`, `pwa-512x512.png`, `pwa-512x512.svg`, `pwa-maskable-512x512.png`.

- [ ] **Step 7: Look at the icons**

```bash
npm run preview --workspace=frontend
```

Open the printed URL. Confirm: the favicon in the browser tab shows the wheat ear, and the header mark matches it. Then DevTools → Application → Manifest: all five icons render without a "failed to load" warning. Stop the preview with Ctrl-C.

- [ ] **Step 8: Full verification**

```bash
npm run lint && npm run typecheck && npm run test
```

Run from the repository root so both workspaces are covered. Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/public frontend/vite.config.ts frontend/index.html frontend/scripts/renderIcons.test.ts
git commit -m "feat: ship generated PWA icons with correct maskable and iOS variants"
```

- [ ] **Step 10: Bump the version**

The icon set is user-visible, so it ships as a release.

```bash
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: release $(node -p "require('./package.json').version")"
```

Expected: root `package.json` goes from `1.2.0` to `1.3.0`. The workspace manifests carry no version and must stay that way.

---

## Done when

- `npm run lint`, `npm run typecheck` and `npm run test` pass from the repository root
- `npm run icons` regenerates `frontend/public/` with no `git diff`
- The header mark and the favicon are visibly the same shape
- `frontend/dist/manifest.webmanifest` lists five icons, one of them `purpose: "maskable"` on full-bleed artwork
- `index.html` references `apple-touch-icon.png`
