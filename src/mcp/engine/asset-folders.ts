// Folder-level operations on the asset stores.
//
// collectAssets() derives folders from the FILES it finds, so a folder with
// nothing in it does not exist as far as the listing is concerned. A file
// manager needs the opposite: you make the folder first, then put things in
// it. These functions read and write the directories themselves.
//
// Lives beside assets.ts rather than inside it because that file is at its
// 700-line ceiling — and because folders are a distinct concern from ingest.
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeFolder, type AssetKind } from './assets';
import { libraryRoot, sanitizeFolderPath } from './asset-library';

const KINDS: AssetKind[] = ['images', 'icons', 'fonts', 'docs'];

export interface FolderOpResult {
  success: boolean;
  folder?: string;
  error?: string;
  hint?: string;
}

/**
 * Every folder under a project's assets/, INCLUDING the empty ones.
 *
 * The project store is one level deep (see sanitizeFolder), so a folder name
 * is unique across kinds — "screenshots" under images and under docs is one
 * chip in the panel, which is what an author means by a folder.
 */
export function projectFolders(projectDir: string): string[] {
  const out = new Set<string>();
  for (const kind of KINDS) {
    const dir = path.join(projectDir, 'assets', kind);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      // Dot-dirs are bookkeeping (.trash), not filing — the library listing
      // skips them for the same reason.
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const clean = sanitizeFolder(e.name);
      if (clean && clean === e.name) out.add(clean);
    }
  }
  return [...out].sort();
}

/**
 * Create an empty folder.
 *
 * Project scope creates it under every kind, so dropping a font and a
 * screenshot into "brand" files both without asking which store they belong
 * to — the panel shows one folder, the disk keeps the kinds apart.
 */
export function createAssetFolder(args: {
  projectDir?: string;
  folder?: string;
  scope?: 'project' | 'library';
}): FolderOpResult {
  const wantLibrary = args.scope === 'library';
  const folder = wantLibrary ? sanitizeFolderPath(args.folder) : sanitizeFolder(args.folder);
  if (!folder) {
    return {
      success: false,
      error: `Not a usable folder name: "${String(args.folder ?? '')}"`,
      hint: wantLibrary
        ? 'Letters, numbers, dashes and up to 4 levels of "/".'
        : 'Letters, numbers, dashes and spaces. The project store is one level deep.',
    };
  }
  try {
    if (wantLibrary) {
      fs.mkdirSync(path.join(libraryRoot(), folder), { recursive: true });
    } else {
      if (!args.projectDir) return { success: false, error: 'No project' };
      for (const kind of KINDS) {
        fs.mkdirSync(path.join(args.projectDir, 'assets', kind, folder), { recursive: true });
      }
    }
    return { success: true, folder };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Remove a folder, but only when it holds no files.
 *
 * Refusing a non-empty folder is deliberate: delete-a-folder-full-of-work is
 * the one file-manager action with no undo here, and the per-file delete route
 * already moves things to .trash where a recursive rmdir would not.
 */
export function removeAssetFolder(args: {
  projectDir?: string;
  folder?: string;
  scope?: 'project' | 'library';
}): FolderOpResult {
  const wantLibrary = args.scope === 'library';
  const folder = wantLibrary ? sanitizeFolderPath(args.folder) : sanitizeFolder(args.folder);
  if (!folder) return { success: false, error: 'No folder given' };

  const dirs = wantLibrary
    ? [path.join(libraryRoot(), folder)]
    : args.projectDir
      ? KINDS.map(k => path.join(args.projectDir as string, 'assets', k, folder))
      : [];
  if (!dirs.length) return { success: false, error: 'No project' };

  const held: string[] = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (!e.name.startsWith('.')) held.push(e.name);
  }
  if (held.length) {
    return {
      success: false,
      error: `"${folder}" still holds ${held.length} item${held.length === 1 ? '' : 's'}`,
      hint: 'Move or delete what is inside it first.',
    };
  }
  try {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    return { success: true, folder };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
