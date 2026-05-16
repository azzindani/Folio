#!/usr/bin/env node
// Catalog index generator. Reads every .template.yaml under
// src/templates/builtin/ and emits a flat metadata JSON the catalog
// dialog can browse without parsing the full specs.
//
// Two entry points:
//   - CLI: `npm run gen:catalog` runs the script directly.
//   - Programmatic: `generateCatalogIndex()` is imported by the Vite
//     plugin (vite.config.ts) so dev mode auto-regenerates on save.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load as parseYAML } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const TPL_DIR    = path.join(ROOT, 'src', 'templates', 'builtin');
const OUT_FILE   = path.join(ROOT, 'src', 'templates', 'catalog-index.json');

/** Convert a partially-parsed TemplateSpec into a flat catalog entry. */
function summarize(spec, file) {
  const meta = spec.meta ?? {};
  const doc  = spec.document ?? {};
  const themeRef =
    (typeof spec.theme === 'object' && spec.theme && 'ref' in spec.theme)
      ? String(spec.theme.ref)
      : undefined;
  return {
    id:        meta.id ?? path.basename(file, '.template.yaml'),
    name:      meta.name ?? meta.id ?? path.basename(file, '.template.yaml'),
    type:      meta.type ?? 'poster',
    tags:      Array.isArray(meta.tags) ? meta.tags : [],
    width:     Number(doc.width  ?? 0),
    height:    Number(doc.height ?? 0),
    slots:     Array.isArray(spec.slots) ? spec.slots.length : 0,
    pages:     Array.isArray(spec.pages) ? spec.pages.length : 0,
    themeRef,
    file:      path.basename(file),
  };
}

/**
 * Regenerate the catalog index. Returns a result object so callers (CLI
 * and Vite plugin) can decide how to surface success/error.
 * The file is only rewritten when its content actually changes, so
 * watching the output file for changes is a reliable HMR signal.
 */
export async function generateCatalogIndex({ silent = false } = {}) {
  const files = (await fs.readdir(TPL_DIR))
    .filter(f => f.endsWith('.template.yaml'))
    .sort();

  const entries = [];
  const errors  = [];

  for (const f of files) {
    const full = path.join(TPL_DIR, f);
    try {
      const raw  = await fs.readFile(full, 'utf8');
      const spec = parseYAML(raw);
      if (!spec || spec._protocol !== 'template/v1') {
        errors.push(`${f}: missing or wrong _protocol`);
        continue;
      }
      entries.push(summarize(spec, f));
    } catch (err) {
      errors.push(`${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    _generator: 'scripts/gen-catalog-index.mjs',
    count:      entries.length,
    entries,
  };

  const next = JSON.stringify(out, null, 2) + '\n';
  let prev = '';
  try { prev = await fs.readFile(OUT_FILE, 'utf8'); } catch { /* first run */ }
  const changed = prev !== next;
  if (changed) {
    await fs.writeFile(OUT_FILE, next, 'utf8');
  }

  if (!silent) {
    console.log(`[catalog-index] ${changed ? 'wrote' : 'unchanged'} ${entries.length} templates → ${path.relative(ROOT, OUT_FILE)}`);
    if (errors.length) {
      console.error(`[catalog-index] ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }

  return { count: entries.length, changed, errors, outFile: OUT_FILE };
}

// ── CLI entry ──────────────────────────────────────────────────

const isCliInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCliInvocation) {
  generateCatalogIndex().then(({ errors }) => {
    if (errors.length) process.exitCode = 1;
  }).catch(err => {
    console.error('[catalog-index] fatal:', err);
    process.exit(1);
  });
}
