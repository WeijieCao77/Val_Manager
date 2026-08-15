import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps the build working both at a domain root and under a
// GitHub Pages project subpath (/Val_Manager/).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
