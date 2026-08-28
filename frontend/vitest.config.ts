import { defineConfig } from 'vitest/config';
import path from 'path';
import { readAppVersion } from './appVersion';

export default defineConfig({
  // Mirrors the production build so components can rely on __APP_VERSION__.
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion(path.resolve(__dirname, '..'))),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Supplied by the VitePWA plugin at build time, which does not run here.
      'virtual:pwa-register/react': path.resolve(
        __dirname,
        './src/test/pwaRegisterStub.ts'
      ),
    },
  },
});
