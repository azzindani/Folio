// THE shared asset library — one store, every project.
//
// Assets used to live only inside a project (<project>/assets/…), so the same
// Microsoft logo was downloaded again for every deck that wanted it and no two
// copies knew about each other. This is the store that fixes that: a plain
// nested file tree at <projects>/.library/assets, addressed from designs as
//   src: "lib/microsoft/logos/power-automate.svg"
//
// Deliberately NOT kind-first. `assets/images/microsoft/…` is the engine's
// filing system; `lib/microsoft/logos/…` is the operator's. Kind is derived
// from the extension and kept as metadata for filtering, not spent as a path
// segment. Folders nest properly (unlike the project store's one-segment rule)
// because that is what makes this usable as a file manager.
//
// Projects still win: the resolver searches the project first, so a project can
// shadow a library file with its own copy at the same path.
import * as fs from 'fs';
import * as path from 'path';
import {
  sanitizeAssetName, extractAssetMeta, extForMime, maxAssetBytes, AssetError,
  type AssetProvenance,
} from './assets';
import { processAsset, hasWork, ProcessError, type ProcessSpec } from './asset-process';
import {
  sha256, findByHash, findBySource, upsertLibraryEntry, removeLibraryEntry,
  readLibraryIndex, type LibraryEntry,
} from './asset-library-index';

/** The prefix that marks a src as living in the shared library. */
export const LIB_PREFIX = 'lib/';

/** Folder nesting cap. Deep enough to file by vendor/kind, shallow enough that
 *  every path check stays a one-liner. */
export const MAX_FOLDER_DEPTH = 4;

/** Own quota — the library must not eat a project's 256 MiB allowance. */
export function maxLibraryBytes(): number {
  return parseInt(process.env['FOLIO_MAX_LIBRARY_BYTES'] ?? '', 10) || 1024 * 1024 * 1024;
}

function projectsRoot(): string {
  return path.resolve(process.env['FOLIO_PROJECTS_DIR'] ?? 'folio-projects');
}

/**
 * Absolute path of the library tree. Dot-prefixed so the project scanner
 * (which skips dot-dirs) never lists it as a project, and so the editor's
 * /__project_files mount can already serve it with no route change.
 */
export function libraryRoot(): string {
  const override = process.env['FOLIO_LIBRARY_DIR'];
  return override ? path.resolve(override) : path.join(projectsRoot(), '.library', 'assets');
}

/** One path segment, sanitized like a folder name. '' when nothing survives. */
function cleanSegment(seg: string): string {
  const s = String(seg ?? '').trim();
  if (!s || s === '.' || s === '..') return '';
  return s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40);
}

/**
 * A nested library folder: "Microsoft / Logos" → "microsoft/logos".
 *
 * The project store's sanitizeFolder() keeps only the first segment on purpose;
 * here the whole point is the tree, so segments are kept — bounded by depth,
 * with traversal segments dropped rather than rejected (a stray "../" in a
 * model-written folder name should file the asset, not fail the call).
 */
export function sanitizeFolderPath(folder?: string): string {
  return String(folder ?? '')
    .split('/')
    .map(cleanSegment)
    .filter(Boolean)
    .slice(0, MAX_FOLDER_DEPTH)
    .join('/');
}

/** True for a src that addresses the shared library. */
export function isLibraryPath(src: string): boolean {
  return String(src ?? '').trimStart().startsWith(LIB_PREFIX);
}

/**
 * "lib/microsoft/logos/foo.svg" → { folder, name }, or null when the path is
 * malformed or tries to escape. Used for both resolution and op validation.
 */
export function parseLibPath(src: string): { folder: string; name: string } | null {
  const raw = String(src ?? '').trim().replace(/^\/+/, '');
  if (!raw.startsWith(LIB_PREFIX)) return null;
  const parts = raw.slice(LIB_PREFIX.length).split('/').filter(Boolean);
  const name = parts.pop() ?? '';
  if (!name || !sanitizeAssetName(name)) return null;
  if (parts.some(p => p === '.' || p === '..' || p !== cleanSegment(p))) return null;
  if (parts.length > MAX_FOLDER_DEPTH) return null;
  return { folder: parts.join('/'), name };
}

/** Absolute on-disk path for a `lib/…` src, or null if it is not a safe one. */
export function libraryAbsPath(src: string): string | null {
  const parsed = parseLibPath(src);
  if (!parsed) return null;
  const root = libraryRoot();
  const abs = path.resolve(root, parsed.folder, parsed.name);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/** Total bytes stored in the library (quota check). */
export function libraryTotalBytes(): number {
  let total = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name !== 'index.json') {
        try { total += fs.statSync(p).size; } catch { /* gone mid-walk */ }
      }
    }
  };
  walk(libraryRoot());
  return total;
}

/** Every folder in the tree, deepest paths included, sorted. */
export function libraryFolders(): string[] {
  const root = libraryRoot();
  const out: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_FOLDER_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const next = rel ? `${rel}/${e.name}` : e.name;
      out.push(next);
      walk(path.join(dir, e.name), next, depth + 1);
    }
  };
  walk(root, '', 1);
  return out.sort();
}

/**
 * Everything in the library. The TREE is the truth — a file copied in over SSH
 * shows up here even though the index never saw it; the index only supplies the
 * metadata (dimensions, colours, provenance) that the bytes alone can't say.
 */
export function collectLibraryAssets(): LibraryEntry[] {
  const root = libraryRoot();
  const indexed = new Map(readLibraryIndex(root).map(e => [e.path, e]));
  const out: LibraryEntry[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth <= MAX_FOLDER_DEPTH && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
        continue;
      }
      if (!e.isFile() || e.name === 'index.json') continue;
      const clean = sanitizeAssetName(e.name);
      if (!clean) continue;
      const libPath = `${LIB_PREFIX}${rel ? `${rel}/` : ''}${e.name}`;
      const known = indexed.get(libPath);
      if (known) { out.push(known); continue; }
      // Unknown file — describe it now so it is usable immediately, and record
      // it so the next call is a plain index read.
      try {
        const abs = path.join(dir, e.name);
        const buf = fs.readFileSync(abs);
        const meta = extractAssetMeta(buf, clean.ext);
        const entry: LibraryEntry = {
          id: clean.name.replace(/\.[a-z0-9]+$/, ''), path: libPath, kind: clean.kind,
          ...(rel ? { folder: rel } : {}), bytes: buf.length, sha256: sha256(buf),
          ...(meta.width ? { width: meta.width, height: meta.height } : {}),
          ...(meta.dominant_colors ? { dominant_colors: meta.dominant_colors } : {}),
          ...(meta.luminance ? { luminance: meta.luminance } : {}),
          added: fs.statSync(abs).mtime.toISOString().split('T')[0] ?? '',
        };
        out.push(upsertLibraryEntry(root, entry));
      } catch { /* unreadable — skip rather than fail the whole listing */ }
    }
  };
  walk(root, '', 1);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Ingest ────────────────────────────────────────────────────
export interface LibraryIngestArgs {
  name: string;
  data?: Buffer;
  dataUri?: string;
  folder?: string;
  alt?: string;
  process?: ProcessSpec;
  provenance?: AssetProvenance;
  /** ref/url these bytes came from — indexed so the same fetch skips the network. */
  source?: string;
}

/** SVG is markup the editor will execute — same strip the project store does. */
function stripSvgScripts(buf: Buffer, ext: string, warnings: string[]): Buffer {
  if (ext !== 'svg') return buf;
  const text = buf.toString('utf8');
  if (!/<script[\s>]/i.test(text) && !/\bon[a-z]+\s*=/i.test(text)) return buf;
  warnings.push('svg contained script/event handlers — stripped');
  return Buffer.from(
    text.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''),
    'utf8',
  );
}

/** First free name at this path — a shared file is never silently overwritten. */
function freeName(dir: string, name: string): string {
  const ext = name.match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}

/**
 * Store bytes in the shared library.
 *
 * Dedupe comes FIRST: identical bytes already present are reused in place, and
 * the caller's ref is recorded against them, so the next project that wants
 * this asset neither downloads nor stores a second copy. That is the whole
 * reason this store exists.
 */
export function ingestLibraryAsset(args: LibraryIngestArgs): { entry: LibraryEntry; warnings: string[]; deduped: boolean } {
  const warnings: string[] = [];
  let clean = sanitizeAssetName(args.name);
  if (!clean) {
    throw new AssetError(`Unsupported asset name/type: "${args.name}"`, 415,
      'Give the file a name with a supported extension, e.g. name:"power-automate.svg".');
  }

  let buf: Buffer;
  if (args.data) {
    buf = args.data;
  } else if (args.dataUri) {
    const m = args.dataUri.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (!m) throw new AssetError('data is not a valid data: URI', 400, 'Pass data:"data:image/png;base64,…".');
    buf = m[2] ? Buffer.from(m[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(m[3] ?? ''), 'utf8');
    const mimeExt = extForMime(m[1] ?? '');
    if (mimeExt && mimeExt !== clean.ext) {
      const renamed = sanitizeAssetName(clean.name.replace(/\.[a-z0-9]+$/, `.${mimeExt}`));
      if (renamed) {
        warnings.push(`extension .${clean.ext} did not match ${m[1]} — saved as .${mimeExt}`);
        clean = renamed;
      }
    }
  } else {
    throw new AssetError('No asset bytes given', 400, 'Pass data (data: URI) or fetch the asset with op:"asset_fetch".');
  }

  if (buf.length === 0) throw new AssetError('Asset is empty (0 bytes)', 400, 'Check the data: URI payload.');
  if (buf.length > maxAssetBytes()) {
    throw new AssetError(`Asset too large: ${Math.round(buf.length / 1024)} KiB > ${Math.round(maxAssetBytes() / 1024)} KiB cap`, 413,
      'Downscale/compress the file, or raise FOLIO_MAX_ASSET_BYTES.');
  }
  buf = stripSvgScripts(buf, clean.ext, warnings);
  if (hasWork(args.process)) {
    try {
      const processed = processAsset(buf, clean.ext, args.process);
      buf = processed.buffer;
      warnings.push(...processed.notes);
    } catch (e) {
      if (e instanceof ProcessError) throw new AssetError(e.message, 422, e.hint);
      throw e;
    }
  }

  const root = libraryRoot();
  const hash = sha256(buf);
  const hit = findByHash(root, hash);
  const hitAbs = hit ? libraryAbsPath(hit.path) : null;
  if (hit && hitAbs && fs.existsSync(hitAbs)) {
    warnings.push(`identical bytes already in the library at ${hit.path} — reused, nothing stored twice`);
    return { entry: upsertLibraryEntry(root, hit, args.source), warnings, deduped: true };
  }

  const total = libraryTotalBytes();
  if (total + buf.length > maxLibraryBytes()) {
    throw new AssetError('Shared library quota exceeded', 413,
      `Library holds ${Math.round(total / 1024 / 1024)} MiB; cap is ${Math.round(maxLibraryBytes() / 1024 / 1024)} MiB (FOLIO_MAX_LIBRARY_BYTES). Delete unused assets first.`);
  }

  const folder = sanitizeFolderPath(args.folder);
  const dir = path.join(root, ...(folder ? folder.split('/') : []));
  fs.mkdirSync(dir, { recursive: true });
  // Different bytes, same name: keep both. Overwriting here would change what
  // renders in every OTHER project that already points at this path.
  const name = freeName(dir, clean.name);
  if (name !== clean.name) warnings.push(`${clean.name} already exists with different content — stored as ${name}`);
  fs.writeFileSync(path.join(dir, name), buf);

  const meta = extractAssetMeta(buf, clean.ext);
  const entry: LibraryEntry = {
    id: name.replace(/\.[a-z0-9]+$/, ''),
    path: `${LIB_PREFIX}${folder ? `${folder}/` : ''}${name}`,
    kind: clean.kind, ...(folder ? { folder } : {}),
    bytes: buf.length, sha256: hash,
    ...(meta.width ? { width: meta.width, height: meta.height } : {}),
    ...(meta.dominant_colors ? { dominant_colors: meta.dominant_colors } : {}),
    ...(meta.luminance ? { luminance: meta.luminance } : {}),
    ...(args.alt ? { alt: String(args.alt).slice(0, 300) } : {}),
    added: new Date().toISOString().split('T')[0] ?? '',
    ...(args.provenance ? { provenance: args.provenance } : {}),
  };
  return { entry: upsertLibraryEntry(root, entry, args.source), warnings, deduped: false };
}

/** Library entry previously fetched from this ref/url — the no-network path. */
export function libraryBySource(ref: string): LibraryEntry | undefined {
  const hit = findBySource(libraryRoot(), ref);
  if (!hit) return undefined;
  const abs = libraryAbsPath(hit.path);
  return abs && fs.existsSync(abs) ? hit : undefined;
}

// ── Mutation ──────────────────────────────────────────────────
/**
 * Soft-delete: the file moves to <library>/.trash. Deleting from a SHARED store
 * can blank a design in a project nobody is looking at, so nothing here is ever
 * an unrecoverable unlink.
 */
export function deleteLibraryAsset(libPath: string): { trash: string } {
  const abs = libraryAbsPath(libPath);
  if (!abs || !fs.existsSync(abs)) throw new AssetError(`Not in the library: ${libPath}`, 404, 'op:"asset_list" with scope:"library" shows the exact paths.');
  const trashDir = path.join(libraryRoot(), '.trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${Date.now()}_${path.basename(abs)}`);
  fs.renameSync(abs, dest);
  removeLibraryEntry(libraryRoot(), libPath);
  return { trash: dest };
}

/** Move and/or rename within the library, keeping the index in step. */
export function moveLibraryAsset(libPath: string, opts: { folder?: string; new_name?: string }): LibraryEntry {
  const root = libraryRoot();
  const from = libraryAbsPath(libPath);
  const parsed = parseLibPath(libPath);
  if (!from || !parsed || !fs.existsSync(from)) {
    throw new AssetError(`Not in the library: ${libPath}`, 404, 'op:"asset_list" with scope:"library" shows the exact paths.');
  }
  const wantName = opts.new_name ? sanitizeAssetName(opts.new_name) : null;
  if (opts.new_name && !wantName) {
    throw new AssetError(`Unsupported name: "${opts.new_name}"`, 415, 'Keep a supported extension, e.g. new_name:"power-automate.svg".');
  }
  const folder = opts.folder === undefined ? parsed.folder : sanitizeFolderPath(opts.folder);
  const dir = path.join(root, ...(folder ? folder.split('/') : []));
  fs.mkdirSync(dir, { recursive: true });
  const name = freeName(dir, wantName?.name ?? parsed.name);
  const to = path.join(dir, name);
  if (to === from) {
    const current = readLibraryIndex(root).find(r => r.path === libPath);
    if (current) return current;
  }
  fs.renameSync(from, to);
  const rows = readLibraryIndex(root);
  const prior = rows.find(r => r.path === libPath);
  const newPath = `${LIB_PREFIX}${folder ? `${folder}/` : ''}${name}`;
  const base: LibraryEntry = prior ?? {
    id: name.replace(/\.[a-z0-9]+$/, ''), path: newPath, kind: (sanitizeAssetName(name)?.kind ?? 'images'),
    bytes: fs.statSync(to).size, sha256: sha256(fs.readFileSync(to)),
    added: new Date().toISOString().split('T')[0] ?? '',
  };
  removeLibraryEntry(root, libPath);
  const moved: LibraryEntry = { ...base, path: newPath, id: name.replace(/\.[a-z0-9]+$/, ''), ...(folder ? { folder } : {}) };
  if (!folder) delete moved.folder;
  return upsertLibraryEntry(root, moved);
}

