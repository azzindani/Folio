import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { readStyleHistory, saturatedAxes, seedCheck, echoFinding, findEcho, type PriorDesign } from './design-history';
import { styleHistory } from './engine-style-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { duplicateDesign } from './engine-project-tools';
import { withOpScope } from './design-lineage';
import { readYAML } from './engine/utils';
import { designSignature } from './design-signature';
import type { DesignSpec } from '../schema/types';
import type { ShorthandLayer } from './shorthand-helpers';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-hist-'));
process.env['FOLIO_PROJECTS_DIR'] = root;

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A fresh project — each test gets its own so catalogues never bleed. */
function project(name: string): string {
  createProject({ name, canvas: '1080x1350' });
  return path.join(root, name);
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

const event = (over: Record<string, unknown> = {}): ShorthandLayer => ({
  id: 'e1', type: 'event', z: 0, pos: [0, 0, 1080, 1350], bg: '#FAF5EC', accent: '#C1440E',
  kicker: 'ONE NIGHT ONLY', title: 'Night Market',
  details: ['Sat July 18 · 8 PM', 'City Park', 'Free · All ages'],
  ...over,
} as unknown as ShorthandLayer);

/** Compose a design the way the tool surface does, seed and all. */
function make(dir: string, name: string, layer: ShorthandLayer, seed?: string): string {
  const d = createDesign({ project_path: dir, name, type: 'poster', width: 1080, height: 1350, ...(seed ? { style_seed: seed } : {}) }) as unknown as Record<string, unknown>;
  const p = d['path'] as string;
  addLayers({ design_path: p, layers_shorthand: [layer] });
  return p;
}

describe('style history — a project read as style', () => {
  it('signs every design and can leave one out', () => {
    const dir = project('p-read');
    make(dir, 'one', sections());
    const two = make(dir, 'two', event());
    const all = readStyleHistory(dir);
    expect(all.designs).toHaveLength(2);
    expect(all.designs.every(d => d.signature.structure.length > 0)).toBe(true);
    expect(readStyleHistory(dir, { exclude: two }).designs.map(d => d.name)).toEqual(['one']);
  });

  it('names the settled TRAIT and what the project never produced on it', () => {
    const dir = project('p-settled');
    // Three posters, three different accents — only the GROUND never moves.
    make(dir, 'a', sections({ accent: '#FF5C8A' }));
    make(dir, 'b', sections({ accent: '#1D4ED8', title: 'Rates held flat' }));
    make(dir, 'c', sections({ accent: '#16A34A', title: 'Volumes fell' }));
    const { designs } = readStyleHistory(dir);
    const settled = saturatedAxes(designs);
    const ground = settled.find(s => s.trait === 'ground');

    expect(ground).toBeDefined();
    expect(ground?.value).toMatch(/^dark-/);
    expect(ground?.count).toBe(3);
    // The point of the decomposition: accent moved, so it is NOT reported as
    // settled even though the coarse palette axis would read as saturated.
    expect(settled.some(s => s.trait === 'accent')).toBe(false);
    // Coverage of its own catalogue — readings the measure can report and this
    // project never has.
    expect(ground?.unused).toContain('light-warm');
    expect(ground?.unused).not.toContain(ground?.value);
  });

  it('says nothing at all until there is a pattern to see', () => {
    const dir = project('p-thin');
    make(dir, 'a', sections());
    make(dir, 'b', sections({ title: 'Another' }));
    expect(saturatedAxes(readStyleHistory(dir).designs)).toEqual([]);
  });
});

describe('style history — the echo', () => {
  it('flags a design that is a prior design with different words', () => {
    const dir = project('p-echo');
    make(dir, 'first', sections());
    const second = make(dir, 'second', sections({
      kicker: 'COFFEE PRICES', title: 'Arabica fell 12 percent',
      blocks: [
        { kind: 'stats', items: [{ value: '12%', label: 'Decline' }, { value: '4.1M', label: 'Bags' }] },
        { kind: 'heading_text', heading: 'Why it fell', body: 'A record Brazilian harvest.' },
      ],
    }));
    const finding = echoFinding(readYAML<DesignSpec>(second), second, dir);
    expect(finding?.code).toBe('design_duplicate');
    expect(finding?.severity).toBe('suggestion');       // never an error: the brief may want a set
    expect(finding?.message).toContain('first');
  });

  it('stays quiet when the sameness was asked for', () => {
    const dir = project('p-clone');
    const first = make(dir, 'first', sections());
    // A copy is SUPPOSED to look like its source — and lineage knows it was one.
    const copy = withOpScope('manage_design:duplicate', { design_path: first }, () =>
      duplicateDesign({ design_path: first, new_name: 'first-copy' })) as unknown as Record<string, unknown>;
    const copyPath = copy['path'] as string;
    expect(echoFinding(readYAML<DesignSpec>(copyPath), copyPath, dir)).toBeNull();
  });

  it('reports which traits two designs share, so the free one is obvious', () => {
    const dir = project('p-shared');
    make(dir, 'first', sections());
    const recoloured = make(dir, 'second', sections({ bg: '#FAF5EC', accent: '#1D4ED8' }));
    const prior = readStyleHistory(dir, { exclude: recoloured }).designs;
    const hit = findEcho(designSignature(readYAML<DesignSpec>(recoloured)), prior);
    expect(hit?.similarity.shared).toContain('structure');
    expect(hit?.similarity.differs).toContain('palette');
  });
});

describe('style history — checking the seed instead of believing it', () => {
  it('catches designs made under different seeds that came out the same', () => {
    const dir = project('p-seed');
    make(dir, 'a', sections(), 'seed-a');
    make(dir, 'b', sections({ title: 'Rates held flat' }), 'seed-b');
    const { designs } = readStyleHistory(dir);
    expect(designs.every(d => d.seed)).toBe(true);

    const check = seedCheck(designs);
    expect(check?.distinct_seeds).toBe(2);
    expect(check?.ineffective).toHaveLength(1);
    expect(check?.note).toMatch(/departure was not made/);
  });

  it('has nothing to check with fewer than two seeds', () => {
    const rows: PriorDesign[] = readStyleHistory(project('p-noseed')).designs;
    expect(seedCheck(rows)).toBeNull();
  });
});

describe('style_history — the tool', () => {
  it('an empty project has no house style and nothing to avoid', () => {
    const dir = project('p-empty');
    const r = styleHistory({ project_path: dir }) as unknown as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['count']).toBe(0);
    expect(String(r['note'])).toMatch(/Design freely/);
  });

  it('novelty 0 describes the house, 2 names every settled trait', () => {
    const dir = project('p-novelty');
    make(dir, 'a', sections({ accent: '#FF5C8A' }));
    make(dir, 'b', sections({ accent: '#1D4ED8', title: 'Rates held flat' }));
    make(dir, 'c', sections({ accent: '#16A34A', title: 'Volumes fell' }));

    const match = styleHistory({ project_path: dir, novelty: 0 }) as unknown as Record<string, unknown>;
    const house = match['direction'] as { vary: string[]; because: string[]; note: string };
    expect(house.vary).toEqual([]);
    expect(house.because.some(b => b.startsWith('ground='))).toBe(true);
    expect(house.note).toMatch(/sameness here is the brief/);

    const explore = styleHistory({ project_path: dir, novelty: 2 }) as unknown as Record<string, unknown>;
    const wide = explore['direction'] as { vary: string[]; unused?: Record<string, string[]> };
    expect(wide.vary).toContain('ground');
    expect(wide.vary.length).toBeGreaterThan(1);
    expect(Object.keys(wide.unused ?? {})).toContain('ground');
  });

  it('the same seed asks for the same departure twice, a different one need not', () => {
    const dir = project('p-seeded');
    make(dir, 'a', sections({ accent: '#FF5C8A' }));
    make(dir, 'b', sections({ accent: '#1D4ED8', title: 'Rates held flat' }));
    make(dir, 'c', sections({ accent: '#16A34A', title: 'Volumes fell' }));

    const at = (seed: number): string[] =>
      ((styleHistory({ project_path: dir, style_seed: seed }) as unknown as Record<string, unknown>)['direction'] as { vary: string[] }).vary;
    expect(at(7)).toEqual(at(7));
    expect(at(7)).toHaveLength(1);
    const settled = saturatedAxes(readStyleHistory(dir).designs);
    expect(new Set([...Array(settled.length).keys()].map(at).map(v => v[0])).size).toBe(settled.length);
  });
});
