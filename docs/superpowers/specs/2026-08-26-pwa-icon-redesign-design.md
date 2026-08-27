# PWA Icon Redesign

**Date:** 2026-08-26
**Status:** Approved

## Problem

The PWA icons are three independently hand-drawn SVG files (`favicon.svg`,
`pwa-192x192.svg`, `pwa-512x512.svg`). They share a motif — a white wheat ear on
a blue rounded square — but not a geometry: the proportions drift between sizes
because each file was drawn separately rather than scaled from one source.

Three further defects come with them:

1. **The header shows a different mark.** `Header.tsx` renders lucide's `Wheat`
   icon, which is not the shape used in the app icon. The brand reads as two
   different marks depending on where you look.
2. **The maskable icon is not maskable.** The manifest declares a single entry as
   `purpose: "any maskable"` pointing at the rounded artwork. Android applies its
   own mask on top, so the rounded corners leave visible gaps.
3. **`apple-touch-icon` is an SVG.** iOS does not support SVG there and falls
   back to a screenshot of the page when a user adds the app to the home screen.

## Decisions

- **Motif stays.** The wheat ear is redrawn on a grid, not replaced. Recognition
  is preserved.
- **Single colour, white on blue.** No two-tone or inverted treatment. Maximum
  contrast, scales down cleanly, nothing to keep in sync.
- **One source, generated artefacts.** Geometry lives in one TypeScript module;
  a script renders every file from it.
- **Generated files are committed.** The generator runs on demand, never during
  `npm run build`, so the Docker image needs none of it.

### Colour note

The icons use `#3498db`; the theme defines `--color-primary: hsl(204 70% 53%)`.
These are the same colour: `hsl(204 70% 53%)` is `rgb(51, 152, 219)` and
`#3498db` is `rgb(52, 152, 219)`. There is no conflict to resolve — only a value
stated twice. The hex stays `#3498db` and is now held in one constant with a
comment recording the equivalence. `index.css` is not changed.

## Geometry

All coordinates are in a `0 0 512 512` viewBox.

| Element | Shape |
|---|---|
| Stalk | `rect x=247 y=180 width=18 height=216 rx=9` |
| Terminal grain | `ellipse cx=256 cy=152 rx=27 ry=54` |
| Grain pair 1 | `ellipse cx=206 cy=214 rx=25 ry=50` rotated `-32°`; mirror at `cx=306`, `+32°` |
| Grain pair 2 | same at `cy=278` |
| Grain pair 3 | same at `cy=342` |

Background (icon files only): `rect width=512 height=512 fill=#3498db`, with
`rx=112` for rounded variants and no `rx` for full-bleed variants.

**Maskable safe zone.** Android's safe zone is a circle of radius 204.8 centred
on the icon. The mark's furthest point sits about 160 from the centre, so it
clears the safe zone with room to spare. The same artwork therefore serves both
the rounded and the full-bleed renderings — only the background corner radius
differs.

## Components

### `frontend/src/brand/wheatmarkGeometry.ts`

The single source of truth. Exports:

- `WHEATMARK_VIEWBOX` — `'0 0 512 512'`
- `WHEATMARK_SHAPES` — an ordered array of shape descriptors (one per row of the
  geometry table: a discriminated union of `rect` and `ellipse`, the latter
  carrying an optional rotation). Both the generator's SVG string builder and the
  React component iterate this array, so neither restates the coordinates.
- `BRAND_BLUE` — `'#3498db'`, with the comment recording that this is the same
  colour as `--color-primary`

Consumed by the React component and by the generator script. Nothing else defines
the geometry.

### `frontend/src/brand/WheatMark.tsx`

React component rendering the mark alone — no background square. Uses
`fill="currentColor"` and accepts `className`, so colour and size come from
Tailwind at the call site.

In `Header.tsx` it replaces `<Wheat className="h-6 w-6 text-primary" />` with the
same classes; the `Wheat` import from `lucide-react` is dropped. The other lucide
icons (`Info`, `LogOut`, `UserCog`, `Users`) stay — those are functional UI
icons, not brand.

### `frontend/scripts/renderIcons.ts` and `frontend/scripts/generate-icons.ts`

`renderIcons.ts` holds the SVG string builder and the `renderIcons()` function
that rasterises it; `generate-icons.ts` is the thin CLI entry point that calls
`renderIcons()` against `frontend/public/`. Together they write every
artefact:

| File | Size | Background | Purpose |
|---|---|---|---|
| `favicon.svg` | 32 | rounded `rx=112` | Browser tab |
| `pwa-192x192.svg` | 192 | rounded | Manifest, crisp |
| `pwa-512x512.svg` | 512 | rounded | Manifest, crisp |
| `pwa-192x192.png` | 192 | rounded | Manifest `purpose: any` |
| `pwa-512x512.png` | 512 | rounded | Manifest `purpose: any` |
| `pwa-maskable-512x512.png` | 512 | full-bleed | Manifest `purpose: maskable` |
| `apple-touch-icon.png` | 180 | full-bleed, opaque | iOS home screen |

The three SVGs carry identical `viewBox` and path data and differ only in their
`width`/`height` attributes, which is what removes the scaling drift.

`apple-touch-icon.png` is deliberately opaque and square: iOS composites
transparency against black and applies its own corner rounding.

**Rasteriser:** `@resvg/resvg-js` as a frontend devDependency. It is a plain
SVG-to-PNG renderer rather than a general image-processing library, and it ships
prebuilds including Alpine/musl. Its platform binaries are declared as
`optionalDependencies`, so a missing prebuild cannot fail `npm ci` in the
Dockerfile.

**Scripts:**

- `frontend/package.json`: `"icons": "node --experimental-strip-types scripts/generate-icons.ts"`
- root `package.json`: `"icons": "npm run icons --workspace=frontend"`

## Configuration changes

**`frontend/vite.config.ts`**

- `includeAssets` gains the PNG files
- `manifest.icons` is rewritten: the SVG and PNG entries carry
  `purpose: "any"`; `pwa-maskable-512x512.png` gets its own entry with
  `purpose: "maskable"`. The combined `"any maskable"` entry is removed.
- `workbox.globPatterns` already matches `png`; no change needed

**`frontend/index.html`**

- `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`
- `<meta name="theme-color" content="#3498db">` unchanged

`frontend/dist/` holds stale copies of the old SVGs. It is build output and is
overwritten on the next build; nothing to do.

## Testing

**Drift test** (Vitest, `frontend/src/brand/`): runs the generator into a
temporary directory and compares the result against the committed files in
`public/`.

- SVGs: byte-exact comparison
- PNGs: assert the file exists and has the expected pixel dimensions. Byte
  comparison is avoided because a `@resvg/resvg-js` upgrade would change the
  encoded output without any change to the design.

The test fails when someone edits `wheatmarkGeometry.ts` without re-running
`npm run icons`.

**Existing tests:** `Header.test.tsx` does not reference the brand icon, so
swapping the component does not affect it.

**Commands:** `npm run test`, `npm run lint`, `npm run typecheck`.

**Manual check:** `npm run build && npm run preview`, then DevTools → Application
→ Manifest to confirm the five manifest icon entries resolve (two SVG, two PNG
with `purpose: any`, one PNG with `purpose: maskable`), the favicon in the tab,
and "Add to Home Screen" on iOS. `favicon.svg` and `apple-touch-icon.png` are
referenced from `index.html`, not from the manifest.

## Out of scope

- Changing `--color-primary` or any other theme colour
- Replacing functional lucide icons elsewhere in the UI
- Running the generator as part of `npm run build` or the Docker build
- A separate dark-mode icon variant
