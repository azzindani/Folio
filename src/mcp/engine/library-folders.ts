// Design Library — FOLDER ops (the directory half of the file-manager).
// A "folder" is a Folio project directory directly under the projects root
// (<root>/<folder>/designs/*.design.yaml). Folio scans designs/ NON-recursively,
// so folders are a single level — they don't nest. These give the library basic
// filesystem actions over folders: create, rename, delete (to a recoverable
// root-level .trash). Pure fs + YAML — no rendering, no engine.ts import, so the
// editor's static server can call them directly.

import * as fs from 'fs';
import * as path from 'path';
import { readYAML, writeYAML } from './utils';
import { pruneProjectThumbs, renameProjectThumbs } from './thumb-names';

export interface FolderResult { success: boolean; error?: string; project?: string; path?: string; trashed_path?: string }

// Dot-prefixed dirs are library internals (.library / .trash) — never folders.
const RESERVED = new Set(['.trash', '.library', 'node_modules']);

/** Validate + normalise a single path segment: letters / digits / space / dash /
 *  underscore / dot (not leading), no separators or traversal. Null if invalid. */
export function safeFolderName(name: string): string | null {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 80) return null;
  if (n === '.' || n === '..' || n.startsWith('.')) return null;
  if (n.includes('/') || n.includes('\\') || n.includes('\0')) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(n)) return null;
  return n;
}

/** Create an empty folder (a minimal Folio project: dirs + project.yaml). */
export function createFolder(root: string, name: string): FolderResult {
  const n = safeFolderName(name);
  if (!n) return { success: false, error: 'Invalid folder name (letters, digits, spaces, dash, underscore)' };
  const dir = path.join(root, n);
  if (fs.existsSync(dir)) return { success: false, error: 'A folder with that name already exists' };
  try {
    for (const d of ['designs', 'themes', 'components', 'templates', 'assets']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    writeYAML(path.join(dir, 'project.yaml'), {
      _protocol: 'project/v1',
      meta: { id: 'fld_' + Date.now().toString(36), name: n, version: '1.0.0', created: today, modified: today },
      config: { default_canvas: '1080x1080', default_export_format: 'png' },
      designs: [], assets: { fonts: [], images: [] }, exports: [],
    });
    return { success: true, project: n, path: dir };
  } catch (e) { return { success: false, error: (e as Error).message }; }
}

/** Rename a folder (and its project.yaml meta.name). Designs move with it — the
 *  SSE hub re-syncs their cards under the new folder on its next tick. */
export function renameFolder(root: string, name: string, newName: string): FolderResult {
  const o = safeFolderName(name), n = safeFolderName(newName);
  if (!o || !n) return { success: false, error: 'Invalid folder name' };
  if (RESERVED.has(o)) return { success: false, error: 'That folder is reserved and cannot be renamed' };
  const src = path.join(root, o), dst = path.join(root, n);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return { success: false, error: 'Folder not found' };
  if (o === n) return { success: false, error: 'Same name' };
  if (fs.existsSync(dst)) return { success: false, error: 'A folder with that name already exists' };
  try {
    fs.renameSync(src, dst);
    const py = path.join(dst, 'project.yaml');
    if (fs.existsSync(py)) {
      try {
        const spec = readYAML<{ meta?: Record<string, unknown> }>(py);
        spec.meta = { ...spec.meta, name: n, modified: new Date().toISOString() };
        writeYAML(py, spec);
      } catch { /* leave meta.name stale rather than fail the rename */ }
    }
    // Thumbnails carry the project name in their FILEname, so they do not move
    // with the directory. Carry them across: the designs are unchanged, so every
    // cached thumb is still correct — only its name is wrong.
    renameProjectThumbs(root, o, n);
    return { success: true, project: n, path: dst };
  } catch (e) { return { success: false, error: (e as Error).message }; }
}

/** Soft-delete a folder: move the whole dir to <root>/.trash/ (recoverable). The
 *  SSE hub emits remove for every design inside on its next tick. */
export function deleteFolder(root: string, name: string): FolderResult {
  const n = safeFolderName(name);
  if (!n) return { success: false, error: 'Invalid folder name' };
  if (RESERVED.has(n)) return { success: false, error: 'That folder is reserved and cannot be deleted' };
  const src = path.join(root, n);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return { success: false, error: 'Folder not found' };
  const trash = path.join(root, '.trash');
  try { fs.mkdirSync(trash, { recursive: true }); } catch (e) { return { success: false, error: (e as Error).message }; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(trash, `${stamp}__${n}`);
  try {
    fs.renameSync(src, dest);
    // The project is gone from the library, so nothing will ever ask for its
    // thumbnails again — drop them rather than leave them on disk forever. (The
    // designs themselves stay recoverable in .trash; a thumbnail is derived, and
    // re-renders on demand if the folder is restored.)
    pruneProjectThumbs(root, n);
    return { success: true, project: n, trashed_path: dest };
  } catch (e) { return { success: false, error: (e as Error).message }; }
}
