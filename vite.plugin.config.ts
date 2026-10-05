import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'plugin/manifest.json'), 'utf8')).version;

// The BetterNCM plugin: one classic script (IIFE) for NetEase's Chromium 91, three.js bundled in.
export default defineConfig({
  publicDir: false,
  // The settings page shows the version; the manifest is where it is kept.
  define: { __VERSION__: JSON.stringify(version) },
  build: {
    target: 'chrome91',
    outDir: 'dist/plugin',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: { entry: 'src/plugin/main.ts', formats: ['iife'], name: 'BetterMV', fileName: () => 'bettermv.js' },
  },
});
