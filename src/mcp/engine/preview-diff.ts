// Which pages actually changed since the last look.
//
// render_preview renders ONE page per call, so checking an 8-page deck after an
// edit costs eight calls and eight images — and review §3.1 measured that as the
// single biggest line in the session ("~20 of them because diagnose cannot be
// trusted", up to ~660k estimated tokens in one response). Most of those pages
// were identical to the previous look and the model paid to re-see them.
//
// So keep a fingerprint of each page's RENDERED SVG beside the design. The next
// check re-renders (cheap — it is the raster that costs, not the vector) and
// only rasterises pages whose fingerprint moved.
//
// The SVG is the right thing to hash, not the YAML: it is what the eye will
// actually receive, so a spec edit that renders identically correctly reads as
// "nothing to look at", and a theme or asset change that never touched the
// design's own bytes correctly reads as changed.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface PreviewBaseline { version: 1; pages: Record<string, string> }

/** Beside the design's other tool state, never inside the design itself. */
export function baselinePath(designPath: string): string {
  const dir = path.join(path.dirname(designPath), '.mcp_versions');
  const name = path.basename(designPath).replace(/\.design\.yaml$/i, '');
  return path.join(dir, `${name}.preview.json`);
}

export function hashSVG(svg: string): string {
  return crypto.createHash('sha1').update(svg).digest('hex').slice(0, 16);
}

/** Missing or unreadable baseline is not an error — it means "never looked". */
export function readBaseline(designPath: string): PreviewBaseline {
  try {
    const raw = JSON.parse(fs.readFileSync(baselinePath(designPath), 'utf8')) as PreviewBaseline;
    if (raw?.version === 1 && raw.pages && typeof raw.pages === 'object') return raw;
  } catch { /* never looked, or the file was hand-edited — treat as fresh */ }
  return { version: 1, pages: {} };
}

/** Best-effort: a design that cannot store a baseline still previews fine, it
 *  just cannot skip anything next time. Never fail a preview over bookkeeping. */
export function writeBaseline(designPath: string, pages: Record<string, string>): boolean {
  try {
    const p = baselinePath(designPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: 1, pages }, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

export interface PageDiff { id: string; index: number; changed: boolean; first_look: boolean }

/**
 * Classify each page against the baseline. A page with no recorded hash is a
 * FIRST LOOK, not a change — the distinction matters because the first
 * changed_only call would otherwise report an 8-page deck as "8 pages changed"
 * and teach the caller the mode does nothing.
 */
export function diffPages(
  baseline: PreviewBaseline, rendered: Array<{ id: string; svg: string }>,
): { diffs: PageDiff[]; next: Record<string, string> } {
  const next: Record<string, string> = {};
  const diffs = rendered.map((p, index) => {
    const hash = hashSVG(p.svg);
    next[p.id] = hash;
    const known = baseline.pages[p.id];
    return { id: p.id, index, changed: known !== undefined && known !== hash, first_look: known === undefined };
  });
  return { diffs, next };
}
