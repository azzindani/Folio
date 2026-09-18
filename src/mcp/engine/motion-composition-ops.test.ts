import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';
import { decodeJsonStringArgs } from '../json-string-args';
import { specAt } from '../../export/gif-frames';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';

// One continuous page: a title that moves to a corner, cards that arrive, a logo at the end.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-composition-'));
let dPath = '';
let n = 0;
const text = (id: string, x: number, y: number, value: string, size = 64): object =>
  ({ id, type: 'text', z: 3, x, y, width: 800, height: size * 1.3, content: { type: 'plain', value }, style: { font_family: 'Inter', font_size: size, color: '#111111' } });
const box = (id: string, x: number, y: number, extra: object = {}): object =>
  ({ id, type: 'rect', z: 2, x, y, width: 300, height: 180, fill: '#E4572E', ...extra });
const layers = (): object[] => [
  { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' },
  text('title', 140, 460, 'Ship it'), box('card1', 120, 420), box('card2', 460, 420), box('logo', 390, 800, { width: 300, height: 120 }),
  box('shadow', 130, 610, { height: 20, fill: '#00000033' }),
];
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 }, layers: layers() }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const call = async (a: Record<string, unknown>): Promise<ToolResult & Record<string, unknown>> =>
  (await dispatchAnimation(decodeJsonStringArgs('animation', { design_path: dPath, ...a }))) as ToolResult & Record<string, unknown>;
const spec = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
type Node = Record<string, unknown> & { id: string; layers?: Node[] };
const find = (id: string, ls: Node[] = (spec().layers ?? []) as unknown as Node[]): Node | undefined => {
  for (const l of ls) { if (l.id === id) return l; const hit = find(id, l.layers ?? []); if (hit) return hit; }
  return undefined;
};
const shots = [
  { id: 'hook', at: 0, states: { card1: 'hidden', card2: 'hidden', logo: 'hidden' } },
  { id: 'problem', at: 3000, states: { title: { x: 60, y: 60, scale: 0.5 }, card1: 'rise', card2: 'rise' }, stagger_ms: 120 },
  { id: 'cta', at: 'problem+4000', states: { card1: 'fade_out', card2: 'fade_out', logo: 'pop' } },
];

describe('animation op:storyboard', () => {
  it('writes one track per layer, windows for what enters and leaves, and a marker per shot', async () => {
    const r = await call({ op: 'storyboard', shots });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(spec().markers).toEqual({ hook: 0, problem: 3000, cta: 7000 });
    // The stagger runs over every layer the shot names, in order: title, card1, card2.
    expect(find('card1')?.['in']).toBe(3120);
    expect(find('card2')?.['in']).toBe(3240);
    expect(find('card1')?.['out']).toBeGreaterThan(7000);
    expect(find('logo')?.['in']).toBe(7000);
    expect(find('title')?.['in']).toBeUndefined();
    // The title rests in the corner through the cta shot: its drawn box, scaled by half, starts at 60,60.
    const at = specAt(spec(), 0, 6500).layers as unknown as Node[];
    const title = at.find(l => l.id === 'title');
    expect(String(title?.['transform'])).toContain('scale(0.5 0.5)');
    expect((r['shots'] as Array<{ id: string; until: number }>).map(s => [s.id, s.until])).toEqual([['hook', 3000], ['problem', 7000], ['cta', r['scene_ms']]]);
  });

  it('re-blocks on a second call instead of stacking motion', async () => {
    await call({ op: 'storyboard', shots });
    const again = await call({ op: 'storyboard', shots: [{ id: 'hook', at: 0, states: { title: { dx: 40 } } }] });
    expect(again.success, JSON.stringify(again)).toBe(true);
    expect(again['replaced']).toEqual(['title']);
    const kfs = (find('title')?.['animation'] as { keyframes: Array<Record<string, number>> }).keyframes;
    expect(kfs.every(k => k['scale'] === undefined)).toBe(true);
  });

  it('lints a shot that rests two texts on one spot', async () => {
    const r = await call({ op: 'storyboard', shots: [{ id: 'a', at: 0, states: { title: { dx: 0 } } }] });
    expect(r.success).toBe(true);
    fs.writeFileSync(dPath, yaml.dump({ ...spec(), layers: [...(spec().layers ?? []), text('title2', 140, 470, 'Ship it now')] }));
    const lint = await call({ op: 'lint' });
    expect((lint['notes'] as Array<{ kind: string }>).map(x => x.kind)).toContain('overlap');
  });

  it('names the layer, the preset and the time it cannot read', async () => {
    expect((await call({ op: 'storyboard', shots: [{ at: 0, states: { nope: 'rise' } }] })).error).toContain('no layer "nope"');
    expect((await call({ op: 'storyboard', shots: [{ at: 0, states: { title: 'pulse' } }] })).error).toContain('is a loop');
    expect((await call({ op: 'storyboard', shots: [{ at: 'later', states: { title: 'show' } }] })).error).toContain('No marker "later"');
  });
});

describe('animation op:markers + op:span', () => {
  it('sets markers relative to each other, removes one, and times a layer by them', async () => {
    expect((await call({ op: 'markers', markers: { hook: 0, problem: 'hook+2500', cta: 'problem+3000' } })).success).toBe(true);
    await call({ op: 'markers', markers: { hook: null } });
    expect(spec().markers).toEqual({ problem: 2500, cta: 5500 });
    const span = await call({ op: 'span', layer_id: 'card1', in: 'problem', out: 'cta-200' });
    expect(span.success, JSON.stringify(span)).toBe(true);
    expect([find('card1')?.['in'], find('card1')?.['out']]).toEqual([2500, 5300]);
    expect((await call({ op: 'span', layer_id: 'card1', in: 'cta', out: 'problem' })).error).toContain('must come after');
    await call({ op: 'span', layer_id: 'card1', clear: true });
    expect(find('card1')?.['in']).toBeUndefined();
  });

  it('lets op:sequence start a step at a marker', async () => {
    await call({ op: 'markers', markers: { problem: 2000 } });
    const r = await call({ op: 'sequence', steps: [{ preset: 'rise', layer_ids: ['card1'], at: 'problem+100' }] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect((find('card1')?.['animation'] as { playback: { delay: number } }).playback.delay).toBe(2100);
  });

  it('shows markers and windows in op:timeline', async () => {
    await call({ op: 'storyboard', shots });
    const t = await call({ op: 'timeline' });
    expect(t['markers']).toEqual({ hook: 0, problem: 3000, cta: 7000 });
    expect((t['windows'] as Array<{ layer_id: string }>).map(w => w.layer_id)).toEqual(expect.arrayContaining(['card1', 'card2', 'logo']));
    expect(String(t['ascii'])).toContain('▼hook');
  });
});
