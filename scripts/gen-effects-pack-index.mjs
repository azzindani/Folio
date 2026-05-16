#!/usr/bin/env node
// Effects-pack index generator. Mirrors gen-palette-index.mjs.
// Reads every .effects-pack.yaml under public/styles/effects-packs/ and
// emits src/styles/effects-pack-index.json with the metadata the picker
// needs (id, name, tags, effect-key sample).

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load as parseYAML } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const PACK_DIR   = path.join(ROOT, 'public', 'styles', 'effects-packs');
const OUT_FILE   = path.join(ROOT, 'src', 'styles', 'effects-pack-index.json');

function summarize(spec, file) {
  const keys = Object.keys(spec.effects ?? {});
  return {
    id:          spec.id   ?? path.basename(file, '.effects-pack.yaml'),
    name:        spec.name ?? spec.id ?? path.basename(file, '.effects-pack.yaml'),
    tags:        Array.isArray(spec.tags) ? spec.tags : [],
    description: spec.description ?? '',
    effectKeys:  keys,
    file:        path.basename(file),
  };
}

export async function generateEffectsPackIndex({ silent = false } = {}) {
  let files = [];
  try {
    files = (await fs.readdir(PACK_DIR))
      .filter(f => f.endsWith('.effects-pack.yaml'))
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
      if (!spec || spec._protocol !== 'effects-pack/v1') {
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
    _generator: 'scripts/gen-effects-pack-index.mjs',
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
    console.log(`[effects-pack-index] ${changed ? 'wrote' : 'unchanged'} ${entries.length} packs → ${path.relative(ROOT, OUT_FILE)}`);
    if (errors.length) {
      console.error(`[effects-pack-index] ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }

  return { count: entries.length, changed, errors, outFile: OUT_FILE };
}

const isCliInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCliInvocation) {
  generateEffectsPackIndex().then(({ errors }) => {
    if (errors.length) process.exitCode = 1;
  }).catch(err => {
    console.error('[effects-pack-index] fatal:', err);
    process.exit(1);
  });
}
