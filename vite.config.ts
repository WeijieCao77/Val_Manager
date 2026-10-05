import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { LATEST as CHANGELOG_LATEST } from './src/data/changelog'

// base: './' keeps the build working both at a domain root and under a
// GitHub Pages project subpath (/Val_Manager/).
export default defineConfig({
  plugins: [react()],
  base: './',
  // The changelog button needs one string to light its dot — which entry is
  // newest — and nothing else until somebody opens it. Baked in here, so the
  // ~190 KB of release notes are fetched on opening (ui/Changelog.tsx), not
  // with the front page and both modes.
  define: { __CHANGELOG_LATEST__: JSON.stringify(CHANGELOG_LATEST) },
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
          // The datasets are the biggest things in the build, and Rollup's
          // default grouping put the 370 KB of rosters in the same chunk as the
          // changelog text — which the front page needed then. So the page that had
          // been carefully kept clear of the game engine downloaded the game
          // anyway, to draw a panel of release notes.
          //
          // Named explicitly: each dataset is its own chunk, fetched by
          // whichever page actually reads it and by nothing else.
          if (id.includes('src/data/world.json')) return 'world'
          if (id.includes('src/data/dossier.json')) return 'dossier'
          if (id.includes('src/data/prospects.json')) return 'world'
          if (id.includes('src/data/changelog')) return 'changelog'
        },
      },
    },
  },
})
