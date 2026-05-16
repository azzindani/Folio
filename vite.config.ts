import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { generateCatalogIndex } from './scripts/gen-catalog-index.mjs';
import { generatePaletteIndex } from './scripts/gen-palette-index.mjs';
import { generateTypePackIndex } from './scripts/gen-type-pack-index.mjs';
import { generateEffectsPackIndex } from './scripts/gen-effects-pack-index.mjs';

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
  const TEMPLATE_GLOB = /public[/\\]templates[/\\]builtin[/\\][^/\\]+\.template\.yaml$/;
  let regenerating: Promise<void> | null = null;

  const regen = async (reason: string): Promise<void> => {
    if (regenerating) return regenerating;
    regenerating = generateCatalogIndex({ silent: true })
      .then(({ count, changed, errors }) => {
        if (errors.length) {
          for (const e of errors) console.warn(`[folio-catalog] error: ${e}`);
        }
        if (changed) {
          console.log(`[folio-catalog] index — ${count} templates (${reason})`);
        }
      })
      .catch(err => { console.error('[folio-catalog] regen failed:', err); })
      .finally(() => { regenerating = null; });
    return regenerating;
  };

  return {
    name: 'folio-catalog-index',

    async buildStart() {
      await regen('build start');
    },

    configureServer(server) {
      const onEvent = (file: string, kind: string): void => {
        if (!TEMPLATE_GLOB.test(file)) return;
        void regen(`${kind} ${file}`);
      };
      server.watcher.on('add',    f => onEvent(f, 'add'));
      server.watcher.on('change', f => onEvent(f, 'change'));
      server.watcher.on('unlink', f => onEvent(f, 'unlink'));
    },
  };
}

/**
 * Generic factory for "watch a style-primitive dir, regen its index"
 * plugins. The catalog plugin above is special-cased because it predates
 * this helper and has slightly different watch semantics; for new
 * primitives we use this factory to keep the boilerplate tight.
 */
function styleIndexPlugin(opts: {
  name: string;
  logPrefix: string;
  globRe: RegExp;
  regenFn: (o: { silent: boolean }) => Promise<{ count: number; changed: boolean; errors: string[] }>;
}): Plugin {
  let regenerating: Promise<void> | null = null;
  const regen = async (reason: string): Promise<void> => {
    if (regenerating) return regenerating;
    regenerating = opts.regenFn({ silent: true })
      .then(({ count, changed, errors }) => {
        if (errors.length) {
          for (const e of errors) console.warn(`[${opts.logPrefix}] error: ${e}`);
        }
        if (changed) {
          console.log(`[${opts.logPrefix}] index — ${count} entries (${reason})`);
        }
      })
      .catch(err => { console.error(`[${opts.logPrefix}] regen failed:`, err); })
      .finally(() => { regenerating = null; });
    return regenerating;
  };
  return {
    name: opts.name,
    async buildStart() { await regen('build start'); },
    configureServer(server) {
      const onEvent = (file: string, kind: string): void => {
        if (!opts.globRe.test(file)) return;
        void regen(`${kind} ${file}`);
      };
      server.watcher.on('add',    f => onEvent(f, 'add'));
      server.watcher.on('change', f => onEvent(f, 'change'));
      server.watcher.on('unlink', f => onEvent(f, 'unlink'));
    },
  };
}

/**
 * Auto-regenerate src/styles/palette-index.json whenever a
 * .palette.yaml file under public/styles/palettes/ changes. Same
 * idempotent-write semantics as the catalog plugin above.
 */
function folioPaletteIndexPlugin(): Plugin {
  const PALETTE_GLOB = /public[/\\]styles[/\\]palettes[/\\][^/\\]+\.palette\.yaml$/;
  let regenerating: Promise<void> | null = null;

  const regen = async (reason: string): Promise<void> => {
    if (regenerating) return regenerating;
    regenerating = generatePaletteIndex({ silent: true })
      .then(({ count, changed, errors }) => {
        if (errors.length) {
          for (const e of errors) console.warn(`[folio-palettes] error: ${e}`);
        }
        if (changed) {
          console.log(`[folio-palettes] index — ${count} palettes (${reason})`);
        }
      })
      .catch(err => { console.error('[folio-palettes] regen failed:', err); })
      .finally(() => { regenerating = null; });
    return regenerating;
  };

  return {
    name: 'folio-palette-index',

    async buildStart() {
      await regen('build start');
    },

    configureServer(server) {
      const onEvent = (file: string, kind: string): void => {
        if (!PALETTE_GLOB.test(file)) return;
        void regen(`${kind} ${file}`);
      };
      server.watcher.on('add',    f => onEvent(f, 'add'));
      server.watcher.on('change', f => onEvent(f, 'change'));
      server.watcher.on('unlink', f => onEvent(f, 'unlink'));
    },
  };
}

function folioTypePackIndexPlugin(): Plugin {
  return styleIndexPlugin({
    name:      'folio-type-pack-index',
    logPrefix: 'folio-type-packs',
    globRe:    /public[/\\]styles[/\\]type-packs[/\\][^/\\]+\.type-pack\.yaml$/,
    regenFn:   generateTypePackIndex,
  });
}

function folioEffectsPackIndexPlugin(): Plugin {
  return styleIndexPlugin({
    name:      'folio-effects-pack-index',
    logPrefix: 'folio-effects-packs',
    globRe:    /public[/\\]styles[/\\]effects-packs[/\\][^/\\]+\.effects-pack\.yaml$/,
    regenFn:   generateEffectsPackIndex,
  });
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
  plugins: [
    folioCatalogIndexPlugin(),
    folioPaletteIndexPlugin(),
    folioTypePackIndexPlugin(),
    folioEffectsPackIndexPlugin(),
  ],
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
