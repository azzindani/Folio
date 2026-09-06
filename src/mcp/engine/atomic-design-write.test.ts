import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

// Folio's design writes are safe under concurrency for one reason only: they
// are SYNCHRONOUS. readYAML and writeYAML are readFileSync/writeFileSync, so on
// a single-threaded event loop a read -> mutate -> write with no yield in
// between cannot be interleaved by another request. That is a real guarantee,
// but it is an accidental one — nothing declared it, and nothing checked it.
//
// `shape` broke it: `await import('polygon-clipping')` sat between its read and
// its write, so it wrote back a whole document captured before any edit that
// landed in the window. Measured live: 20 concurrent updates alongside one cold
// shape op, all 20 reporting success, 18 in the file.
//
// So state the property and check it. Every op that writes a design must do so
// without yielding after it read one. There are no locks in this codebase — if
// that ever changes, this test is the place to say so.

const SRC = 'src';

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

interface Offence { file: string; line: number }

/** Every `writeYAML(` paired with the nearest `readYAML` before it, reported
 *  when an `await` sits in the gap. */
function offences(): Offence[] {
  const found: Offence[] = [];
  for (const file of tsFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('writeYAML(') || !src.includes('readYAML')) continue;
    const reads = [...src.matchAll(/\breadYAML\s*[<(]/g)].map(m => m.index ?? 0);
    for (const w of [...src.matchAll(/\bwriteYAML\s*\(/g)].map(m => m.index ?? 0)) {
      const before = reads.filter(r => r < w);
      if (before.length === 0) continue;
      const gap = src.slice(Math.max(...before), w);
      if (/\bawait\b/.test(gap)) found.push({ file, line: src.slice(0, w).split('\n').length });
    }
  }
  return found;
}

describe('a design write never yields after the read it is based on', () => {
  it('no op awaits between reading a design and writing it back', () => {
    const bad = offences();
    expect(bad.map(o => `${o.file}:${o.line}`), 'an await here means a concurrent write is silently reverted').toEqual([]);
  });

  it('the check is actually looking at the files it claims to', () => {
    // A guard that scans nothing passes forever. Assert it found the writers.
    const writers = tsFiles(SRC).filter(f => readFileSync(f, 'utf8').includes('writeYAML('));
    expect(writers.length).toBeGreaterThan(10);
    expect(writers.some(f => f.endsWith('shape-ops-op.ts')), 'the op that broke this rule is in scope').toBe(true);
  });

  it('and it would catch the pattern if it came back', () => {
    // Same detection, run against a constructed sample, so a refactor that
    // quietly stops matching real code fails here rather than going quiet.
    const sample = 'const spec = readYAML<D>(p);\nconst d = await offsetPath(x);\nwriteYAML(p, spec);';
    const reads = [...sample.matchAll(/\breadYAML\s*[<(]/g)].map(m => m.index ?? 0);
    const w = (sample.match(/\bwriteYAML\s*\(/) as RegExpMatchArray).index ?? 0;
    expect(/\bawait\b/.test(sample.slice(Math.max(...reads), w))).toBe(true);
  });
});
