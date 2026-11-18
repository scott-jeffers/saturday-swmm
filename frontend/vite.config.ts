import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Single source of truth for the app version: the repo-level VERSION file.
const APP_VERSION = readFileSync(fileURLToPath(new URL('../VERSION', import.meta.url)), 'utf8').trim()

export default defineConfig(({ mode }) => ({
  // The browser viewer is published at saturday-swmm.com/viewer/
  base: mode === 'viewer' ? '/viewer/' : '/',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    outDir: mode === 'viewer' ? 'dist-viewer' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 3000, // main chunk = MapLibre + three.js for the map; other pages are lazy
  },
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    port: 5280,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}))
