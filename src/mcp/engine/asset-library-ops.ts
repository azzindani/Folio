// MCP ops over the shared asset library.
//
// The library is a second STORE, not a second tool surface: the same
// asset_add / asset_list / asset_delete / asset_move ops address it, routed by
// `scope` (for adds and listings) or by the `lib/` prefix on a path (for edits).
// A caller that never mentions the library keeps the old project behaviour.
import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult, NextAction, ProgressItem } from '../types';
import { okResult, errResult, buildContext, buildHandover, pOk, pInfo, pWarn } from './utils';
import {
  assetAdd as projectAssetAdd, assetDelete as projectAssetDelete,
  assetMove as projectAssetMove, collectAssets, requireProject, isErr,
  sanitizeFolder, AssetError, type AssetEntry, type AssetKind,
} from './assets';
import type { ProcessSpec } from './asset-process';
import {
  LIB_PREFIX, ingestLibraryAsset, collectLibraryAssets, libraryFolders,
  deleteLibraryAsset, moveLibraryAsset, isLibraryPath, libraryAbsPath,
  sanitizeFolderPath,
} from './asset-library';
import type { LibraryEntry } from './asset-library-index';

const KINDS: AssetKind[] = ['images', 'icons', 'fonts', 'docs'];

/** Which store an op is addressing. Listings default to both. */
type Scope = 'project' | 'library' | 'both';
function readScope(raw: unknown, fallback: Scope): Scope {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'project' || s === 'library' || s === 'both' ? s : fallback;
}

/** A ready-to-place image layer at the asset's native aspect. */
function layerStub(entry: AssetEntry): Record<string, unknown> {
  const w = entry.width ?? 600, h = entry.height ?? 400;
  const scale = Math.min(1, 600 / Math.max(w, h));
  return { id: entry.id, type: 'image', z: 21, pos: [120, 120, Math.round(w * scale), Math.round(h * scale)], src: entry.path, fit: 'cover' };
}

// ── asset_add ─────────────────────────────────────────────────
export function assetAdd(args: {
  project_path?: string; name?: string; data?: string; source_path?: string;
  kind?: string; folder?: string; alt?: string; scope?: string; process?: ProcessSpec;
}): ToolResult {
  const op = 'asset_add';
  if (readScope(args.scope, 'project') !== 'library') return projectAssetAdd(args);
  if (!args.name) return errResult(op, 'name is required', 'Pass a filename with extension, e.g. name:"power-automate.svg".');
  if (args.source_path) {
    return errResult(op, 'source_path is not accepted for the shared library',
      'Pass the bytes as data:"data:image/…;base64,…" — the library is deliberately not a copy-from-anywhere door.');
  }
  const progress: ProgressItem[] = [];
  try {
    const ingested = ingestLibraryAsset({
      name: args.name,
      ...(args.data ? { dataUri: args.data } : {}),
      ...(args.folder !== undefined ? { folder: args.folder } : {}),
      ...(args.alt ? { alt: args.alt } : {}),
      ...(args.process ? { process: args.process } : {}),
    });
    const { entry, warnings, deduped } = ingested;
    progress.push(deduped
      ? pOk('Already in the library', `${entry.path} — reused, nothing stored twice`)
      : pOk('Stored in the shared library', `${entry.path} (${Math.round(entry.bytes / 1024)} KiB${entry.width ? `, ${entry.width}×${entry.height}` : ''})`));
    for (const w of warnings) progress.push(pWarn('Note', w));
    const stub = layerStub(entry);
    return okResult(op, {
      asset: entry, scope: 'library', deduped, layer_stub: stub,
      next_action: {
        tool: 'add_layers',
        params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] },
        remaining: 0,
        hint: `Reference it as src:"${entry.path}" from ANY project — the shared library resolves the same path everywhere.`,
      } satisfies NextAction,
      progress,
      context: buildContext(op, `Added ${entry.path} to the shared library`),
      handover: buildHandover('COMPOSE', args.project_path ? { project_path: args.project_path } : {}),
    });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Asset ingest failed: ${(e as Error).message}`, 'Check the data: URI and retry.', progress);
  }
}

// ── asset_list ────────────────────────────────────────────────
function matches(row: AssetEntry, args: { search?: string; kind?: string }): boolean {
  if (args.kind && KINDS.includes(args.kind as AssetKind) && row.kind !== args.kind) return false;
  if (!args.search) return true;
  const q = args.search.toLowerCase();
  return row.path.toLowerCase().includes(q) || (row.alt ?? '').toLowerCase().includes(q);
}

export function assetList(args: {
  project_path?: string; search?: string; kind?: string; folder?: string; limit?: number; scope?: string;
}): ToolResult {
  const op = 'asset_list';
  const scope = readScope(args.scope, 'both');
  const proj = scope === 'library' && !args.project_path ? null : requireProject(op, args.project_path);
  if (proj && isErr(proj)) return proj;

  const projectRows = scope === 'library' || !proj ? [] : collectAssets(proj.dir);
  const libraryRows: LibraryEntry[] = scope === 'project' ? [] : collectLibraryAssets();
  const projectFolders = [...new Set(projectRows.map(r => r.folder ?? '').filter(Boolean))].sort();
  const sharedFolders = scope === 'project' ? [] : libraryFolders();

  let rows: AssetEntry[] = [...projectRows, ...libraryRows].filter(r => matches(r, args));
  if (args.folder !== undefined) {
    // A folder filter means different things per store — one segment in a
    // project, a path in the library — so both readings are honoured.
    const flat = sanitizeFolder(args.folder);
    const nested = sanitizeFolderPath(args.folder);
    rows = rows.filter(r => {
      const f = r.folder ?? '';
      return isLibraryPath(r.path) ? f === nested || f.startsWith(`${nested}/`) : f === flat;
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const limit = Math.min(Math.max(1, args.limit ?? 40), 200);
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);

  const nLib = rows.filter(r => isLibraryPath(r.path)).length;
  const progress = [pOk('Assets listed', `${rows.length}${truncated ? '+' : ''} asset(s) — ${rows.length - nLib} in the project, ${nLib} in the shared library`)];
  const credits = rows.map(r => r.provenance?.attribution).filter((s): s is string => Boolean(s));
  return okResult(op, {
    assets: rows, scope, truncated,
    folders: projectFolders, library_folders: sharedFolders,
    hint: rows.length
      ? `Place one with add_layers: {type:"image", src:"<path>", pos:[x,y,w,h], fit:"cover"}. Paths starting "${LIB_PREFIX}" live in the SHARED library and work from any project; "assets/…" paths belong to this project alone. Respect native width/height and put a scrim behind text on "busy" images.`
      : 'Nothing stored yet — fetch from the internet with op:"asset_search" then op:"asset_fetch" (which files into the shared library), or upload via the editor.',
    ...(credits.length ? {
      credits,
      credits_note: 'These assets are licensed on condition of attribution. Put the lines in a small credit strip on the design (6–9px, low-contrast) or the design is not licensed to publish.',
    } : {}),
    progress,
    context: buildContext(op, `${rows.length} asset(s) visible${proj && !isErr(proj) ? ` from ${path.basename(proj.dir)}` : ''}`),
    handover: buildHandover('COMPOSE', args.project_path ? { project_path: args.project_path } : {}),
  });
}

// ── asset_delete / asset_move ─────────────────────────────────
export function assetDelete(args: { project_path?: string; asset_path?: string }): ToolResult {
  const op = 'asset_delete';
  const rel = String(args.asset_path ?? '').replace(/^\/+/, '');
  if (!isLibraryPath(rel)) return projectAssetDelete(args);
  try {
    const { trash } = deleteLibraryAsset(rel);
    return okResult(op, {
      deleted: rel, scope: 'library', trash_path: trash,
      note: 'This asset was SHARED — any design in any project referencing that path now renders a placeholder frame. The file is recoverable from the library .trash.',
      progress: [pOk('Removed from the shared library', rel), pInfo('Recoverable', trash)],
      context: buildContext(op, `Deleted ${rel} from the shared library (soft)`),
      handover: buildHandover('COMPOSE', args.project_path ? { project_path: args.project_path } : {}),
    });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint);
    return errResult(op, `Delete failed: ${(e as Error).message}`, 'Check the path with op:"asset_list", scope:"library".');
  }
}

export function assetMove(args: { project_path?: string; asset_path?: string; folder?: string; new_name?: string }): ToolResult {
  const op = 'asset_move';
  const rel = String(args.asset_path ?? '').replace(/^\/+/, '');
  if (!isLibraryPath(rel)) return projectAssetMove(args);
  try {
    const entry = moveLibraryAsset(rel, {
      ...(args.folder !== undefined ? { folder: args.folder } : {}),
      ...(args.new_name ? { new_name: args.new_name } : {}),
    });
    return okResult(op, {
      moved: { from: rel, to: entry.path }, asset: entry, scope: 'library',
      note: rel === entry.path ? undefined : 'Designs referencing the OLD path now render a placeholder — update their src, or move the file back.',
      progress: [pOk('Moved in the shared library', `${rel} → ${entry.path}`)],
      context: buildContext(op, `Moved ${rel} → ${entry.path}`),
      handover: buildHandover('COMPOSE', args.project_path ? { project_path: args.project_path } : {}),
    });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint);
    return errResult(op, `Move failed: ${(e as Error).message}`, 'Check the path with op:"asset_list", scope:"library".');
  }
}

// ── asset_promote ─────────────────────────────────────────────
/** Rewrite one src across every design in a project. Returns files touched. */
function rewriteDesignSrcs(projectDir: string, from: string, to: string): string[] {
  const dir = path.join(projectDir, 'designs');
  let files: string[];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.design.yaml')); } catch { return []; }
  const touched: string[] = [];
  for (const f of files) {
    const abs = path.join(dir, f);
    try {
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.includes(from)) continue;
      // Textual, not YAML round-trip, on purpose: a design is a hand-tuned
      // document and re-serialising it would reflow every line it did not need
      // to touch. The path is distinctive enough to replace literally.
      fs.writeFileSync(abs, text.split(from).join(to));
      touched.push(f);
    } catch { /* unreadable design — leave it alone rather than half-write */ }
  }
  return touched;
}

/**
 * Hoist a project asset into the shared library, repoint that project's
 * designs at it, and retire the local copy.
 *
 * This is the migration path for everything fetched before the library
 * existed: nothing breaks if it is never run (project paths still resolve),
 * and running it is what removes the duplicate.
 */
export function assetPromote(args: {
  project_path?: string; asset_path?: string; folder?: string; keep_copy?: boolean;
}): ToolResult {
  const op = 'asset_promote';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  const rel = String(args.asset_path ?? '').replace(/^\/+/, '');
  if (!rel || isLibraryPath(rel)) {
    return errResult(op, 'asset_path must be a PROJECT asset', 'Pass a path like "assets/images/logo.svg" — a lib/… path is already in the library.');
  }
  const abs = path.join(proj.dir, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return errResult(op, `Asset not found: ${rel}`, 'manage_design {op:"asset_list"} shows what this project holds.');
  }

  const progress: ProgressItem[] = [];
  try {
    const known = collectAssets(proj.dir).find(r => r.path === rel);
    const ingested = ingestLibraryAsset({
      name: path.basename(rel), data: fs.readFileSync(abs),
      folder: args.folder ?? known?.kind ?? 'images',
      ...(known?.alt ? { alt: known.alt } : {}),
      ...(known?.provenance ? { provenance: known.provenance } : {}),
    });
    const { entry, deduped } = ingested;
    progress.push(deduped
      ? pOk('Already in the library', `${entry.path} — the shared copy was reused`)
      : pOk('Promoted', `${rel} → ${entry.path}`));
    for (const w of ingested.warnings) progress.push(pWarn('Note', w));

    const rewritten = rewriteDesignSrcs(proj.dir, rel, entry.path);
    if (rewritten.length) progress.push(pInfo('Designs repointed', rewritten.join(', ')));

    let trash: string | undefined;
    if (!args.keep_copy) {
      const removal = projectAssetDelete({ project_path: proj.dir, asset_path: rel });
      const data = removal as unknown as { trash_path?: string; success?: boolean };
      if (data.success && data.trash_path) { trash = data.trash_path; progress.push(pInfo('Local copy retired', data.trash_path)); }
    }

    return okResult(op, {
      asset: entry, promoted_from: rel, deduped, designs_updated: rewritten,
      ...(trash ? { trash_path: trash } : {}),
      hint: `Now shared: reference "${entry.path}" from any project. ${rewritten.length ? `${rewritten.length} design(s) in this project were repointed.` : 'No design in this project referenced the old path.'}`,
      progress,
      context: buildContext(op, `Promoted ${rel} → ${entry.path}`),
      handover: buildHandover('COMPOSE', { project_path: proj.dir }),
    });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Promote failed: ${(e as Error).message}`, 'Check the path with op:"asset_list".', progress);
  }
}

export { libraryAbsPath };
