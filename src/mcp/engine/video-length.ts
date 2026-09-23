// How long a video layer plays, written into the design.
//
// Scene length, op:frame, the export's frame count and the lint all read time
// from the spec alone (pure, browser-safe). A clip placed without
// `video.duration_ms` gave them nothing to read: a page whose only movement
// was footage reported "nothing is animated" and exported as one still (found
// live, 2026-09-23). So when a design is written, a video layer without one
// gets the rest of its file after `offset_ms` — the part it will play — read
// from the stored clip. The number is in the YAML, where the model can see
// and change it.

import * as fs from 'fs';
import * as path from 'path';
import { resolveAssetFile } from './asset-resolve';
import { probeVideo } from './asset-video';

const lengths = new Map<string, number | null>();

function fileLength(file: string): number | null {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const key = `${file}|${mtime}`;
  const hit = lengths.get(key);
  if (hit !== undefined) return hit;
  const p = probeVideo(file);
  const ms = p && p !== 'not-video' ? p.duration_ms : null;
  lengths.set(key, ms);
  return ms;
}

type Node = { type?: string; src?: string; layers?: Node[]; video?: { offset_ms?: number; duration_ms?: number } };

/** Give every video layer that lacks one a `video.duration_ms`. Mutates `data`. */
export function stampVideoLengths(data: unknown, designPath: string): void {
  if (!data || typeof data !== 'object') return;
  const spec = data as { layers?: Node[]; pages?: Array<{ layers?: Node[] }> };
  const project = path.dirname(path.dirname(designPath));
  const visit = (ls: Node[] | undefined): void => {
    for (const l of ls ?? []) {
      if (Array.isArray(l.layers)) visit(l.layers);
      if (l.type !== 'video' || typeof l.src !== 'string' || !l.src.trim() || typeof l.video?.duration_ms === 'number') continue;
      const file = resolveAssetFile(l.src, designPath, project);
      const len = file ? fileLength(file) : null;
      if (!len) continue;
      const offset = Math.max(0, Number(l.video?.offset_ms) || 0);
      l.video = { ...(l.video ?? {}), duration_ms: Math.max(1, len - offset) };
    }
  };
  visit(spec.layers);
  for (const p of spec.pages ?? []) visit(p.layers);
}
