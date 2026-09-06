import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { expandShorthand } from './shorthand-expand';
import type { ShorthandLayer } from './shorthand-helpers';
import type { Layer } from '../schema/types';
import { SPEC_FIELD, SPEC_ENV_FIELD, collectAuthoredSpecs, findSpecLayer, mergeSpecChanges, replaceLayer, diffSpecKeys, specAncestorOf } from './design-spec';
import { getDesignSpec, patchDesignSpec } from './engine-spec-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';

type Rec = Record<string, unknown>;
type G = Rec & { layers: Rec[] };

const SECTIONS = {
  id: 's1', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF6B35',
  title: 'Air Cargo Performance', subtitle: 'Volume, yield and belly capacity.',
  blocks: [
    { kind: 'text', heading: 'Volume', text: 'Tonnage rose 8.4% year on year across transpacific lanes.' },
    { kind: 'text', heading: 'Yield', text: 'Average yield fell 3.1% as capacity outpaced demand.' },
  ],
  footer: 'Source: Air Traffic Cargo, 2026',
} as unknown as ShorthandLayer;

/** The expanded tree with the spec fields stripped — what actually renders. */
const rendered = (l: unknown): string =>
  JSON.stringify(l, (k, v) => (k === SPEC_FIELD || k === SPEC_ENV_FIELD ? undefined : v));

describe('authored spec — kept beside the output', () => {
  it('a preset group carries the spec that built it', () => {
    const g = expandShorthand(structuredClone(SECTIONS)) as unknown as G;
    const spec = g[SPEC_FIELD] as Rec;
    expect(spec).toBeDefined();
    expect(spec['title']).toBe('Air Cargo Performance');
    expect((spec['blocks'] as unknown[]).length).toBe(2);
  });

  it('a plain rect carries none — a primitive IS its own source', () => {
    const r = expandShorthand({ id: 'bg', type: 'rect', z: 0, pos: [0, 0, 100, 100], fill: '#000' } as unknown as ShorthandLayer) as unknown as Rec;
    expect(r[SPEC_FIELD]).toBeUndefined();
  });

  it('keeps engine markers OUT of the authored spec and in their own field', () => {
    const g = expandShorthand({ ...structuredClone(SECTIONS), __fixedCanvas: true, __deckseed: 'deck-x', __theme: { bg: '#fff', text: '#000' } } as unknown as ShorthandLayer) as unknown as G;
    const spec = g[SPEC_FIELD] as Rec, env = g[SPEC_ENV_FIELD] as Rec;
    expect(Object.keys(spec).some(k => k.startsWith('__'))).toBe(false);
    expect(env['__fixedCanvas']).toBe(true);
    expect(env['__deckseed']).toBe('deck-x');
    // The theme is re-resolved from the design, never duplicated per slide.
    expect(env['__theme']).toBeUndefined();
  });

  // The property the whole feature rests on: if re-expansion drifted, a patch
  // would silently redesign the page instead of editing it.
  it('re-expanding an UNCHANGED spec reproduces the identical tree', () => {
    const a = expandShorthand(structuredClone(SECTIONS)) as unknown as G;
    const b = expandShorthand(structuredClone(a[SPEC_FIELD]) as ShorthandLayer) as unknown as G;
    expect(rendered(b)).toBe(rendered(a));
  });

  it('collects specs from nested trees and does not descend into generated output', () => {
    const g = expandShorthand(structuredClone(SECTIONS));
    const entries = collectAuthoredSpecs([g]);
    expect(entries).toHaveLength(1);
    expect(entries[0].layer_id).toBe('s1');
    expect(entries[0].type).toBe('sections');
  });

  it('finds and replaces a spec layer by id, at any depth', () => {
    const g = expandShorthand(structuredClone(SECTIONS));
    const tree = [{ id: 'outer', type: 'group', layers: [g] }] as unknown as Parameters<typeof findSpecLayer>[0];
    expect(findSpecLayer(tree, 's1')).toBeTruthy();
    expect(findSpecLayer(tree, 'nope')).toBeNull();
    expect(replaceLayer(tree, 's1', { id: 's1', type: 'rect' } as never)).toBe(true);
    expect(findSpecLayer(tree, 's1')).toBeNull();
  });
});

describe('mergeSpecChanges — patch semantics', () => {
  const base = { title: 'A', accent: '#FF0000', blocks: [1, 2, 3], style: { font: 'Inter', weight: 700 } };

  it('merges an object key by key, leaving siblings alone', () => {
    const out = mergeSpecChanges(base, { style: { font: 'Anton' } });
    expect(out['style']).toEqual({ font: 'Anton', weight: 700 });
    expect(out['title']).toBe('A');
  });

  it('replaces an ARRAY wholesale — a block list is one ordered thing', () => {
    expect(mergeSpecChanges(base, { blocks: [9] })['blocks']).toEqual([9]);
  });

  it('null DELETES a field, returning it to the engine default', () => {
    const out = mergeSpecChanges(base, { accent: null });
    expect('accent' in out).toBe(false);
  });

  it('reports what changed, with +/-/~ per key', () => {
    const after = mergeSpecChanges(base, { accent: null, title: 'B', footer: 'new' });
    expect(diffSpecKeys(base, after)).toEqual(['+footer', '-accent', '~title']);
  });
});

describe('get_spec / patch_spec — the round-trip through a real design', () => {
  let dir: string, designPath: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-spec-rt-'));
    process.env['FOLIO_PROJECTS_DIR'] = dir;
    createProject({ name: 'rt', canvas: '1080x1350' });
    const d = createDesign({ project_path: 'rt', name: 'deck', type: 'poster', width: 1080, height: 1350 }) as unknown as Rec;
    designPath = d['path'] as string;
    addLayers({ design_path: designPath, layers_shorthand: [structuredClone(SECTIONS) as unknown as ShorthandLayer] });
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('get_spec returns the authored intent, not the expanded tree', () => {
    const r = getDesignSpec({ design_path: designPath }) as unknown as Rec;
    expect(r['count']).toBe(1);
    const [entry] = r['specs'] as { layer_id: string; type: string; spec: Rec }[];
    expect(entry.type).toBe('sections');
    expect(entry.spec['title']).toBe('Air Cargo Performance');
    expect(entry.spec['layers']).toBeUndefined();
  });

  it('patch_spec changes one field and re-renders in place', () => {
    const r = patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: { accent: '#0EA5E9' } }) as unknown as Rec;
    expect(r['success']).not.toBe(false);
    expect(r['changed']).toEqual(['~accent']);
    const after = getDesignSpec({ design_path: designPath, layer_id: 's1' }) as unknown as Rec;
    const [entry] = after['specs'] as { spec: Rec }[];
    expect(entry.spec['accent']).toBe('#0EA5E9');
    expect(entry.spec['title']).toBe('Air Cargo Performance');   // untouched
  });

  it('patching the block list re-renders fewer layers — the intent drives the output', () => {
    const before = patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: {}, dry_run: true }) as unknown as Rec;
    expect(before['note']).toMatch(/nothing to re-render/);
    const r = patchDesignSpec({
      design_path: designPath, layer_id: 's1',
      changes: { blocks: [{ kind: 'text', heading: 'Volume', text: 'Tonnage rose 8.4% year on year.' }] },
    }) as unknown as Rec;
    expect(r['layers_after'] as number).toBeLessThan(r['layers_before'] as number);
  });

  it('keeps a lock the model authored on the container', () => {
    // Re-expansion replaces the WHOLE layer, so `locked` — which is not part of
    // any spec — went with it. Measured live: locked before 1, after 0. The
    // model sets that flag to tell the auto-rescue passes to leave a hand-placed
    // composition alone (248 of 276 library designs do), so patching one field
    // silently handed the composition back to the reflow it had opted out of.
    const specLayer = (): Rec => {
      const design = (require('js-yaml') as { load: (s: string) => { layers: Rec[] } }).load(fs.readFileSync(designPath, 'utf8'));
      return design.layers.find(l => l['id'] === 's1') as Rec;
    };
    const yaml = require('js-yaml') as { load: (s: string) => Rec; dump: (o: unknown) => string };
    const doc = yaml.load(fs.readFileSync(designPath, 'utf8')) as { layers: Rec[] };
    (doc.layers.find(l => l['id'] === 's1') as Rec)['locked'] = true;
    fs.writeFileSync(designPath, yaml.dump(doc));
    expect(specLayer()['locked']).toBe(true);

    patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: { accent: '#123456' } });

    expect(specLayer()['locked']).toBe(true);   // survived the rebuild
  });

  it('dry_run reports the diff without writing', () => {
    const r = patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: { title: 'Draft only' }, dry_run: true }) as unknown as Rec;
    expect(r['changed']).toEqual(['~title']);
    const after = getDesignSpec({ design_path: designPath, layer_id: 's1' }) as unknown as Rec;
    expect((after['specs'] as { spec: Rec }[])[0].spec['title']).not.toBe('Draft only');
  });

  it('warns when the generated layers were hand-edited — a patch discards them', () => {
    // Edit a generated child directly, the way edit_layer {op:"update"} would.
    const raw = fs.readFileSync(designPath, 'utf-8');
    const edited = raw.replace('Air Cargo Performance', 'Hand-edited headline');
    fs.writeFileSync(designPath, edited);
    const r = patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: { accent: '#111111' }, dry_run: true }) as unknown as Rec;
    const notes = (r['notes'] ?? []) as string[];
    expect(notes.join(' ')).toMatch(/no longer match this spec/);
    expect(notes.join(' ')).toMatch(/Hand-edited headline/);
    fs.writeFileSync(designPath, raw);
  });

  it('stays quiet when the layers still agree with the spec', () => {
    const r = patchDesignSpec({ design_path: designPath, layer_id: 's1', changes: { accent: '#222222' }, dry_run: true }) as unknown as Rec;
    expect(((r['notes'] ?? []) as string[]).join(' ')).not.toMatch(/no longer match/);
  });

  it('refuses a layer that has no spec, and says what to use instead', () => {
    const r = patchDesignSpec({ design_path: designPath, layer_id: 'not-there', changes: { title: 'x' } }) as unknown as Rec;
    expect(r['success']).toBe(false);
    expect(String(r['hint'])).toMatch(/get_spec/);
  });
});

describe('specAncestorOf — the id patch_spec actually accepts', () => {
  const tree = (): Layer[] => ([
    {
      id: 'sections_1', type: 'group', _spec: { type: 'sections' },
      layers: [
        { id: 'sections_1_title', type: 'text' },
        { id: 'sections_1_block', type: 'group', layers: [{ id: 'sections_1_block_body', type: 'text' }] },
      ],
    },
    { id: 'loose_rect', type: 'rect' },
    {
      id: 'plain_group', type: 'group',
      layers: [{ id: 'nested_stat', type: 'group', _spec: { type: 'stat' }, layers: [{ id: 'nested_stat_value', type: 'text' }] }],
    },
  ] as unknown as Layer[]);

  it('walks up from a generated child to the preset that owns it', () => {
    expect(specAncestorOf(tree(), 'sections_1_title')).toBe('sections_1');
  });

  it('finds it from any depth, not just the first level', () => {
    expect(specAncestorOf(tree(), 'sections_1_block_body')).toBe('sections_1');
  });

  it('returns the layer itself when it carries the spec', () => {
    expect(specAncestorOf(tree(), 'sections_1')).toBe('sections_1');
  });

  it('is null for a hand-placed layer — it is its own source and needs no spec', () => {
    expect(specAncestorOf(tree(), 'loose_rect')).toBeNull();
  });

  it('reports the NEAREST spec, not an outer group that has none', () => {
    expect(specAncestorOf(tree(), 'nested_stat_value')).toBe('nested_stat');
  });

  it('is null for an id that is not in the tree at all', () => {
    expect(specAncestorOf(tree(), 'no-such-layer')).toBeNull();
  });
});
