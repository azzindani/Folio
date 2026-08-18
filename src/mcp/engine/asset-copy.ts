// Copying an asset — the half of cut/copy/paste that move cannot do.
//
// Deliberately cross-store and cross-project: the reason to copy rather than
// move is almost always "I want this in the other project too", or "promote my
// project's mark into the shared library without losing my own copy". A copy
// that only worked inside one folder would answer no real question.
//
// The bytes go back through the normal ingest, so a copied file is validated,
// re-measured and manifested exactly like an upload. Nothing is special-cased
// about having arrived from another folder.
import * as fs from 'fs';
import * as path from 'path';
import { ingestAsset, parseAssetPath, sanitizeFolder } from './assets';
import { ingestLibraryAsset, libraryAbsPath, parseLibPath, sanitizeFolderPath } from './asset-library';

export interface CopyResult {
  success: boolean;
  path?: string;
  /** True when the destination already held this name and it was replaced. */
  replaced?: boolean;
  error?: string;
  hint?: string;
}

/** Absolute path of a stored asset, whichever store it lives in. */
function sourceAbs(assetPath: string, fromDir?: string): string | null {
  if (assetPath.startsWith('lib/')) {
    return parseLibPath(assetPath) ? libraryAbsPath(assetPath) : null;
  }
  if (!fromDir) return null;
  // parseAssetPath refuses traversal and anything the store could not have
  // written, so the join below cannot leave the project.
  return parseAssetPath(assetPath) ? path.join(fromDir, assetPath) : null;
}

/**
 * Copy one asset into a project folder or into the shared library.
 *
 * `fromDir` is the project the asset currently lives in — which is not
 * necessarily the destination, and is ignored entirely for a `lib/` source.
 */
export function copyAsset(args: {
  assetPath?: string;
  fromDir?: string;
  toDir?: string;
  folder?: string;
  scope?: 'project' | 'library';
}): CopyResult {
  const assetPath = String(args.assetPath ?? '');
  const abs = sourceAbs(assetPath, args.fromDir);
  if (!abs || !fs.existsSync(abs)) {
    return { success: false, error: `No such asset: ${assetPath || '(none)'}` };
  }

  let data: Buffer;
  try { data = fs.readFileSync(abs); } catch (e) { return { success: false, error: (e as Error).message }; }
  const name = path.basename(abs);

  try {
    if (args.scope === 'library') {
      const { entry } = ingestLibraryAsset({
        name, data, folder: sanitizeFolderPath(args.folder),
      });
      return { success: true, path: entry.path };
    }
    if (!args.toDir) return { success: false, error: 'No destination project' };
    const dest = path.join(args.toDir, 'assets');
    const already = fs.existsSync(path.join(dest, 'images', sanitizeFolder(args.folder), name));
    const { entry } = ingestAsset({
      projectDir: args.toDir, name, data,
      folder: sanitizeFolder(args.folder) || undefined,
    });
    // Copying a file onto itself is a no-op the caller should know about, not
    // an error — pasting into the folder you copied from is an easy slip.
    if (entry.path === assetPath && args.fromDir === args.toDir) {
      return { success: true, path: entry.path, replaced: true };
    }
    return { success: true, path: entry.path, ...(already ? { replaced: true } : {}) };
  } catch (e) {
    const err = e as { message?: string; hint?: string; status?: number };
    return { success: false, error: err.message ?? 'Copy failed', ...(err.hint ? { hint: err.hint } : {}) };
  }
}
