import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { generateCatalogIndex } from './scripts/gen-catalog-index.mjs';
import { generateVariants }     from './scripts/gen-template-variants.mjs';

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
  // Files that the variant generator owns — ignore change events for
  // these so the plugin doesn't loop when it writes them itself.
  const VARIANT_GLOB  = /src[/\\]templates[/\\]builtin[/\\]v-[^/\\]+\.template\.yaml$/;
  let regenerating: Promise<void> | null = null;

  const runPipeline = async (reason: string, regenVariants: boolean): Promise<void> => {
    if (regenVariants) {
      const v = await generateVariants({ silent: true });
      if (v.written > 0 || v.pruned > 0) {
        console.log(`[folio-catalog] variants — wrote=${v.written} pruned=${v.pruned} (${reason})`);
      }
      if (v.errors.length) {
        for (const e of v.errors) console.warn(`[folio-catalog] variant error: ${e}`);
      }
    }
    const c = await generateCatalogIndex({ silent: true });
    if (c.changed) {
      console.log(`[folio-catalog] index — ${c.count} templates (${reason})`);
    }
    if (c.errors.length) {
      for (const e of c.errors) console.warn(`[folio-catalog] index error: ${e}`);
    }
  };

  const regen = async (reason: string, regenVariants: boolean): Promise<void> => {
    if (regenerating) return regenerating;
    regenerating = runPipeline(reason, regenVariants)
      .catch(err => { console.error('[folio-catalog] regen failed:', err); })
      .finally(() => { regenerating = null; });
    return regenerating;
  };

  return {
    name: 'folio-catalog-index',

    async buildStart() {
      // On dev/build start, regenerate variants too — keeps the dev
      // catalog in sync if a base was edited while the server was off.
      await regen('build start', true);
    },

    configureServer(server) {
      const onEvent = (file: string, kind: string): void => {
        if (!TEMPLATE_GLOB.test(file)) return;
        if (VARIANT_GLOB.test(file)) return; // skip self-writes
        void regen(`${kind} ${file}`, true);
      };
      server.watcher.on('add',    f => onEvent(f, 'add'));
      server.watcher.on('change', f => onEvent(f, 'change'));
      server.watcher.on('unlink', f => onEvent(f, 'unlink'));
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
