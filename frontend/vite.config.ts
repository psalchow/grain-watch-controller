import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { API_CACHE_NAME } from './src/lib/apiCache'
import { BRAND_BLUE } from './src/brand/wheatmarkGeometry'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readAppVersion } from './appVersion'

export default defineConfig({
  // The bundle cannot read a manifest at runtime, so the version is baked in.
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion(path.resolve(__dirname, '..')))
  },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // 'prompt' leaves the new worker waiting until the user accepts the
      // update banner. Under 'autoUpdate' a deployment could swap the assets
      // mid-session, which is a poor moment to lose the screen you were reading.
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.svg',
        'pwa-512x512.svg',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png'
      ],
      manifest: {
        name: 'Grainwatch',
        short_name: 'Grainwatch',
        description: 'Grain Stock Monitoring',
        theme_color: BRAND_BLUE,
        background_color: '#f5f5f5',
        display: 'standalone',
        orientation: 'portrait',
        // Raster first: Android mints a WebAPK from a bitmap, and where two
        // entries declare the same size and purpose the pick is not specified.
        // The SVGs stay as a sharper option for surfaces that prefer vectors.
        icons: [
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
          // Full-bleed artwork: Android applies its own mask, so a rounded
          // source would leave gaps at the corners.
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: API_CACHE_NAME,
              // Fall back to the cache once the network looks unresponsive,
              // rather than leaving readings pending indefinitely.
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1 hour
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
