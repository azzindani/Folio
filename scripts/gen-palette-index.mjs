#!/usr/bin/env node
// Palette index generator. Mirrors gen-catalog-index.mjs but for the
// palette primitive — reads every .palette.yaml under
// public/styles/palettes/ and emits src/styles/palette-index.json with
// the metadata the picker needs (id, name, tags, swatches) without
// shipping the full palette files in the main bundle.
//
// Two entry points:
//   - CLI: `npm run gen:palettes` runs the script directly.
//   - Programmatic: `generatePaletteIndex()` is imported by the Vite
//     plugin so dev mode auto-regenerates when a palette is edited.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load as parseYAML } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const PAL_DIR    = path.join(ROOT, 'public', 'styles', 'palettes');
const OUT_FILE   = path.join(ROOT, 'src', 'styles', 'palette-index.json');

/** First five color values found, used as a swatch row in the picker. */
function pickSwatches(colors) {
  const values = [];
  for (const v of Object.values(colors ?? {})) {
    if (typeof v === 'string') values.push(v);
    else if (v && typeof v === 'object') {
      const inner = Object.values(v)[0];
      if (typeof inner === 'string') values.push(inner);
    }
    if (values.length >= 5) break;
  }
  while (values.length < 5) values.push('#000000');
  return values.slice(0, 5);
}

/** Flatten a parsed PaletteSpec into the index entry shape. */
function summarize(spec, file) {
  return {
    id:          spec.id   ?? path.basename(file, '.palette.yaml'),
    name:        spec.name ?? spec.id ?? path.basename(file, '.palette.yaml'),
    tags:        Array.isArray(spec.tags) ? spec.tags : [],
    description: spec.description ?? '',
    swatches:    pickSwatches(spec.colors),
    file:        path.basename(file),
  };
}

/**
 * Regenerate the palette index. Returns a result object so callers (CLI
 * and Vite plugin) can decide how to surface success/error. The file
 * is only rewritten when content changes, so watching the output file
 * for changes is a reliable HMR signal.
 *
 * Tolerates a missing palette directory — emits an empty index rather
 * than failing, which makes the system robust before any palettes are
 * authored.
 */
export async function generatePaletteIndex({ silent = false } = {}) {
  let files = [];
  try {
    files = (await fs.readdir(PAL_DIR))
      .filter(f => f.endsWith('.palette.yaml'))
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Directory doesn't exist yet — emit empty index.
  }

  const entries = [];
  const errors  = [];

  for (const f of files) {
    const full = path.join(PAL_DIR, f);
    try {
      const raw  = await fs.readFile(full, 'utf8');
      const spec = parseYAML(raw);
      if (!spec || spec._protocol !== 'palette/v1') {
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
    _generator: 'scripts/gen-palette-index.mjs',
    count:      entries.length,
    entries,
  };

  const next = JSON.stringify(out, null, 2) + '\n';
  let prev = '';
  try { prev = await fs.readFile(OUT_FILE, 'utf8'); } catch { /* first run */ }
  const changed = prev !== next;
  if (changed) {
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, next, 'utf8');
  }

  if (!silent) {
    console.log(`[palette-index] ${changed ? 'wrote' : 'unchanged'} ${entries.length} palettes → ${path.relative(ROOT, OUT_FILE)}`);
    if (errors.length) {
      console.error(`[palette-index] ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }

  return { count: entries.length, changed, errors, outFile: OUT_FILE };
}

// ── CLI entry ──────────────────────────────────────────────────

const isCliInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCliInvocation) {
  generatePaletteIndex().then(({ errors }) => {
    if (errors.length) process.exitCode = 1;
  }).catch(err => {
    console.error('[palette-index] fatal:', err);
    process.exit(1);
  });
}
