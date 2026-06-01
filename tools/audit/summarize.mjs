#!/usr/bin/env node
// Summarize a render results.json: counts, top failure modes, and a
// per-type breakdown so we know where the remaining issues cluster.
//
// Usage: node tools/audit/summarize.mjs tools/audit/shots/all/results.json

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

async function main() {
  const inFile = process.argv[2] ?? path.join(__dirname, 'shots', 'all', 'results.json');
  const data = JSON.parse(await fs.readFile(inFile, 'utf8'));
  const results = data.results;

  // Join with inventory so we can group by template type.
  const inv = JSON.parse(await fs.readFile(path.join(__dirname, 'inventory.json'), 'utf8'));
  const typeOf = Object.fromEntries(inv.entries.map(e => [e.id, e.type]));

  const counts = { pass: 0, warn: 0, fail: 0 };
  const byType = {};
  const failures = [];
  const warnings = [];

  for (const r of results) {
    counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    const type = typeOf[r.id] ?? 'unknown';
    byType[type] ??= { pass: 0, warn: 0, fail: 0 };
    byType[type][r.classification] = (byType[type][r.classification] ?? 0) + 1;
    if (r.classification === 'fail') failures.push(r);
    else if (r.classification === 'warn') warnings.push(r);
  }

  const total = results.length;
  console.log(`\nFull-catalog audit summary (${total} templates)`);
  console.log('─'.repeat(50));
  console.log(`PASS  ${counts.pass}   (${(counts.pass / total * 100).toFixed(1)}%)`);
  console.log(`WARN  ${counts.warn}   (${(counts.warn / total * 100).toFixed(1)}%)`);
  console.log(`FAIL  ${counts.fail}   (${(counts.fail / total * 100).toFixed(1)}%)`);

  console.log(`\nBy template type:`);
  const rows = Object.entries(byType).sort((a, b) => (b[1].warn + b[1].fail) - (a[1].warn + a[1].fail));
  for (const [t, c] of rows) {
    const tot = c.pass + c.warn + c.fail;
    console.log(`  ${t.padEnd(14)} pass=${String(c.pass).padStart(3)} warn=${String(c.warn).padStart(3)} fail=${String(c.fail).padStart(3)}  /${tot}`);
  }

  // Top failure categories
  const reasonHist = {};
  for (const r of [...failures, ...warnings]) {
    if (r.classification === 'fail' && r.checks?.empty) bump(reasonHist, 'empty render');
    if (r.consoleErrors?.length) bump(reasonHist, 'console errors');
    if (r.checks?.overflow > 0) bump(reasonHist, 'geometry overflow');
    if (r.checks?.offCanvas > 0) bump(reasonHist, 'geometry off-canvas');
  }
  console.log(`\nTop failure modes:`);
  for (const [k, v] of Object.entries(reasonHist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  // First 20 failures with detail
  if (failures.length) {
    console.log(`\nFailures (first 20):`);
    for (const r of failures.slice(0, 20)) {
      console.log(`  ${r.id.padEnd(48)} ${r.checks?.empty ? 'empty' : (r.consoleErrors?.[0] ?? '?').slice(0, 60)}`);
    }
  }

  const outFile = path.join(path.dirname(inFile), 'summary.txt');
  // re-emit to a file too
  const lines = [];
  lines.push(`Folio catalog audit — ${data.generated ?? ''}`);
  lines.push(`Total: ${total}   PASS=${counts.pass}  WARN=${counts.warn}  FAIL=${counts.fail}`);
  lines.push('');
  lines.push('By type:');
  for (const [t, c] of rows) lines.push(`  ${t.padEnd(14)} pass=${c.pass} warn=${c.warn} fail=${c.fail}`);
  await fs.writeFile(outFile, lines.join('\n') + '\n');
  console.log(`\nWrote ${path.relative(ROOT, outFile)}`);
}

function bump(o, k) { o[k] = (o[k] ?? 0) + 1; }

await main();
