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
import { sanitizeFolder, removeManifestEntry, MAX_PROJECT_FOLDER_DEPTH, type AssetKind } from './assets';
import { libraryRoot, sanitizeFolderPath } from './asset-library';

const KINDS: AssetKind[] = ['images', 'icons', 'fonts', 'docs'];

export interface FolderOpResult {
  success: boolean;
  folder?: string;
  /** Files moved to .trash by a folder delete. */
  trashed?: number;
  error?: string;
  hint?: string;
}

/**
 * Every folder under a project's assets/, at any depth, INCLUDING empty ones.
 *
 * Folder paths are reported relative to the kind dir and merged across kinds:
 * "brand" under images and under fonts is ONE folder to the person filing
 * things, and the kinds are an implementation detail of where bytes land.
 */
export function projectFolders(projectDir: string): string[] {
  const out = new Set<string>();
  for (const kind of KINDS) {
    const walk = (dir: string, rel: string, depth: number): void => {
      if (depth > MAX_PROJECT_FOLDER_DEPTH) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        // Dot-dirs are bookkeeping (.trash), not filing — the library listing
        // skips them for the same reason.
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const seg = sanitizeFolder(e.name);
        if (!seg || seg !== e.name) continue;
        const next = rel ? `${rel}/${seg}` : seg;
        out.add(next);
        walk(path.join(dir, e.name), next, depth + 1);
      }
    };
    walk(path.join(projectDir, 'assets', kind), '', 1);
  }
  return [...out].sort();
}

/**
 * Create an empty folder.
 *
 * Project scope creates it under every kind, so dropping a font and a
 * screenshot into "brand" files both without asking which store they belong
 * to — the panel shows one folder, the disk keeps the kinds apart. Nests, so
 * "clients/acme/logos" is one call.
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
      hint: `Letters, numbers, dashes and spaces, nesting up to ${MAX_PROJECT_FOLDER_DEPTH} levels with "/".`,
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

/** Everything inside a directory tree, as absolute paths. */
function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(abs, out);
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Delete a folder and everything in it.
 *
 * Contents go to .trash, exactly as a per-file delete does, which is what makes
 * deleting a folder safe enough to just do. An earlier version refused any
 * folder that was not empty — technically cautious, and useless: a folder you
 * have to empty by hand before you can remove it is a folder you cannot remove.
 *
 * `requireEmpty` keeps the old behaviour for callers that want to be sure.
 */
export function removeAssetFolder(args: {
  projectDir?: string;
  folder?: string;
  scope?: 'project' | 'library';
  requireEmpty?: boolean;
}): FolderOpResult {
  const wantLibrary = args.scope === 'library';
  const folder = wantLibrary ? sanitizeFolderPath(args.folder) : sanitizeFolder(args.folder);
  if (!folder) return { success: false, error: 'No folder given' };

  const trashRoot = wantLibrary
    ? path.join(libraryRoot(), '.trash')
    : args.projectDir ? path.join(args.projectDir, '.trash') : '';
  const dirs = wantLibrary
    ? [path.join(libraryRoot(), folder)]
    : args.projectDir
      ? KINDS.map(k => path.join(args.projectDir as string, 'assets', k, folder))
      : [];
  if (!dirs.length || !trashRoot) return { success: false, error: 'No project' };

  const held = dirs.flatMap(d => filesUnder(d));
  if (args.requireEmpty && held.length) {
    return {
      success: false,
      error: `"${folder}" still holds ${held.length} item${held.length === 1 ? '' : 's'}`,
      hint: 'Move or delete what is inside it first.',
    };
  }
  if (!dirs.some(d => fs.existsSync(d))) {
    return { success: false, error: `No such folder: "${folder}"` };
  }

  try {
    if (held.length) {
      fs.mkdirSync(trashRoot, { recursive: true });
      // Stamped so two deletes of the same filename cannot collide, and the
      // folder name is kept so what came from where is still legible in .trash.
      const stamp = Date.now();
      const leaf = folder.split('/').pop() ?? folder;
      for (const abs of held) {
        fs.renameSync(abs, path.join(trashRoot, `${stamp}_${leaf}_${path.basename(abs)}`));
        // The manifest is what the listing merges over the disk, so leaving the
        // entry behind keeps the folder AND its files on screen after the files
        // are gone — a ghost folder holding files that no longer exist.
        if (!wantLibrary && args.projectDir) {
          removeManifestEntry(args.projectDir, path.relative(args.projectDir, abs).split(path.sep).join('/'));
        }
      }
    }
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    return { success: true, folder, trashed: held.length };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
