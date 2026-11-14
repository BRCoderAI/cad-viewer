import { defineConfig } from 'vite';

// base './' so the built app works from any static-host path
// (GitHub Pages project site, Cloudflare Pages, Vercel, local file serve).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
