// What produced the file, not just what went into it.
//
// export-receipt keys a finished export on (design bytes, format, scale,
// destination) and calls that "the whole claim". It is one term short. An
// export is a pure function of those four AND THE CODE THAT RENDERS THEM, so
// the moment a renderer fix lands, every design already exported keeps being
// served from a cache that believes it is current — silently, for good, with
// no way for the caller to know the file is stale.
//
// Found live: a `noise` fill was fixed so it finally paints, the fix deployed
// and verified on a NEW design, and the design that had exposed the bug in the
// first place re-exported to byte-identical output, still carrying the dead
// filter, because it had been exported once before the fix.
//
// So fold in a fingerprint of the rendering code itself. Hashing the sources is
// what makes this maintenance-free: there is no version constant to remember to
// bump, and therefore no way to forget. A renderer edit invalidates the caches
// exactly once per design, which costs one re-render; the alternative costs a
// wrong file forever.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** Directories whose code decides what an exported file contains. */
const RENDER_DIRS = ['renderer', 'export', 'engine'] as const;

/** Returned when the sources cannot be read. Behaves exactly as before this
 *  module existed: one constant term, so the key still varies only by design.
 *  Degrading to the old behaviour is right — refusing to export is not. */
const UNKNOWN = 'src-unavailable';

function srcRoot(): string | null {
  const candidates: string[] = [];
  try {
    // This file is src/mcp/engine/render-fingerprint.ts → up two for src/.
    candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  } catch { /* import.meta.url is not a file: URL under every runner */ }
  candidates.push(path.resolve(process.cwd(), 'src'));
  for (const c of candidates) {
    if (RENDER_DIRS.every(d => { try { return fs.statSync(path.join(c, d)).isDirectory(); } catch { return false; } })) return c;
  }
  return null;
}

/** Every non-test .ts under one directory, sorted, relative to `root`. */
function sourcesUnder(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(path.relative(root, full));
    }
  };
  walk(path.join(root, dir));
  return out.sort();
}

/**
 * A hash of the code that turns a spec into bytes: the renderer, the exporters,
 * and the engine passes they call. The dependency versions go in too — resvg
 * and the PDF writer put pixels on the page as surely as our own code does, so
 * a bumped rasteriser must invalidate a cached PNG.
 *
 * Paths are hashed alongside contents, so moving a file counts as a change even
 * when nothing in it did.
 *
 * Takes its root explicitly: WHERE the sources are is environment-dependent and
 * has to be discovered, but hashing them is a pure function, and keeping the two
 * apart is what lets the hashing be tested against a tree built for the purpose.
 */
export function fingerprintOf(root: string | null): string {
  if (!root) return UNKNOWN;
  const h = crypto.createHash('sha256');
  let files = 0;
  for (const dir of RENDER_DIRS) {
    for (const rel of sourcesUnder(root, dir)) {
      let body: Buffer;
      try { body = fs.readFileSync(path.join(root, rel)); } catch { continue; }
      h.update(rel).update('\0').update(body).update('\0');
      files++;
    }
  }
  // No readable sources → say so rather than returning the hash of nothing,
  // which is a real-looking constant that would never change again.
  if (files === 0) return UNKNOWN;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    h.update(JSON.stringify(pkg.dependencies ?? {}));
  } catch { /* no manifest — our own sources still fingerprint fine */ }
  return h.digest('hex').slice(0, 16);
}

let memo: string | null = null;

/** Memoised: the sources cannot change under a running process without a
 *  restart, and every export would otherwise re-read ~470KB to learn nothing. */
export function renderFingerprint(): string {
  if (memo === null) memo = fingerprintOf(srcRoot());
  return memo;
}

/** Testing seam — drop the memo so a test can fingerprint a tree it just wrote. */
export function resetRenderFingerprint(): void {
  memo = null;
}
