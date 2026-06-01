#!/usr/bin/env node
// Re-classify an existing results.json under different heuristic rules so
// we can compare audits apples-to-apples without re-rendering 432 PNGs.
//
// Usage:
//   node tools/audit/reclassify.mjs <results.json> <rubric>
//     rubric = original  | tight  | strict
//
// Original = what we ran in the very first full-catalog pass (any
// overflow / off-canvas counts as warn). This is the rubric we want for
// the honest "did Phase 4-6 actually move the needle" comparison.

import { promises as fs } from 'node:fs';

const RUBRIC = {
  original: r => (r.checks?.overflow ?? 0) > 0 || (r.checks?.offCanvas ?? 0) > 0 || r.consoleErrors?.length,
  tight:    r => (r.checks?.overflow ?? 0) > 0 || (r.checks?.offCanvas ?? 0) > 0 || (r.checks?.textOverlap ?? 0) >= 3 || r.consoleErrors?.length,
  strict:   r => (r.checks?.overflow ?? 0) > 0 || (r.checks?.offCanvas ?? 0) > 0 || (r.checks?.textOverlap ?? 0) > 0 || r.consoleErrors?.length,
};

const file   = process.argv[2];
const rubric = process.argv[3] ?? 'original';
const check  = RUBRIC[rubric];
if (!check) throw new Error(`unknown rubric: ${rubric}`);

const data = JSON.parse(await fs.readFile(file, 'utf8'));
let pass = 0, warn = 0, fail = 0;
for (const r of data.results) {
  if (r.checks?.empty) fail++;
  else if (check(r))   warn++;
  else                 pass++;
}
const total = data.results.length;
console.log(`rubric=${rubric}  PASS=${pass} (${(pass / total * 100).toFixed(1)}%)  WARN=${warn}  FAIL=${fail}`);
