#!/usr/bin/env node
// Read results.json + inventory.json, filter to *actionable* warnings
// (textOverlap≥3 OR overflow>0 OR offCanvas>0), and split them across N
// agent manifests for parallel processing.
//
// Output: tools/audit/agent-batches/batch-{n}.json
//   each batch: [{ id, file, type, png, yaml, checks }]
//
// Usage: node tools/audit/split-warns.mjs [N]

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

const N         = Number(process.argv[2] ?? 3);
const OUT_DIR   = path.join(__dirname, 'agent-batches');
const RESULTS   = path.join(__dirname, 'shots', 'all', 'results.json');
const INV       = path.join(__dirname, 'inventory.json');
const SHOT_DIR  = path.join(__dirname, 'shots', 'all');
const TPL_DIR   = path.join(ROOT, 'public', 'templates', 'builtin');

async function main() {
  const results = JSON.parse(await fs.readFile(RESULTS, 'utf8')).results;
  const inv     = JSON.parse(await fs.readFile(INV, 'utf8')).entries;
  const entry   = Object.fromEntries(inv.map(e => [e.id, e]));

  // Filter: only templates with strong signal of a real issue.
  const actionable = results.filter(r => {
    const c = r.checks ?? {};
    return c.textOverlap >= 3 || c.overflow > 0 || c.offCanvas > 0;
  });

  // Stable, by-type round-robin so each batch covers multiple types
  // (avoids one agent getting all 92 posters and the other two idle).
  actionable.sort((a, b) => {
    const ta = entry[a.id]?.type ?? '', tb = entry[b.id]?.type ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : a.id.localeCompare(b.id);
  });

  await fs.mkdir(OUT_DIR, { recursive: true });
  const batches = Array.from({ length: N }, () => []);
  actionable.forEach((r, i) => {
    const e = entry[r.id] ?? {};
    batches[i % N].push({
      id: r.id,
      file: e.file,
      type: e.type,
      width: e.width,
      height: e.height,
      png: path.relative(ROOT, path.join(SHOT_DIR, `${r.id}.png`)),
      yaml: path.relative(ROOT, path.join(TPL_DIR, e.file ?? '')),
      checks: r.checks,
    });
  });

  for (let i = 0; i < N; i++) {
    const file = path.join(OUT_DIR, `batch-${i + 1}.json`);
    await fs.writeFile(file, JSON.stringify(batches[i], null, 2));
    console.log(`[split] batch-${i + 1}: ${batches[i].length} templates → ${path.relative(ROOT, file)}`);
  }
  console.log(`[split] total actionable: ${actionable.length}`);
}

await main();
