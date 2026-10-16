import { defineConfig } from 'vite';

// The in-page half of the frame-time bench (tools/bench/inpage.ts), one classic script for NetEase's Chromium 91.
export default defineConfig({
  publicDir: false,
  define: { __VERSION__: '"bench"' },
  build: {
    target: 'chrome91',
    outDir: 'dist/bench',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: { entry: 'tools/bench/inpage.ts', formats: ['iife'], name: 'BmvBench', fileName: () => 'inpage.js' },
  },
});
