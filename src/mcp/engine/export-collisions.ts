// What an export is about to REPLACE, and what a previous export left behind.
//
// Review §1.3 is about four charts collapsing into one file: "silent data loss.
// I only noticed because I listed the directory." Folio does not have that bug —
// its default name varies by design AND format, and re-exporting a design to the
// same path on purpose is idempotence, not loss. It has the neighbouring one.
//
// A carousel writes `<base>-p1..-pN`. Export a 7-page deck, then export anything
// else to the same base, and pages 1-7 stay on disk beside the new file. The
// reply lists what it wrote and says nothing about the seven orphans, so a
// directory listing shows an 8-file export of which one file is current — a
// stale page read as a real one is the same failure with a slower fuse.
//
// The answer here is disclosure, not deletion: these are files on the operator's
// disk that merely match a pattern, and a tool that silently removes neighbours
// it did not create is a worse bug than the one it fixes.
import * as fs from 'fs';
import * as path from 'path';

/** Was something already at this exact path before we wrote? */
export function willOverwrite(outPath: string): boolean {
  try { return fs.statSync(outPath).isFile(); } catch { return false; }
}

/**
 * Page files left by an EARLIER export at this base that this one does not
 * rewrite. `pagesWritten` is 0 for a single-file export, in which case every
 * `-pN` sibling is stale by definition.
 */
export function stalePageSiblings(outPath: string, pagesWritten: number): string[] {
  const dir = path.dirname(outPath);
  const ext = path.extname(outPath);
  const stem = path.basename(outPath, ext);
  if (!stem || !ext) return [];
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-p(\\d+)${ext.replace('.', '\\.')}$`, 'i');
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const stale: Array<{ n: number; p: string }> = [];
  for (const name of names) {
    const m = re.exec(name);
    if (!m?.[1]) continue;
    const n = parseInt(m[1], 10);
    if (n > pagesWritten) stale.push({ n, p: path.join(dir, name) });
  }
  return stale.sort((a, b) => a.n - b.n).map(s => s.p);
}

/** The reply fields for both, ready to spread. Empty when there is nothing to say. */
export function collisionReport(outPath: string, pagesWritten: number, existedBefore: boolean): {
  overwrote?: true; stale_siblings?: string[]; stale_note?: string;
} {
  const stale = stalePageSiblings(outPath, pagesWritten);
  return {
    ...(existedBefore ? { overwrote: true as const } : {}),
    ...(stale.length ? {
      stale_siblings: stale,
      stale_note: `${stale.length} page file(s) from an EARLIER export sit beside this one and were NOT rewritten — `
        + `they belong to whatever was exported to this path before. Anything listing this directory will read them `
        + `as part of this export. Delete them, or export to a path of its own.`,
    } : {}),
  };
}
