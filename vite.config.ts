import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { generateCatalogIndex } from './scripts/gen-catalog-index.mjs';

/**
 * Auto-regenerate src/templates/catalog-index.json whenever a
 * .template.yaml file under src/templates/builtin/ is added, changed,
 * or removed. Runs once at build/dev start, then watches in dev mode.
 *
 * The generator writes the JSON only when content changes, so Vite's
 * own HMR machinery picks up the JSON change and invalidates modules
 * that import it (notably src/templates/builtin-loader.ts).
 */
function folioCatalogIndexPlugin(): Plugin {
  const TEMPLATE_GLOB = /src[/\\]templates[/\\]builtin[/\\][^/\\]+\.template\.yaml$/;
  let regenerating: Promise<void> | null = null;

  const regen = async (reason: string): Promise<void> => {
    // Coalesce overlapping regen calls — if one is in flight, a second
    // file save during regen reuses it instead of stacking work.
    if (regenerating) return regenerating;
    regenerating = generateCatalogIndex({ silent: true })
      .then(({ count, changed, errors }) => {
        if (errors.length) {
          console.warn(`[folio-catalog] ${errors.length} template error(s) during ${reason}:`);
          for (const e of errors) console.warn(`  - ${e}`);
        }
        if (changed) {
          console.log(`[folio-catalog] regenerated index (${count} templates) — ${reason}`);
        }
      })
      .catch(err => {
        console.error('[folio-catalog] regen failed:', err);
      })
      .finally(() => { regenerating = null; });
    return regenerating;
  };

  return {
    name: 'folio-catalog-index',

    // Runs for both `vite build` and `vite` (dev). Replaces the old
    // predev/prebuild npm hooks.
    async buildStart() {
      await regen('build start');
    },

    configureServer(server) {
      server.watcher.on('add',    (file) => { if (TEMPLATE_GLOB.test(file)) void regen(`add ${file}`); });
      server.watcher.on('change', (file) => { if (TEMPLATE_GLOB.test(file)) void regen(`change ${file}`); });
      server.watcher.on('unlink', (file) => { if (TEMPLATE_GLOB.test(file)) void regen(`unlink ${file}`); });
    },
  };
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __DEV__: mode === 'development',
    __PROD__: mode === 'production',
  },
  plugins: [folioCatalogIndexPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: mode !== 'production',
    minify: mode === 'production' ? 'esbuild' : false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 3000,
    open: false,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    port: 4173,
    allowedHosts: true,
  },
}));
