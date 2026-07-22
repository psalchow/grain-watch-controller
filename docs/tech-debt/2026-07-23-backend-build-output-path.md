# Tech debt: backend build output path (`dist/src/…`)

**Date:** 2026-07-23
**Status:** Open — workaround in place

## Problem

`backend/tsconfig.json` has `rootDir: "."` and `include: ["src/**/*", "tests/**/*"]`.
As a result `tsc` (the `build` script) emits to `dist/src/…` (and `dist/tests/…`),
not `dist/…`. But the entry points referenced `dist/index.js`:

- `backend/package.json` → `main`, `start`
- `backend/Dockerfile` → `CMD`

So the **compiled** app never started (`node dist/index.js` → file not found).
This was latent because the app is normally run/tested via `tsx` (`npm run dev`,
Jest with ts-jest), never via the compiled artefact. The local simulation setup
(`docker-compose.sim.yml`, which builds the production image) surfaced it.

## Current workaround (commit `ca34ddf`)

- `main`/`start`/`CMD` point at `dist/src/index.js`.
- Drizzle migrations copied to both `./drizzle` and `./dist/drizzle`.
- Removed a bare `import '../types/express.d.ts'` in `auth.middleware.ts` that
  compiled to a runtime `require` of a non-existent `.js` (the global type
  augmentation still applies via `tsconfig` `include`).

Backend verified green after the change: typecheck clean, 351/351 tests, lint clean.

## Proper fix (deferred)

Introduce a `backend/tsconfig.build.json` that extends `tsconfig.json` with
`rootDir: "src"` and `exclude: ["tests/**"]`, and point `build` at it
(`tsc -p tsconfig.build.json`). Then `dist/index.js` is correct again and the
`dist/src` workaround (entry points + the second drizzle copy) can be reverted.
Keep the `express.d.ts` import removal.
