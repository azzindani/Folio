#!/usr/bin/env node
// Build a stratified inventory of the 432 builtin templates so we can
// sample evenly across type × theme × orientation for the pilot audit.
//
// Output:
//   tools/audit/inventory.json    — every entry + computed strata
//   tools/audit/pilot.json        — 15 templates spread across strata
//
// Run: node tools/audit/inventory.mjs

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const CATALOG   = path.join(ROOT, 'src', 'templates', 'catalog-index.json');
const OUT_INV   = path.join(__dirname, 'inventory.json');
const OUT_PILOT = path.join(__dirname, 'pilot.json');

function orientationOf(w, h) {
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return 'square';
  return r > 1 ? 'landscape' : 'portrait';
}

// Deterministic pseudo-random pick — sort by hash of id, slice N.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  const entries = Array.isArray(catalog) ? catalog : (catalog.entries ?? Object.values(catalog));

  const enriched = entries.map(e => ({
    id: e.id,
    name: e.name,
    file: e.file,
    type: e.type,
    themeRef: e.themeRef ?? null,
    width: e.width,
    height: e.height,
    orientation: orientationOf(e.width, e.height),
    pages: e.pages ?? 0,
    paged: (e.pages ?? 0) > 0,
    isVariant: e.file.startsWith('v-'),
  }));

  // Pilot strategy: 15 templates spanning the major dimensions.
  // We avoid auto-generated `v-*` variants for the pilot — base
  // templates give us better signal on actual layout problems.
  const bases = enriched.filter(e => !e.isVariant);

  // Pick by type buckets — guarantees coverage of distinct layouts.
  const typeBuckets = {
    poster:       2,
    card:         2,
    report:       2,
    carousel:     2,
    presentation: 1,
    book:         1,
    menu:         1,
    label:        1,
    ticket:       1,
    invoice:      1,
    certificate:  1,
  };

  const pilot = [];
  for (const [type, n] of Object.entries(typeBuckets)) {
    const pool = bases
      .filter(e => e.type === type)
      .sort((a, b) => fnv1a(a.id) - fnv1a(b.id));
    pilot.push(...pool.slice(0, n));
  }

  await fs.writeFile(OUT_INV, JSON.stringify({ count: enriched.length, entries: enriched }, null, 2));
  await fs.writeFile(OUT_PILOT, JSON.stringify({ count: pilot.length, entries: pilot }, null, 2));

  console.log(`[inventory] wrote ${enriched.length} entries → ${path.relative(ROOT, OUT_INV)}`);
  console.log(`[inventory] pilot set (${pilot.length}) → ${path.relative(ROOT, OUT_PILOT)}`);
  console.log(`[inventory] pilot composition:`);
  const comp = {};
  pilot.forEach(p => { comp[p.type] = (comp[p.type] ?? 0) + 1; });
  for (const [k, v] of Object.entries(comp)) console.log(`            ${k}: ${v}`);
}

await main();
