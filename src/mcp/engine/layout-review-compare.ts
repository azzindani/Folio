// review:true remembers — so a revision can PROVE it improved.
//
// A model revises (edit_layer move/scale, patch_spec) and then has to judge
// whether the page got better. Without a baseline that meant another preview
// image and a guess. Each review now keeps its numbers beside the design, and
// the next review answers `since_last`: how the painted share, the largest
// empty area and the off-centre weight moved, and which notes were resolved or
// appeared. Numbers only; whether the change was the right one stays the
// model's call (§0.4).

import * as fs from 'fs';
import * as path from 'path';
import type { PageLayout } from './layout-review';
import type { MotionReview } from './layout-review-motion';

type Reviewed = PageLayout & { motion?: MotionReview };

export interface Snapshot { ink: number; occupied: number; empty_max: number; weight_off: number; kinds: string[] }
interface Memory { version: 1; pages: Record<string, Snapshot> }

export interface Delta { ink: number; occupied: number; empty_max: number; weight_off: number; resolved: string[]; new: string[] }

const r2 = (v: number): number => Math.round(v * 100) / 100;

export function memoryPath(designPath: string): string {
  const name = path.basename(designPath).replace(/\.design\.yaml$/i, '');
  return path.join(path.dirname(designPath), '.mcp_versions', `${name}.review.json`);
}

/** What a note is ABOUT — its numbers change with every edit, its kind does not. */
export function noteKind(note: string): string | null {
  const big = /^"([^"]+)" \([^)]+\) covers/.exec(note);
  if (big) return `oversized:${big[1] ?? ''}`;
  const wide = /^"([^"]+)" \([^)]+\) runs edge to edge/.exec(note);
  if (wide) return `edge_to_edge:${wide[1] ?? ''}`;
  const cut = /^"([^"]+)" \([^)]+\) is cut by the canvas edge/.exec(note);
  if (cut) return `cut_by_edge:${cut[1] ?? ''}`;
  if (/one empty area/.test(note)) return 'empty_area';
  if (/(left|right) of centre/.test(note)) return 'weight_across';
  if (/(above|below) centre/.test(note)) return 'weight_down';
  if (/^Content spans/.test(note)) return 'narrow_content';
  if (/never hold still/.test(note)) return 'never_still';
  if (/framed at the same size/.test(note)) return 'same_framing';
  return null;
}

export function snapshotOf(p: Reviewed): Snapshot {
  const kinds = [
    ...[...p.notes, ...(p.motion?.notes ?? [])].map(noteKind),
    ...(p.motion?.shots ?? []).flatMap(s => s.notes.map(n => { const k = noteKind(n); return k ? `${s.shot}/${k}` : null; })),
  ].filter((k): k is string => !!k);
  const b = p.balance?.offset;
  return {
    ink: p.ink, occupied: p.occupied, empty_max: p.empty[0]?.share ?? 0,
    weight_off: b ? r2(Math.hypot(b.x, b.y)) : 0,
    kinds: [...new Set(kinds)].sort(),
  };
}

export function compareSnapshots(before: Snapshot, now: Snapshot): Delta {
  return {
    ink: r2(now.ink - before.ink), occupied: r2(now.occupied - before.occupied),
    empty_max: r2(now.empty_max - before.empty_max), weight_off: r2(now.weight_off - before.weight_off),
    resolved: before.kinds.filter(k => !now.kinds.includes(k)),
    new: now.kinds.filter(k => !before.kinds.includes(k)),
  };
}

function read(file: string): Memory {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Memory>;
    return m.version === 1 && m.pages && typeof m.pages === 'object' ? { version: 1, pages: m.pages } : { version: 1, pages: {} };
  } catch { return { version: 1, pages: {} }; }
}

/**
 * Compare this review with the last one, then keep this one. Pages reviewed
 * now replace their entry; pages not reviewed now keep theirs. Returns the
 * deltas for pages seen before, or null on a first review.
 */
export function rememberReview(designPath: string, review: Reviewed[]): Record<string, Delta> | null {
  const file = memoryPath(designPath);
  const memory = read(file);
  const out: Record<string, Delta> = {};
  for (const p of review) {
    const key = p.page ?? 'page';
    const now = snapshotOf(p);
    const before = memory.pages[key];
    if (before) out[key] = compareSnapshots(before, now);
    memory.pages[key] = now;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(memory)}\n`);
    fs.renameSync(tmp, file);
  } catch { /* a baseline that cannot be kept only costs the next comparison */ }
  return Object.keys(out).length ? out : null;
}
