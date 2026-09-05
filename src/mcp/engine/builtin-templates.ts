import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

/**
 * Bridge the EDITOR's built-in template catalog (the 432 `.template.yaml` files
 * browsed in the Catalog dialog) into the MCP tool surface.
 *
 * The catalog is shipped as static assets the editor fetches over HTTP
 * (`/templates/builtin/*.template.yaml`) plus a metadata index
 * (`src/templates/catalog-index.json`). The MCP server runs in the same
 * container but its path sandbox only allows the projects dir — so without this
 * resolver a model can browse a template in the editor yet cannot inject it.
 *
 * This module locates the asset dir + index server-side so `inject_template` /
 * `list_template_slots` accept a catalog id (`tmpl-1099-form`) or filename, and
 * `list_templates` lets the model discover what's available.
 */

export interface BuiltinTemplateEntry {
  id: string;
  name: string;
  type: string;
  tags: string[];
  width: number;
  height: number;
  slots: number;
  pages: number;
  themeRef?: string;
  file: string;
}

interface CatalogIndexFile { entries?: BuiltinTemplateEntry[] }

let dirCache: string | null | undefined;
let indexCache: BuiltinTemplateEntry[] | undefined;
const probed: string[] = [];

// The catalog ships next to the CODE, so locate it relative to this module and
// not to process.cwd(): a server started from anywhere but the install root
// found neither the asset dir nor the index and `list_templates` answered "0
// templates" forever — a dead op that burns a loop iteration every time an
// agent reasonably tries it. Walk up from src/mcp/engine/ to the install root.
export function installRoots(): string[] {
  const roots = [process.cwd()];
  try {
    // fileURLToPath, not `new URL(…).pathname`: on Windows the raw pathname is
    // "/C:/Users/…", with a leading slash the drive letter cannot survive, so
    // every root derived from it failed to exist and the walk silently did
    // nothing — leaving exactly the "0 templates" dead op it was added to fix,
    // for anyone running the server from anywhere but the install root.
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) { dir = path.dirname(dir); roots.push(dir); }
  } catch { /* no import.meta in this host — cwd only */ }
  return [...new Set(roots)];
}

/** Every path a catalog asset could live at, in priority order. */
function candidatePaths(env: string, ...rel: string[][]): string[] {
  const out = process.env[env] ? [process.env[env] as string] : [];
  for (const root of installRoots()) for (const r of rel) out.push(path.join(root, ...r));
  return out;
}

/** Which paths the last lookup tried — so an empty catalog can say WHY. */
export function probedCatalogPaths(): string[] {
  return probed.slice();
}

/** First existing candidate for the built-in `.template.yaml` asset dir. */
export function builtinTemplatesDir(): string | null {
  if (dirCache !== undefined) return dirCache;
  const candidates = candidatePaths('FOLIO_BUILTIN_TEMPLATES_DIR',
    ['dist', 'templates', 'builtin'], ['public', 'templates', 'builtin']);
  probed.push(...candidates);
  dirCache = candidates.find(c => { try { return fs.statSync(c).isDirectory(); } catch { return false; } }) ?? null;
  return dirCache;
}

/** Metadata index (id → name/tags/file). Empty array if it can't be read. */
export function loadBuiltinIndex(): BuiltinTemplateEntry[] {
  if (indexCache !== undefined) return indexCache;
  const candidates = candidatePaths('FOLIO_BUILTIN_INDEX',
    ['src', 'templates', 'catalog-index.json'],
    ['dist', 'templates', 'catalog-index.json'],
    ['public', 'templates', 'catalog-index.json']);
  probed.push(...candidates);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(c, 'utf8')) as CatalogIndexFile;
      if (Array.isArray(parsed.entries)) { indexCache = parsed.entries; return indexCache; }
    } catch { /* try next candidate */ }
  }
  indexCache = [];
  return indexCache;
}

/**
 * Resolve a catalog id / filename to an absolute path under the built-in asset
 * dir, or null if it isn't a built-in template. Accepts: the catalog id
 * (`tmpl-1099-form`), a `builtin:` prefix, the bare filename
 * (`297-1099-form.template.yaml`), or the id without the `tmpl-` prefix.
 */
export function resolveBuiltinTemplate(idOrFile: string): string | null {
  const dir = builtinTemplatesDir();
  if (!dir) return null;
  // A path with separators is a real filesystem path — let the normal sandbox
  // handle it (don't shadow user paths that happen to share a basename).
  const raw = idOrFile.replace(/^builtin:/, '').trim();
  if (raw.includes('/') || raw.includes('\\')) return null;

  const entries = loadBuiltinIndex();
  let file: string | undefined;
  const byId = entries.find(e => e.id === raw || e.id === `tmpl-${raw}`);
  if (byId) file = byId.file;
  else if (raw.endsWith('.template.yaml') && entries.some(e => e.file === raw)) file = raw;
  // Index missing/stale: still allow a direct filename that physically exists.
  else if (raw.endsWith('.template.yaml')) file = raw;
  if (!file) return null;

  const abs = path.join(dir, path.basename(file));
  return fs.existsSync(abs) ? abs : null;
}

/** Default dir for a design written from a built-in template (sandbox-allowed). */
export function builtinInjectOutputDir(): string {
  return process.env['FOLIO_PROJECTS_DIR'] ?? os.tmpdir();
}

/** Filter the catalog index for the `list_templates` discovery tool. */
export function listBuiltinTemplates(opts: { search?: string; tag?: string; limit?: number } = {}): {
  templates: Array<Pick<BuiltinTemplateEntry, 'id' | 'name' | 'type' | 'tags' | 'width' | 'height' | 'slots' | 'themeRef'>>;
  count: number;
  total: number;
} {
  const all = loadBuiltinIndex();
  const search = opts.search?.trim().toLowerCase();
  const tag = opts.tag?.trim().toLowerCase();
  const filtered = all.filter(e => {
    if (tag && !e.tags.some(t => t.toLowerCase() === tag)) return false;
    if (search) {
      const hay = `${e.id} ${e.name} ${e.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const limit = Math.max(1, Math.min(opts.limit ?? 60, 300));
  const templates = filtered.slice(0, limit).map(e => ({
    id: e.id, name: e.name, type: e.type, tags: e.tags,
    width: e.width, height: e.height, slots: e.slots, themeRef: e.themeRef,
  }));
  return { templates, count: templates.length, total: filtered.length };
}
