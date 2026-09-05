import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { designSignature, compareSignatures, nearest, structureOf, compositionOf } from './design-signature';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { readYAML } from './engine/utils';
import type { DesignSpec, Layer } from '../schema/types';
import type { ShorthandLayer } from './shorthand-helpers';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sig-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'sg');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Build a real design through the engine and sign the result. */
function sign(layers: ShorthandLayer[], w = 1080, h = 1350): ReturnType<typeof designSignature> {
  if (!fs.existsSync(projectDir)) createProject({ name: 'sg', canvas: '1080x1350' });
  const d = createDesign({ project_path: projectDir, name: `d${n++}`, type: 'poster', width: w, height: h }) as unknown as Record<string, unknown>;
  const p = d['path'] as string;
  addLayers({ design_path: p, layers_shorthand: layers });
  return designSignature(readYAML<DesignSpec>(p));
}

const sections = (over: Record<string, unknown> = {}): ShorthandLayer => ({
  id: 's1', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF5C8A',
  kicker: 'AIR CARGO', title: 'Tonnage rose 8.4 percent',
  blocks: [
    { kind: 'stats', items: [{ value: '8.4%', label: 'YoY growth' }, { value: '62M', label: 'Tonnes' }] },
    { kind: 'heading_text', heading: 'What moved', body: 'Transpacific lanes carried the gain.' },
  ],
  ...over,
} as unknown as ShorthandLayer);

describe('signature — content is not style', () => {
  it('the SAME design with different words is a duplicate', () => {
    const a = sign([sections()]);
    const b = sign([sections({
      kicker: 'COFFEE PRICES', title: 'Arabica fell 12 percent',
      blocks: [
        { kind: 'stats', items: [{ value: '12%', label: 'Decline' }, { value: '4.1M', label: 'Bags' }] },
        { kind: 'heading_text', heading: 'Why it fell', body: 'A record Brazilian harvest.' },
      ],
    })]);
    // Every word differs; nothing about the design does.
    expect(compareSignatures(a, b).verdict).toBe('duplicate');
  });

  it('how much content there is does not move the band; where it sits does', () => {
    // The vertical measure is read at the band's CENTRE, not its bottom edge.
    // Off the bottom edge, growing a block downward eventually crossed 0.6H and
    // flipped the reading; off the top edge it fails the same way, because a
    // centred block grows in both directions at once. The centre is the layout
    // decision — the extent is just how much content there is.
    //
    // Hand-placed layers, deliberately: a PRESET re-rolls its whole layout from
    // the copy (mood-bank hashes align/columns/header off the title, Folio's own
    // anti-sameness mechanism), so a preset's geometry is copy-derived by design
    // and no measure can or should hold it still. This pins the part that is
    // mine — the classifier — with nothing else moving.
    const stack = (h: number): ShorthandLayer => ({
      id: 'g', type: 'group', x: 0, y: 0, width: 1080, height: 1350, locked: true,
      layers: [{
        id: 't1', type: 'text', x: 80, y: 675 - h / 2, width: 920, height: h,
        content: { type: 'plain', value: 'Same place, more of it' },
        style: { font_size: 48, color: '#ffffff' },
      }],
    } as unknown as ShorthandLayer);

    // Three blocks centred on the canvas, 200px tall to 900px tall.
    const bands = [200, 500, 900].map(h => sign([stack(h)]).composition.split('/')[1]);
    expect(new Set(bands).size).toBe(1);
    expect(bands[0]).toBe('mid');

    // The consequence that reaches a model: composition stays in `shared`, so
    // the echo finding cannot tell it to vary the one thing that is identical.
    const cmp = compareSignatures(sign([stack(200)]), sign([stack(500)]));
    expect(cmp.shared).toContain('composition');

    // And the measure still moves when the block genuinely sits elsewhere.
    const high = sign([{
      id: 'g', type: 'group', x: 0, y: 0, width: 1080, height: 1350, locked: true,
      layers: [{ id: 't1', type: 'text', x: 80, y: 60, width: 920, height: 200, content: { type: 'plain', value: 'Up top' }, style: { font_size: 48, color: '#ffffff' } }],
    } as unknown as ShorthandLayer]);
    expect(high.composition.split('/')[1]).toBe('top');
  });

  it('still separates a page-spanning composition from a centred one', () => {
    // `full` has to keep meaning something after the gate moved to 0.8, or the
    // reading is dead and `unused` advertises a departure nobody can take.
    const edgeToEdge = sign([{
      id: 'g', type: 'group', x: 0, y: 0, width: 1080, height: 1350, locked: true,
      layers: [
        { id: 't1', type: 'text', x: 80, y: 40, width: 920, height: 100, content: { type: 'plain', value: 'TOP' }, style: { font_size: 72, color: '#ffffff' } },
        { id: 't2', type: 'text', x: 80, y: 1220, width: 920, height: 100, content: { type: 'plain', value: 'BOTTOM' }, style: { font_size: 72, color: '#ffffff' } },
      ],
    } as unknown as ShorthandLayer]);
    expect(edgeToEdge.composition.split('/')[1]).toBe('full');
    expect(sign([sections()]).composition.split('/')[1]).not.toBe('full');
  });

  it('a different preset is a different design', () => {
    const a = sign([sections()]);
    const b = sign([{
      id: 'e1', type: 'event', z: 0, pos: [0, 0, 1080, 1350], bg: '#FAF5EC', accent: '#C1440E',
      kicker: 'ONE NIGHT ONLY', title: 'Night Market',
      details: ['Sat July 18 · 8 PM', 'City Park', 'Free · All ages'],
    } as unknown as ShorthandLayer]);
    expect(compareSignatures(a, b).verdict).toBe('distinct');
  });
});

describe('signature — the axes move independently', () => {
  it('a recolour alone does not make it a new design', () => {
    const a = sign([sections()]);
    const b = sign([sections({ bg: '#FAF5EC', accent: '#1D4ED8' })]);
    const s = compareSignatures(a, b);
    expect(s.verdict).not.toBe('distinct');       // still the same poster
    expect(s.differs).toContain('palette');
    expect(s.shared).toContain('structure');
  });

  it('different blocks read as a different structure', () => {
    const a = sign([sections()]);
    const b = sign([sections({
      blocks: [
        { kind: 'bars', items: [{ label: 'Asia', value: 62 }, { label: 'EU', value: 31 }] },
        { kind: 'callout', text: 'Rates held through Q3.' },
      ],
    })]);
    expect(compareSignatures(a, b).differs).toContain('structure');
  });

  it('a canvas of a different shape composes differently', () => {
    const a = sign([sections()], 1080, 1350);
    const b = sign([sections({ pos: [0, 0, 1920, 1080] })], 1920, 1080);
    expect(compareSignatures(a, b).distance).toBeGreaterThan(0);
  });
});

describe('signature — the parts', () => {
  it('structure names the preset and its block kinds, not its copy', () => {
    const a = sign([sections()]);
    expect(a.structure).toMatch(/^sections\[heading_text,stats\]$/);
    expect(a.structure).not.toMatch(/cargo|tonnage/i);
  });

  it('reads an empty design without inventing a shape', () => {
    expect(structureOf([])).toBe('empty');
    expect(compositionOf([], 1080, 1350)).toMatch(/^000\/none/);
  });

  it('palette describes the ground and accent by family, never by hex', () => {
    const a = sign([sections()]);
    expect(a.palette).toMatch(/^dark-/);
    expect(a.palette).not.toMatch(/#/);
    const b = sign([sections({ bg: '#FAF5EC' })]);
    expect(b.palette).toMatch(/^light-warm/);
  });

  it('type scale reports the headline weight, not the words', () => {
    const a = sign([sections()]);
    expect(a.type_scale).toMatch(/^(mega|xl|l|m|s)\//);
  });
});

describe('signature — finding the nearest prior design', () => {
  it('surfaces the one it echoes, and stays quiet when nothing is close', () => {
    const a = sign([sections()]);
    const twin = sign([sections({ title: 'Rates held flat' })]);
    const other = sign([{
      id: 'e1', type: 'event', z: 0, pos: [0, 0, 1080, 1350], bg: '#FAF5EC', accent: '#C1440E',
      kicker: 'ONE NIGHT', title: 'Night Market', details: ['Sat 8 PM', 'City Park'],
    } as unknown as ShorthandLayer]);

    const hit = nearest(a, [{ name: 'twin', signature: twin }, { name: 'other', signature: other }]);
    expect(hit?.match.name).toBe('twin');
    expect(nearest(other, [{ name: 'a', signature: a }])).toBeNull();
  });
});

describe('signature — the anchor is a decision, not a box', () => {
  /** The expanded layers of a design, for measuring composition directly. */
  function layersOf(layers: ShorthandLayer[], w = 1080, h = 1350): Layer[] {
    if (!fs.existsSync(projectDir)) createProject({ name: 'sg', canvas: '1080x1350' });
    const d = createDesign({ project_path: projectDir, name: `a${n++}`, type: 'poster', width: w, height: h }) as unknown as Record<string, unknown>;
    const p = d['path'] as string;
    addLayers({ design_path: p, layers_shorthand: layers });
    return readYAML<DesignSpec>(p).layers ?? [];
  }

  /** Two full-measure text stacks, identical but for how the type is set. */
  const stack = (align: string): ShorthandLayer[] => ([
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1350], fill: '#0A0A0A', locked: true },
    { id: 't1', type: 'text', z: 1, pos: [81, 200, 918, 200], text: 'Tonnage rose', size: 150, color: '#FFFFFF', align, locked: true },
    { id: 't2', type: 'text', z: 2, pos: [81, 440, 918, 120], text: 'Transpacific lanes carried the gain.', size: 24, color: '#CCCCCC', align, locked: true },
  ] as unknown as ShorthandLayer[]);

  // The boxes are identical in all three, so a centroid of BOXES cannot tell
  // them apart — and a preset lays its text out in exactly this shape, which is
  // why every preset design used to report "center" whatever it looked like.
  it('reads the type alignment when the ink spans the measure', () => {
    expect(compositionOf(layersOf(stack('left')), 1080, 1350)).toContain('/left');
    expect(compositionOf(layersOf(stack('center')), 1080, 1350)).toContain('/center');
    expect(compositionOf(layersOf(stack('right')), 1080, 1350)).toContain('/right');
  });

  it('falls back to position when the ink does NOT span the measure', () => {
    // A left-set column parked on the right reads right-anchored, whatever the
    // text does inside it — there, placement IS the decision.
    const narrow = [
      { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1350], fill: '#0A0A0A', locked: true },
      { id: 't1', type: 'text', z: 1, pos: [700, 300, 300, 200], text: 'Night Market', size: 90, color: '#FFFFFF', align: 'left', locked: true },
    ] as unknown as ShorthandLayer[];
    expect(compositionOf(layersOf(narrow), 1080, 1350)).toContain('/right');
  });
});

describe('signature — a wrapper group is packaging, not structure', () => {
  const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;

  // Measured on the live library: every hand-composed design there is wrapped
  // in one locked group, so reading the wrapper as the layer type "group" made
  // 25 of 25 designs on one project sign identically on the axis that carries
  // 0.40 of the weight.
  it('describes what is INSIDE a spec-less wrapper, not the wrapper', () => {
    const wrapped = structureOf([L({
      id: 'g', type: 'group',
      layers: [L({ id: 'r', type: 'rect' }), L({ id: 't', type: 'text' }), L({ id: 't2', type: 'text' })],
    })]);
    expect(wrapped).not.toBe('group');
    expect(wrapped).toBe('rect+text×2');
  });

  it('signs two differently-built compositions differently through their wrappers', () => {
    const a = structureOf([L({ id: 'g', type: 'group', layers: [L({ type: 'rect' }), L({ type: 'text' })] })]);
    const b = structureOf([L({ id: 'g', type: 'group', layers: [L({ type: 'image' }), L({ type: 'text' }), L({ type: 'text' })] })]);
    expect(a).not.toBe(b);
  });

  it('still stops at a PRESET group — its spec IS the structure, its children are output', () => {
    const preset = L({
      id: 'p', type: 'group', _spec: { type: 'stat' },
      layers: [L({ type: 'rect' }), L({ type: 'text' })],
    });
    expect(structureOf([preset])).toBe('stat');
  });

  it('keeps calling an empty group a group — there is nothing inside to describe', () => {
    expect(structureOf([L({ id: 'g', type: 'group', layers: [] })])).toBe('group');
  });

  it('flattens nested wrappers instead of nesting the description', () => {
    const s = structureOf([L({
      id: 'outer', type: 'group',
      layers: [L({ id: 'inner', type: 'group', layers: [L({ type: 'rect' }), L({ type: 'rect' })] })],
    })]);
    expect(s).toBe('rect×2');
  });

  it('stops descending before a pathological tree costs anything', () => {
    let deep: Layer = L({ type: 'rect' });
    for (let i = 0; i < 12; i++) deep = L({ id: `g${i}`, type: 'group', layers: [deep] });
    expect(() => structureOf([deep])).not.toThrow();
  });
});
