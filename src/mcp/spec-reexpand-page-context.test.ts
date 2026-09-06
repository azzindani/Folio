import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { addLayers } from './engine-layer-tools';
import { patchDesignSpec } from './engine-spec-tools';
import type { DesignSpec, Layer } from '../schema/types';
import { fixInvisibleText, fixCapsTracking } from './engine-finalize-legibility';
import { themeSpecOf } from './engine-finalize-pages';

// add_layers sizes full-bleed presets to the page (fillBleedPresetDims) BEFORE
// expanding them. patch_spec re-expanded the same spec WITHOUT that step, so a
// preset authored with no explicit box — which is how the guide teaches it —
// was rebuilt at its natural content height instead of the canvas height.
//
// Measured live on a 1080x1350 poster: the sections container and its three
// background layers came back at 972px after editing one field, and the bottom
// 378 rows (28% of the page) rendered BLACK where they had been #FAF5EC.
//
// Found by asking whether the engine's own output is a fixed point: A -> B -> A
// did not return to A. The second round trip was clean, which is what said the
// drift was in the FIRST expansion, not in the edit.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-reexpand-'));
let dPath = '';
let n = 0;

const W = 1080;
const H = 1350;

const PRESET = {
  type: 'sections',
  kicker: 'FIELD NOTES',
  title: 'What twenty sweeps taught us',
  subtitle: 'A short account of finding things by comparison',
  blocks: [
    { kind: 'stats', items: [{ value: '42', label: 'faults' }, { value: '30', label: 'commits' }] },
    { kind: 'heading_text', heading: 'Compare two things', body: 'Holding two artefacts side by side and asking whether they agree.' },
  ],
  accent: '#F28C28',
};

beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' },
    document: { width: W, height: H },
    layers: [],
  }));
  addLayers({ design_path: dPath, layers_shorthand: [{ ...PRESET }] } as Parameters<typeof addLayers>[0]);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const read = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
const container = (): Record<string, unknown> | undefined =>
  (read().layers as Layer[]).map(l => l as unknown as Record<string, unknown>).find(l => String(l['type']) === 'group');

const patch = (changes: Record<string, unknown>): unknown =>
  patchDesignSpec({ design_path: dPath, layer_id: String(container()?.['id'] ?? ''), changes } as Parameters<typeof patchDesignSpec>[0]);

describe('re-expansion happens in the same page context as the original', () => {
  it('add_layers sizes the full-bleed preset to the canvas', () => {
    // The baseline the round trip has to return to.
    expect(container()?.['height']).toBe(H);
  });

  it('patch_spec does not shrink it to the natural content height', () => {
    const before = container()?.['height'];
    patch({ kicker: 'CHANGED' });
    expect(container()?.['height'], 'the preset lost its page sizing on re-expansion').toBe(before);
  });

  it('the background layers keep covering the page', () => {
    // The visible symptom: the container shrinking took its backdrop with it,
    // so the bottom of the poster painted black.
    patch({ kicker: 'CHANGED' });
    const kids = (container()?.['layers'] ?? []) as Record<string, unknown>[];
    const backdrops = kids.filter(k => Number(k['width']) === W);
    expect(backdrops.length, 'expected full-width backdrop layers').toBeGreaterThan(0);
    for (const b of backdrops) expect(b['height'], `${String(b['id'])} no longer covers the page`).toBe(H);
  });

  it('A -> B -> A returns to A, byte for byte', () => {
    // The whole question this pass asked. The engine's own output must be a
    // fixed point of the engine.
    const a = fs.readFileSync(dPath, 'utf8');
    patch({ kicker: 'TEMPORARY' });
    const b = fs.readFileSync(dPath, 'utf8');
    expect(b, 'the edit should actually have changed something').not.toBe(a);
    patch({ kicker: 'FIELD NOTES' });
    expect(fs.readFileSync(dPath, 'utf8')).toBe(a);
  });

  it('a real edit still takes effect', () => {
    // Determinism must not be bought by ignoring the patch.
    patch({ kicker: 'SOMETHING ELSE' });
    expect(fs.readFileSync(dPath, 'utf8')).toContain('SOMETHING ELSE');
  });
});

describe('re-expansion keeps the legibility corrections', () => {
  // The second drift, found by the same round trip: add_layers runs
  // fixInvisibleText + fixCapsTracking after expanding, patch_spec did not. So
  // the accent came back RAW at #F28C28 (orange on cream) where the engine had
  // already darkened it to #613810, and the ALL-CAPS tracking was gone.
  //
  // Asserted as a FIXED POINT rather than by comparing colours before/after:
  // the art direction is seeded from the copy (seededDefaults takes the title,
  // subtitle and kicker), so editing the kicker legitimately re-rolls the
  // palette. What must hold regardless of which palette comes out is that the
  // engine has nothing left to correct.
  it('leaves no text for the re-lighting pass to fix', () => {
    patch({ kicker: 'CHANGED' });
    const after = read();
    const n = fixInvisibleText(after.layers as Layer[], W, H, themeSpecOf(after));
    expect(n, 'text was left illegible by the re-expansion').toBe(0);
  });

  it('leaves no ALL-CAPS text untracked', () => {
    patch({ kicker: 'CHANGED' });
    const after = read();
    expect(fixCapsTracking(after.layers as Layer[]), 'caps tracking was dropped').toBe(0);
  });
});
