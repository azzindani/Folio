// The asset pack that ships IN the repo — top-level `library/` — seeded into the
// shared library, so a fresh deploy starts with sound effects, music beds and
// marks instead of an empty store.
//
// Everything lands under lib/folio/…, the pack's own subtree. The rules keep the
// operator in charge of what they have:
//   · a pack file the library lacks is copied in;
//   · a pack file that changed upstream replaces the seeded copy ONLY while that
//     copy is untouched (its bytes still hash to what was seeded);
//   · a seeded file the operator deleted is never re-added — the ledger
//     (<library>/.pack/ledger.json, a dot-dir the walker skips) remembers it;
//   · FOLIO_PACK=0 turns seeding off.
// Licences are the pack's own gate (library/LICENSES.md): CC0, public domain,
// OFL, MIT or ISC only — files anyone may redistribute with the repo.
import * as fs from 'fs';
import * as path from 'path';
import { installRoots } from './builtin-templates';
import { libraryRoot, LIB_PREFIX, MAX_FOLDER_DEPTH } from './asset-library';
import { sha256, readLibraryIndex, writeLibraryIndex, type LibraryEntry } from './asset-library-index';
import { sanitizeAssetName, extractAssetMeta } from './assets';
import { probeMedia } from './asset-media';

export const PACK_FOLDER = 'folio';
export const PACK_LICENSES = ['CC0', 'Public domain', 'OFL-1.1', 'MIT', 'ISC'];

export interface PackFile {
  path: string;            // relative to library/, e.g. "sfx/ui/click-soft.mp3"
  license: string;         // one of PACK_LICENSES
  source?: string;         // where the original came from
  page?: string;           // its landing page
  creator?: string;
  title?: string;          // what it is — stored as the alt
  tags?: string[];         // search words beyond the title
  bpm?: number;            // music: measured tempo
  duration_ms?: number;    // sound/clip length, measured when the pack was built — seeding then runs no ffprobe
}

export interface PackManifest { version: number; updated: string; files: PackFile[] }

export interface SeedReport { added: string[]; updated: string[]; kept: string[]; deleted_by_you: string[]; errors: string[] }

/** The repo's library/ directory, or null when this install has none. */
export function packDir(): string | null {
  const env = process.env['FOLIO_PACK_DIR'];
  const roots = env ? [path.resolve(env)] : installRoots().map(r => path.join(r, 'library'));
  return roots.find(d => fs.existsSync(path.join(d, 'manifest.json'))) ?? null;
}

export function readPackManifest(dir: string): PackManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Partial<PackManifest>;
    return Array.isArray(m.files) ? { version: m.version ?? 1, updated: m.updated ?? '', files: m.files } : null;
  } catch { return null; }
}

/** lib/ path a pack file seeds to, or null when its path is not a clean library path. */
export function packLibPath(rel: string): string | null {
  const segs = String(rel ?? '').split('/');
  const name = segs.pop() ?? '';
  const clean = sanitizeAssetName(name);
  if (!clean || clean.name !== name || segs.length + 1 > MAX_FOLDER_DEPTH) return null;
  if (segs.some(s => !/^[a-z0-9][a-z0-9_-]*$/.test(s))) return null;
  return `${LIB_PREFIX}${[PACK_FOLDER, ...segs, name].join('/')}`;
}

function ledgerPath(root: string): string { return path.join(root, '.pack', 'ledger.json'); }

function readLedger(root: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(ledgerPath(root), 'utf8')) as Record<string, string>; } catch { return {}; }
}

/** Temp file + rename: a crash (or a full disk) mid-write never leaves half a file. */
function writeAtomic(file: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** The index row for a seeded file, provenance and all. */
function packEntry(f: PackFile, libPath: string, buf: Buffer, date: string): LibraryEntry {
  const name = libPath.split('/').pop() ?? '';
  const clean = sanitizeAssetName(name);
  const kind = clean?.kind ?? 'images';
  const media = kind === 'audio' || kind === 'video';
  // The manifest's length first: probing is a synchronous ffprobe per file,
  // which on a fresh library held the server for seconds.
  const probed = media && f.duration_ms === undefined ? probeMedia(kind, buf, clean?.ext ?? '') : null;
  const duration = f.duration_ms ?? (probed && 'meta' in probed ? probed.meta.duration_ms : undefined);
  const meta = media ? null : extractAssetMeta(buf, clean?.ext ?? '');
  const folder = libPath.slice(LIB_PREFIX.length).split('/').slice(0, -1).join('/');
  return {
    id: name.replace(/\.[a-z0-9]+$/, ''), path: libPath, kind, folder, bytes: buf.length, sha256: sha256(buf),
    ...(meta?.width ? { width: meta.width, height: meta.height } : {}),
    ...(meta?.dominant_colors ? { dominant_colors: meta.dominant_colors } : {}),
    ...(meta?.luminance ? { luminance: meta.luminance } : {}),
    ...(duration !== undefined ? { duration_ms: duration } : {}),
    ...(f.title ? { alt: f.title } : {}),
    added: date,
    provenance: {
      source: 'folio-pack', url: f.source ?? `library/${f.path}`, license: f.license, fetched: date,
      ...(f.page ? { page: f.page } : {}), ...(f.creator ? { creator: f.creator } : {}),
    },
  };
}

/**
 * Copy the pack into the shared library by the rules at the top of this file.
 * Idempotent: a second run with nothing changed writes nothing.
 */
export function seedPack(opts: { dir?: string; root?: string } = {}): SeedReport {
  const report: SeedReport = { added: [], updated: [], kept: [], deleted_by_you: [], errors: [] };
  if (process.env['FOLIO_PACK'] === '0') return report;
  const dir = opts.dir ?? packDir();
  const manifest = dir ? readPackManifest(dir) : null;
  if (!dir || !manifest) return report;
  const root = opts.root ?? libraryRoot();
  const ledger = readLedger(root);
  const date = manifest.updated || (new Date().toISOString().split('T')[0] ?? '');
  const rows: LibraryEntry[] = [];
  let ledgerChanged = false;
  for (const f of manifest.files) {
    const libPath = packLibPath(f.path);
    if (!libPath) { report.errors.push(`${f.path}: not a clean library path`); continue; }
    if (!PACK_LICENSES.includes(f.license)) { report.errors.push(`${f.path}: licence "${f.license}" is not one the pack may ship`); continue; }
    let buf: Buffer;
    try { buf = fs.readFileSync(path.join(dir, ...f.path.split('/'))); } catch { report.errors.push(`${f.path}: listed but missing from library/`); continue; }
    const hash = sha256(buf);
    const dest = path.join(root, ...libPath.slice(LIB_PREFIX.length).split('/'));
    const seeded = ledger[libPath];
    let have: string | null = null;
    try { have = sha256(fs.readFileSync(dest)); } catch { have = null; }
    if (have === null && seeded) { report.deleted_by_you.push(libPath); continue; }
    if (have === hash) {
      report.kept.push(libPath);
      // Same bytes but no ledger record (ledger lost, or placed by hand): adopt
      // it, so a later pack update can still replace it.
      if (seeded !== hash) { ledger[libPath] = hash; ledgerChanged = true; rows.push(packEntry(f, libPath, buf, date)); }
      continue;
    }
    if (have !== null && have !== seeded) { report.kept.push(libPath); continue; }   // the operator's edit wins
    writeAtomic(dest, buf);
    ledger[libPath] = hash;
    ledgerChanged = true;
    rows.push(packEntry(f, libPath, buf, date));
    (have === null ? report.added : report.updated).push(libPath);
  }
  if (rows.length) {
    const byPath = new Map(readLibraryIndex(root).map(e => [e.path, e]));
    for (const r of rows) {
      const sources = byPath.get(r.path)?.sources;
      byPath.set(r.path, sources ? { ...r, sources } : r);
    }
    writeLibraryIndex(root, [...byPath.values()]);
  }
  if (ledgerChanged) writeAtomic(ledgerPath(root), `${JSON.stringify(ledger, null, 2)}\n`);
  return report;
}

/**
 * One pack file, asked for by name (asset_fetch ref "pack:<path>"): its library
 * entry, copied in first when the library lacks it. An explicit ask outranks the
 * ledger — a file the operator deleted comes back when they fetch it again.
 */
export function ensurePackFile(rel: string, opts: { dir?: string; root?: string } = {}): LibraryEntry | null {
  const dir = opts.dir ?? packDir();
  const f = dir ? readPackManifest(dir)?.files.find(x => x.path === rel) : undefined;
  const libPath = packLibPath(rel);
  if (!dir || !f || !libPath || !PACK_LICENSES.includes(f.license)) return null;
  const root = opts.root ?? libraryRoot();
  const known = readLibraryIndex(root).find(e => e.path === libPath);
  const dest = path.join(root, ...libPath.slice(LIB_PREFIX.length).split('/'));
  if (known && fs.existsSync(dest)) return known;
  const buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
  if (!fs.existsSync(dest)) writeAtomic(dest, buf);
  const entry = packEntry(f, libPath, fs.readFileSync(dest), readPackManifest(dir)?.updated || (new Date().toISOString().split('T')[0] ?? ''));
  writeLibraryIndex(root, [...readLibraryIndex(root).filter(e => e.path !== libPath), entry]);
  const ledger = readLedger(root);
  ledger[libPath] = sha256(buf);
  writeAtomic(ledgerPath(root), `${JSON.stringify(ledger, null, 2)}\n`);
  return entry;
}

/** One line for the server log. */
export function describeSeed(r: SeedReport): string {
  const parts = [`${r.added.length} added`, `${r.updated.length} updated`, `${r.kept.length} kept`];
  if (r.deleted_by_you.length) parts.push(`${r.deleted_by_you.length} you deleted (not re-added)`);
  if (r.errors.length) parts.push(`${r.errors.length} skipped: ${r.errors.slice(0, 3).join('; ')}`);
  return parts.join(', ');
}
