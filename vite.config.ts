import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps the build working both at a domain root and under a
// GitHub Pages project subpath (/Val_Manager/).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // React changes once a year; the game changes every week. Kept in its
        // own chunk, an update no longer invalidates the framework in every
        // player's cache.
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor'
        },
      },
    },
  },
})
