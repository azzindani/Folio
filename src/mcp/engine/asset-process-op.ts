/**
 * `manage_design(op:asset_process)` — run the pixel pipeline on an asset that
 * is already stored, writing the result as a NEW asset.
 *
 * `asset_add` can process on the way in, but most edits happen after the fact:
 * the photo is in the library, the design is half built, and only now is it
 * clear the picture needs to be darker behind the headline, square-cropped,
 * or cut out. Non-destructive by construction — the source is never touched,
 * and the derived file gets its own manifest entry with the recipe recorded,
 * so the same edit can be re-run or undone by deleting the derivative.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult, ProgressItem, NextAction } from '../types';
import { okResult, errResult, pOk, pWarn, buildContext } from './utils';
import { ingestAsset, requireProject, isErr, AssetError, type AssetEntry } from './assets';
import { ingestLibraryAsset, isLibraryPath, libraryAbsPath } from './asset-library';
import { processAsset, hasWork, ProcessError, PROCESS_KEYS, type ProcessSpec } from './asset-process';
import { isPNG } from '../../utils/png-codec';

type Args = {
  project_path?: string;
  /** Source: "assets/images/x.png" in this project, or "lib/…" in the shared library. */
  asset_path?: string;
  process?: ProcessSpec;
  /** Output filename (png). Default: `<stem>-edit.png`, uniquified. */
  name?: string;
  folder?: string;
  alt?: string;
  /** Where the derivative goes: same store as the source unless said otherwise. */
  scope?: string;
};

/** Absolute path of a stored asset, or null when it is outside both stores. */
function sourceAbs(projectDir: string, rel: string): string | null {
  if (isLibraryPath(rel)) return libraryAbsPath(rel);
  const clean = rel.replace(/^\.?\//, '');
  if (!clean.startsWith('assets/') || clean.includes('..')) return null;
  return path.join(projectDir, clean);
}

function freeProjectName(dir: string, name: string): string {
  const ext = name.match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}

function layerStub(entry: AssetEntry): Record<string, unknown> {
  const w = entry.width ?? 600, h = entry.height ?? 400;
  const scale = Math.min(1, 600 / Math.max(w, h));
  return { id: entry.id, type: 'image', z: 21, pos: [120, 120, Math.round(w * scale), Math.round(h * scale)], src: entry.path, fit: 'cover' };
}

export function assetProcess(args: Args): ToolResult {
  const op = 'asset_process';
  const proj = requireProject(op, args.project_path);
  if (isErr(proj)) return proj;
  if (!args.asset_path) return errResult(op, 'asset_path is required', 'Pass the path asset_list returned, e.g. "assets/images/hero.png" or "lib/photos/hero.png".');
  if (!hasWork(args.process)) {
    return errResult(op, 'process is empty — nothing to do.',
      `Pass a recipe, e.g. process:{adjust:{saturation:0, contrast:20}, crop:{aspect:"1:1"}, vignette:0.4}. Keys: ${PROCESS_KEYS.join(', ')}.`);
  }

  const abs = sourceAbs(proj.dir, args.asset_path);
  if (!abs || !fs.existsSync(abs)) return errResult(op, `Asset not found: ${args.asset_path}`, 'Run manage_design(op:asset_list) to see real paths.');
  const src = fs.readFileSync(abs);
  if (!isPNG(src)) {
    return errResult(op, `Pixel processing needs a PNG; "${args.asset_path}" is not one.`,
      'Re-add the source as PNG (asset_add) — JPEG/WebP decoding is not available in-process yet.');
  }

  const progress: ProgressItem[] = [];
  let processed: { buffer: Buffer; notes: string[] };
  try {
    processed = processAsset(src, 'png', args.process);
  } catch (e) {
    if (e instanceof ProcessError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Processing failed: ${(e as Error).message}`, 'Check the recipe values.', progress);
  }
  for (const n of processed.notes) progress.push(pOk('Applied', n));

  const stem = path.basename(args.asset_path).replace(/\.[a-z0-9]+$/i, '');
  const wantName = (args.name ?? `${stem}-edit.png`).replace(/\.[a-z0-9]+$/i, '') + '.png';
  const toLibrary = args.scope ? String(args.scope).toLowerCase() === 'library' : isLibraryPath(args.asset_path);
  const recipe = JSON.stringify(args.process);

  try {
    if (toLibrary) {
      const { entry, warnings, deduped } = ingestLibraryAsset({
        name: wantName, data: processed.buffer,
        ...(args.folder !== undefined ? { folder: args.folder } : {}),
        alt: args.alt ?? `${stem} (processed: ${processed.notes.join('; ')})`,
        source: `process:${args.asset_path}:${recipe}`,
      });
      for (const w of warnings) progress.push(pWarn('Note', w));
      progress.push(pOk(deduped ? 'Identical result already in the library' : 'Stored in the shared library', entry.path));
      const stub = layerStub(entry as unknown as AssetEntry);
      return okResult(op, {
        source: args.asset_path, asset: entry, scope: 'library', recipe: args.process, layer_stub: stub,
        next_action: { tool: 'add_layers', params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] }, remaining: 0,
          hint: `Reference it as src:"${entry.path}". The source is untouched — delete this derivative to undo.` } satisfies NextAction,
        progress, context: buildContext(op, `Processed ${args.asset_path} → ${entry.path}`),
      });
    }

    const kindDir = path.join(proj.dir, 'assets', 'images', ...(args.folder ? [args.folder] : []));
    fs.mkdirSync(kindDir, { recursive: true });
    const name = freeProjectName(kindDir, wantName);
    const { entry, warnings } = ingestAsset({
      projectDir: proj.dir, name, data: processed.buffer, kind: 'images',
      ...(args.folder !== undefined ? { folder: args.folder } : {}),
      alt: args.alt ?? `${stem} (processed: ${processed.notes.join('; ')})`,
    });
    for (const w of warnings) progress.push(pWarn('Note', w));
    progress.push(pOk('Stored', `${entry.path} (${Math.round(entry.bytes / 1024)} KiB${entry.width ? `, ${entry.width}×${entry.height}` : ''})`));
    const stub = layerStub(entry);
    return okResult(op, {
      source: args.asset_path, asset: entry, scope: 'project', recipe: args.process, layer_stub: stub,
      next_action: { tool: 'add_layers', params: { design_path: '<your .design.yaml>', layers_shorthand: [stub] }, remaining: 0,
        hint: `Reference it as src:"${entry.path}". The source is untouched — asset_delete this derivative to undo.` } satisfies NextAction,
      progress, context: buildContext(op, `Processed ${args.asset_path} → ${entry.path}`),
    });
  } catch (e) {
    if (e instanceof AssetError) return errResult(op, e.message, e.hint, progress);
    return errResult(op, `Store failed: ${(e as Error).message}`, 'Check the project has write access.', progress);
  }
}
