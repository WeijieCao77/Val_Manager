import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps the build working both at a domain root and under a
// GitHub Pages project subpath (/Val_Manager/).
export default defineConfig({
  plugins: [react()],
  base: './',
  // The web build is the one with a server behind it. See vite.config.minitool.ts
  // for the offline 小红书 小工具 target, which flips this.
  define: { __MINITOOL__: 'false' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
