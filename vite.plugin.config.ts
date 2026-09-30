import { defineConfig } from 'vite';

// The BetterNCM plugin: one classic script (IIFE) for NetEase's Chromium 91, three.js bundled in.
export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome91',
    outDir: 'dist/plugin',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: { entry: 'src/plugin/main.ts', formats: ['iife'], name: 'BetterMV', fileName: () => 'bettermv.js' },
  },
});
