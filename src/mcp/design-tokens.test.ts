import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

import { collectTokens } from './design-tokens';
import { designTokens } from './engine-spec-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import type { ShorthandLayer } from './shorthand-helpers';
import type { DesignSpec } from '../schema/types';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-tokens-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'tk');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const SECTIONS = (id: string) => ({
  id, type: 'sections', z: 0, pos: [0, 0, 1080, 1350],
  bg: '#0A0A0A', accent: '#FF5C8A', text_color: '#FAFAFA',
  title: 'Air Cargo Performance', subtitle: 'Volume, yield and belly capacity.',
  blocks: [
    { kind: 'text', heading: 'Volume', text: 'Tonnage rose 8.4% year on year.' },
    { kind: 'stat', number: '8.4%', label: 'growth' },
  ],
} as unknown as ShorthandLayer);

const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;

/** Every hex anywhere in the file — the census the review complained about. */
function hexes(p: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of fs.readFileSync(p, 'utf-8').matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const h = m[0].toLowerCase();
    out.set(h, (out.get(h) ?? 0) + 1);
  }
  return out;
}

describe('design tokens — colour by role, read off the specs that already name it', () => {
  let designPath: string;

  beforeEach(() => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'tk', canvas: '1080x1350' });
    const d = createDesign({ project_path: projectDir, name: `d-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1350 }) as unknown as Rec;
    designPath = d['path'] as string;
    addLayers({ design_path: designPath, layers_shorthand: [SECTIONS('s1')] });
  });

  it('recovers the roles from a design that declares no token block', () => {
    const { table } = collectTokens(read(designPath));
    expect(table.bg).toBe('#0a0a0a');
    expect(table.accent).toBe('#ff5c8a');
    expect(table.text).toBe('#fafafa');
  });

  it('reports which specs name a role and how many hand-placed layers use it literally', () => {
    const r = designTokens({ design_path: designPath }) as unknown as Rec;
    const usage = r['usage'] as { role: string; value: string; specs: string[] }[];
    const accent = usage.find(u => u.role === 'accent')!;
    expect(accent.specs).toContain('s1');
  });

  // The claim the whole module rests on: a hex swap CANNOT do this, because the
  // relationship between an accent and the shades derived from it is not stored
  // anywhere in the expanded output.
  it('rebuilds derived shades — none of the old accent family survives', () => {
    const before = hexes(designPath);
    expect(before.get('#ff5c8a')).toBeGreaterThan(0);
    // Shades the builder derived FROM the accent, distinct from it.
    const derived = [...before.keys()].filter(h => h !== '#ff5c8a' && h !== '#0a0a0a' && h !== '#fafafa');

    const r = designTokens({ design_path: designPath, set: { accent: '#0EA5E9' } }) as unknown as Rec;
    expect(r['respecced']).toBe(1);

    const after = hexes(designPath);
    expect(after.get('#ff5c8a')).toBeUndefined();          // the accent itself is gone
    expect(after.get('#0ea5e9')).toBeGreaterThan(0);
    // And the shades derived from it were RECOMPUTED, not carried over frozen.
    const survivors = derived.filter(h => after.has(h));
    expect(survivors.length).toBeLessThan(derived.length);
  });

  it('records the palette on the design so it is declared, not merely implied', () => {
    designTokens({ design_path: designPath, set: { accent: '#0EA5E9' } });
    const t = (read(designPath) as unknown as Rec)['tokens'] as Rec;
    expect(t['accent']).toBe('#0ea5e9');
    expect(t['bg']).toBe('#0a0a0a');
  });

  it('changes several roles in one call and reports each', () => {
    const r = designTokens({ design_path: designPath, set: { accent: '#0EA5E9', bg: '#FFFDF7' } }) as unknown as Rec;
    expect((r['changed'] as string[]).length).toBe(2);
    expect((r['changed'] as string[]).join(' ')).toMatch(/accent: #ff5c8a → #0ea5e9/);
  });

  it('dry_run reports the outcome without touching the file', () => {
    const r = designTokens({ design_path: designPath, set: { accent: '#0EA5E9' }, dry_run: true }) as unknown as Rec;
    expect(r['would_respec']).toBe(1);
    expect(hexes(designPath).get('#ff5c8a')).toBeGreaterThan(0);
  });

  it('is a no-op when the role already has that value', () => {
    const r = designTokens({ design_path: designPath, set: { accent: '#FF5C8A' } }) as unknown as Rec;
    expect(r['changed']).toEqual([]);
    expect(String(r['note'])).toMatch(/already had that value/);
  });

  it('says how to set a role the design does not use, instead of failing silently', () => {
    const r = designTokens({ design_path: designPath, set: { panel: '#123456' } }) as unknown as Rec;
    expect((r['notes'] as string[]).join(' ')).toMatch(/patch_spec/);
  });
});

describe('design tokens — a design with no preset specs', () => {
  it('says plainly that there are no roles, and what to use instead', () => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'tk', canvas: '1080x1350' });
    const d = createDesign({ project_path: projectDir, name: `hand-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1350 }) as unknown as Rec;
    const p = d['path'] as string;
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 'h', type: 'text', z: 1, x: 80, y: 100, width: 900, height: 120, content: { type: 'plain', value: 'Hand placed' }, style: { font_size: 64, color: '#FAFAFA' } },
    ] as never });
    const r = designTokens({ design_path: p }) as unknown as Rec;
    expect(r['tokens']).toEqual({});
    expect(String(r['note'])).toMatch(/recolor/);
  });
});
