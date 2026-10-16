import { defineConfig } from 'vite';

// The OBS page (src/obs/page.ts): a classic script, as a page opened from a file can't load modules. Packed into the
// plugin as obs/obs.js beside plugin/obs/index.html; the plugin copies both to <BetterNCM data>\BetterMV\obs\.
export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome91',
    outDir: 'dist/obs',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: { entry: 'src/obs/page.ts', formats: ['iife'], name: 'BetterMVObs', fileName: () => 'obs.js' },
  },
});
