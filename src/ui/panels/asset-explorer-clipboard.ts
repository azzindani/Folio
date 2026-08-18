// Asset explorer — cut / copy / paste.
//
// Modelled on the desktop behaviour people already know:
//   cut   → marked, dimmed, and MOVED on paste; the mark clears afterwards
//   copy  → duplicated on paste, and stays on the clipboard for repeat pastes
//
// The clipboard remembers which PROJECT and which STORE the items came from,
// because pasting into a different project is the main reason to use it — an
// asset copied out of one project and into another is the whole point.
import type { AssetIO, Scope } from './asset-explorer-io';

export interface Clip {
  mode: 'cut' | 'copy';
  /** Project the items were taken from — the paste target may differ. */
  project: string | null;
  scope: Scope;
  /** Asset paths. Folders are not carried: a folder move is a different
   *  operation (it rebuilds a tree) and belongs to drag or Move-to. */
  paths: string[];
}

export interface PasteTarget {
  io: AssetIO;
  /** Destination folder inside the destination store. */
  folder: string;
  scope: Scope;
}

export interface PasteReport {
  moved: number;
  copied: number;
  failures: string[];
}

let clip: Clip | null = null;

export function setClip(next: Clip | null): void {
  clip = next && next.paths.length ? next : null;
}

export function getClip(): Clip | null {
  return clip;
}

/** Is this path marked for a cut? Used to dim the row it is sitting in. */
export function isCut(path: string): boolean {
  return clip?.mode === 'cut' && clip.paths.includes(path);
}

export function clipSummary(): string {
  if (!clip) return '';
  const n = clip.paths.length;
  return `${n} ${n === 1 ? 'item' : 'items'} ${clip.mode === 'cut' ? 'cut' : 'copied'}`;
}

/**
 * Paste the clipboard into a destination.
 *
 * A cut ACROSS stores or projects cannot be a server-side move — the move op
 * only relocates within one store — so it is done as copy-then-delete, which
 * is what the desktop does too. Copy is always copy.
 */
export async function paste(target: PasteTarget): Promise<PasteReport | null> {
  const current = clip;
  if (!current) return null;

  const sameStore = current.scope === target.scope;
  const sameProject = current.project === target.io.projectName;
  const report: PasteReport = { moved: 0, copied: 0, failures: [] };

  for (const path of current.paths) {
    const name = path.split('/').pop() ?? path;

    if (current.mode === 'cut' && sameStore && sameProject) {
      const res = await target.io.manage({ op: 'move', asset_path: path, folder: target.folder });
      if (res.ok) report.moved++; else report.failures.push(`${name}: ${res.error ?? 'move failed'}`);
      continue;
    }

    const copied = await target.io.manage({
      op: 'copy',
      asset_path: path,
      folder: target.folder,
      scope: target.scope,
      ...(current.project && !sameProject ? { from_project: current.project } : {}),
    });
    if (!copied.ok) { report.failures.push(`${name}: ${copied.error ?? 'copy failed'}`); continue; }

    if (current.mode === 'copy') { report.copied++; continue; }
    // Cut across a boundary: only remove the original once the copy landed, so
    // a failed paste can never lose the file. The delete is addressed to the
    // SOURCE project — sending it to the destination would delete the copy that
    // was just made and leave the original sitting where it was.
    const removed = await target.io.manageIn(current.project, { op: 'delete', asset_path: path });
    if (removed.ok) report.moved++;
    else report.failures.push(`${name}: copied, but the original could not be removed`);
  }

  // A cut is consumed by its paste; a copy stays, so it can be pasted again.
  if (current.mode === 'cut' && !report.failures.length) clip = null;
  return report;
}
