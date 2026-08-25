/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Product version injected at build time from the workspace root package.json
 * (see vite.config.ts). 'unknown' if the manifest could not be read.
 */
declare const __APP_VERSION__: string
