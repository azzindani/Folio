#!/usr/bin/env node
// Type-pack index generator. Mirrors gen-palette-index.mjs.
// Reads every .type-pack.yaml under public/styles/type-packs/ and
// emits src/styles/type-pack-index.json with the metadata the picker
// needs (id, name, tags, family preview) so the bundle stays flat.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load as parseYAML } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const PACK_DIR   = path.join(ROOT, 'public', 'styles', 'type-packs');
const OUT_FILE   = path.join(ROOT, 'src', 'styles', 'type-pack-index.json');

/** Pick heading/body/mono as the picker preview, falling back to ''. */
function pickFamilies(families) {
  const f = families ?? {};
  return {
    heading: typeof f.heading === 'string' ? f.heading : '',
    body:    typeof f.body    === 'string' ? f.body    : '',
    mono:    typeof f.mono    === 'string' ? f.mono    : '',
  };
}

function summarize(spec, file) {
  return {
    id:          spec.id   ?? path.basename(file, '.type-pack.yaml'),
    name:        spec.name ?? spec.id ?? path.basename(file, '.type-pack.yaml'),
    tags:        Array.isArray(spec.tags) ? spec.tags : [],
    description: spec.description ?? '',
    families:    pickFamilies(spec.families),
    file:        path.basename(file),
  };
}

export async function generateTypePackIndex({ silent = false } = {}) {
  let files = [];
  try {
    files = (await fs.readdir(PACK_DIR))
      .filter(f => f.endsWith('.type-pack.yaml'))
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const entries = [];
  const errors  = [];

  for (const f of files) {
    const full = path.join(PACK_DIR, f);
    try {
      const raw  = await fs.readFile(full, 'utf8');
      const spec = parseYAML(raw);
      if (!spec || spec._protocol !== 'type-pack/v1') {
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
    _generator: 'scripts/gen-type-pack-index.mjs',
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
    console.log(`[type-pack-index] ${changed ? 'wrote' : 'unchanged'} ${entries.length} packs → ${path.relative(ROOT, OUT_FILE)}`);
    if (errors.length) {
      console.error(`[type-pack-index] ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }

  return { count: entries.length, changed, errors, outFile: OUT_FILE };
}

const isCliInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCliInvocation) {
  generateTypePackIndex().then(({ errors }) => {
    if (errors.length) process.exitCode = 1;
  }).catch(err => {
    console.error('[type-pack-index] fatal:', err);
    process.exit(1);
  });
}
