// How a cached thumbnail is NAMED, and what happens to those names when the
// folder underneath them moves.
//
// A thumb file is `<project>__<file>.<renderer fingerprint>.png` in
// <projects>/.library/thumbs/ — a flat directory, so the project name is baked
// into the filename rather than expressed as a real subdirectory. That makes a
// folder rename or delete invisible to the cache: the files keep pointing at a
// project that no longer exists under that name.
//
// Found live: 81 of 371 thumbnails on the deployed box belonged to projects
// that had been binned. library-gallery already had a pruner, but it prunes ONE
// design's older renderer generations — nothing ever pruned by PROJECT, because
// the folder ops that delete and rename projects never called anything at all.
// The capability was there; the door was not. Renaming is the worse half: every
// thumb is stranded under the old prefix AND re-rendered under the new one,
// though a rename changes no design's content.
//
// The naming rule lives here, apart from library-gallery, so library-folders can
// use it without importing the renderer — that module is deliberately pure fs +
// YAML so the editor's static server can call it directly.

import * as fs from 'fs';
import * as path from 'path';

/** Filename-safe form of a project or file name. */
export const thumbSlug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);

/** Every thumbnail belonging to `project` starts with this. */
export const projectThumbPrefix = (project: string): string => `${thumbSlug(project)}__`;

/** Everything in a thumb name before the renderer fingerprint. */
export const thumbPrefix = (designPath: string): string =>
  `${projectThumbPrefix(path.basename(path.dirname(path.dirname(designPath))))}${thumbSlug(path.basename(designPath))}.`;

const thumbsIn = (root: string): string => path.join(root, '.library', 'thumbs');

const listThumbs = (dir: string): string[] => {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.png')); } catch { return []; }
};

/**
 * Drop every thumbnail belonging to `project`. Returns how many went.
 *
 * Best effort, like the per-design pruner: a thumbnail that survives costs disk
 * and nothing else, and one that is removed early is simply re-rendered. Called
 * when a project is deleted, so its cache does not outlive it.
 */
export function pruneProjectThumbs(root: string, project: string): number {
  const dir = thumbsIn(root);
  const pre = projectThumbPrefix(project);
  let gone = 0;
  for (const f of listThumbs(dir)) {
    if (!f.startsWith(pre)) continue;
    try { fs.rmSync(path.join(dir, f), { force: true }); gone++; } catch { /* leave it */ }
  }
  return gone;
}

/**
 * Carry a project's thumbnails across a rename. Returns how many moved.
 *
 * A rename changes no design's bytes, so every thumbnail is still correct —
 * only its name is wrong. Moving them keeps the cache warm and, more to the
 * point, stops the old set from being stranded where nothing will ask for it
 * again. A name already taken at the destination is left alone: that thumb is
 * either identical or newer, and neither is worth clobbering.
 */
export function renameProjectThumbs(root: string, oldName: string, newName: string): number {
  const dir = thumbsIn(root);
  const from = projectThumbPrefix(oldName), to = projectThumbPrefix(newName);
  if (from === to) return 0;
  let moved = 0;
  for (const f of listThumbs(dir)) {
    if (!f.startsWith(from)) continue;
    const dst = path.join(dir, to + f.slice(from.length));
    try {
      if (fs.existsSync(dst)) { fs.rmSync(path.join(dir, f), { force: true }); continue; }
      fs.renameSync(path.join(dir, f), dst); moved++;
    } catch { /* leave it */ }
  }
  return moved;
}
