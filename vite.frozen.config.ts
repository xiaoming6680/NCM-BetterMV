import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

// The dev harness without file watching or reloads: a stable page for capturing stills and sample clips while the
// sources are being edited (restart it to pick up changes).
export default mergeConfig(base, defineConfig({ server: { port: 5191, strictPort: true, hmr: false, watch: null } }));
