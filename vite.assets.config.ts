// A second, tiny build: the asset explorer on its own.
//
// The Design Library at /library is a server-rendered page, not the editor SPA,
// so it cannot import from the editor's hashed chunks. This emits the explorer
// as one self-contained IIFE with a STABLE filename that the page can link:
//
//   dist/asset-explorer.js   → window.FolioAssets.mount(el, opts)
//   dist/asset-explorer.css
//
// Kept out of vite.config.ts so the editor build is untouched by it, and so a
// failure here can never take the editor bundle down with it.
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The editor's own output lives here too; this build must add to it, never
    // wipe it.
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/ui/panels/asset-explorer-mount.ts'),
      name: 'FolioAssets',
      formats: ['iife'],
      fileName: () => 'asset-explorer.js',
      cssFileName: 'asset-explorer',
    },
  },
});
