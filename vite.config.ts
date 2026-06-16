import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import * as fs from 'fs';
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

/**
 * Serve the bundled raster fonts (src/mcp/fonts/*.ttf + manifest.json) at
 * `/fonts/…` so the editor's VECTOR pdf export can fetch the real TTF bytes and
 * embed them in jsPDF — the same files the MCP server uses, so an editor PDF
 * matches an MCP PDF. Dev: a middleware streams them from src. Build: the files
 * are copied into dist/fonts so `vite preview` and the production static-server
 * (which both serve dist/) deliver them with no extra route. The browser
 * fetches percent-encoded names; we decode + guard against traversal.
 */
function folioFontsPlugin(): Plugin {
  const FONTS_DIR = resolve(__dirname, 'src/mcp/fonts');
  const send = (url: string | undefined, res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: unknown): void }): boolean => {
    const m = /^\/fonts\/([^/?#]+)/.exec(url ?? '');
    if (!m) return false;
    const name = decodeURIComponent(m[1]);
    const file = resolve(FONTS_DIR, name);
    if (name.includes('/') || name.includes('..') || !file.startsWith(FONTS_DIR) || !fs.existsSync(file)) {
      res.statusCode = 404; res.end('Not found'); return true;
    }
    res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'font/ttf');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(fs.readFileSync(file));
    return true;
  };
  const middleware = (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: unknown): void }, next: () => void): void => {
    if (!send(req.url, res)) next();
  };
  return {
    name: 'folio-fonts',
    // Dev (vite) and preview (vite preview — used by the e2e CI job) both stream
    // fonts from src via this middleware, so the percent-encoded bracketed
    // filenames decode the same way regardless of the static handler.
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
    writeBundle() {
      const out = resolve(__dirname, 'dist/fonts');
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(FONTS_DIR)) {
        if (f.endsWith('.ttf') || f === 'manifest.json') fs.copyFileSync(resolve(FONTS_DIR, f), resolve(out, f));
      }
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
  plugins: [
    folioCatalogIndexPlugin(),
    folioPaletteIndexPlugin(),
    folioTypePackIndexPlugin(),
    folioEffectsPackIndexPlugin(),
    folioFontsPlugin(),
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
