import { defineConfig } from 'vitest/config';
import path from 'path';
import { readAppVersion } from './appVersion.ts';

export default defineConfig({
  // Mirrors the production build so components can rely on __APP_VERSION__.
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion(path.resolve(import.meta.dirname, '..'))),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
