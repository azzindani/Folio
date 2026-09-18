import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';
import { decodeJsonStringArgs } from '../json-string-args';
import { TIER3_TOOLS } from '../tier3/registry';
import { specAt } from '../../export/gif-frames';
import { buildAnimatedSVG } from '../../export/svg-animate';
import { renderToSVGString } from './svg-export';
import { parseTransform } from '../../export/frame-cull';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-precomp-'));
let dPath = '';
let n = 0;
const box = (id: string, x: number, y: number, extra: object = {}): object =>
  ({ id, type: 'rect', z: 2, x, y, width: 200, height: 120, fill: '#E4572E', ...extra });
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 }, layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' },
    box('a', 100, 100), box('b', 400, 100), box('lead', 100, 600), box('tail', 100, 760, { height: 20 }),
    { id: 'wire', type: 'path', z: 1, d: 'M 100 900 L 600 900', stroke: { color: '#111111', width: 4 } },
  ] }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const call = async (a: Record<string, unknown>): Promise<ToolResult & Record<string, unknown>> =>
  (await dispatchAnimation(decodeJsonStringArgs('animation', { design_path: dPath, ...a }))) as ToolResult & Record<string, unknown>;
const spec = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;
type Node = Record<string, unknown> & { id: string; layers?: Node[] };
const ids = (ls: Node[] = (spec().layers ?? []) as unknown as Node[]): string[] => ls.flatMap(l => [l.id, ...ids(l.layers ?? [])]);
const find = (id: string, ls: Node[] = (spec().layers ?? []) as unknown as Node[]): Node | undefined => {
  for (const l of ls) { if (l.id === id) return l; const hit = find(id, l.layers ?? []); if (hit) return hit; }
  return undefined;
};

describe('animation op:precomp', () => {
  it('wraps siblings into a group with its own clock; its children then play on the scene clock', async () => {
    await call({ op: 'track', layer_ids: ['a', 'b'], keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }] });
    await call({ op: 'markers', markers: { act2: 2000 } });
    const r = await call({ op: 'precomp', layer_id: 'cards', layer_ids: ['a', 'b'], start: 'act2', speed: 2 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(find('cards')?.['clock']).toEqual({ start: 2000, speed: 2 });
    expect(r['scene_spans']).toEqual([{ id: 'a', start_ms: 2000, end_ms: 2200 }, { id: 'b', start_ms: 2000, end_ms: 2200 }]);
    const svg = buildAnimatedSVG(spec(), { renderSVG: s => renderToSVGString(s) }).svg;
    expect(svg).toContain('animation: kf-a 200ms linear 2000ms');
    // A second call changes the clock, never nests another group.
    await call({ op: 'precomp', layer_id: 'cards', loop_ms: 1000 });
    expect(ids().filter(i => i === 'cards')).toHaveLength(1);
    expect(find('cards')?.['clock']).toEqual({ start: 2000, speed: 2, loop: 1000 });
  });

  it('duplicates an instance with fresh ids, moved and re-timed, and refuses a taken id', async () => {
    await call({ op: 'precomp', layer_id: 'cards', layer_ids: ['a', 'b', 'wire'] });
    const r = await call({ op: 'precomp', layer_id: 'cards', duplicate: { id: 'cards2', start: '3000', dy: 300 } });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(find('a_cards2')?.['y']).toBe(400);
    expect(find('wire_cards2')?.['d']).toBe('M 100 1200 L 600 1200');
    expect(find('cards2')?.['clock']).toEqual({ start: 3000 });
    expect((await call({ op: 'precomp', layer_id: 'cards', duplicate: { id: 'cards2' } })).error).toContain('already taken');
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it('refuses a clock on something that is not a group, and siblings from different groups', async () => {
    expect((await call({ op: 'precomp', layer_id: 'a', speed: 2 })).error).toContain('not a group');
    await call({ op: 'precomp', layer_id: 'g1', layer_ids: ['a'] });
    expect((await call({ op: 'precomp', layer_id: 'g2', layer_ids: ['a', 'b'] })).error).toContain('side by side');
  });
});

describe('animation op:link', () => {
  it('wraps the follower, plays the lead\'s track later and scaled, and re-links without nesting', async () => {
    await call({ op: 'track', layer_id: 'lead', keyframes: [{ t: 0, x: 0 }, { t: 500, x: 300 }] });
    const r = await call({ op: 'link', layer_id: 'tail', to: 'lead', lag: 120, factor: 0.5, channels: ['x'] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(find('tail_link')?.['link']).toEqual({ to: 'lead', lag: 120, factor: 0.5, channels: ['x'] });
    expect(r['wrappers']).toEqual([{ wrapper: 'tail_link', follows: 'lead', lag: 120, start_ms: 120, end_ms: 620 }]);
    const late = specAt(spec(), 0, 2000).layers as unknown as Node[];
    expect(late.find(l => l.id === 'tail_link')?.['transform']).toBe('translate(150 0)');
    await call({ op: 'link', layer_id: 'tail', to: 'lead', lag: 60 });
    expect(ids().filter(i => i.startsWith('tail_link'))).toEqual(['tail_link']);
    const cleared = await call({ op: 'link', layer_id: 'tail', clear: true });
    expect(cleared['cleared']).toEqual(['tail']);
    expect(ids()).not.toContain('tail_link');
  });

  it('refuses to follow itself or its own child, and warns when the lead does not move', async () => {
    expect((await call({ op: 'link', layer_id: 'lead', to: 'lead' })).error).toContain('itself');
    const still = await call({ op: 'link', layer_id: 'tail', to: 'b' });
    expect(JSON.stringify(still['progress'])).toContain('Target does not move');
  });
});

describe('animation op:camera — a world larger than the canvas', () => {
  it('pins the camera to the world, frames a region, and lets shots use marker times', async () => {
    await call({ op: 'markers', markers: { right: 2000 } });
    const world = { x: 0, y: 0, width: 3240, height: 1080 };
    const r = await call({ op: 'camera', world, shots: [{ t: 0, target: { x: 0, y: 0, width: 1080, height: 1080 } }, { t: 'right', target: { x: 2160, y: 0, width: 540, height: 540 } }] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(spec().world).toEqual(world);
    expect(find('__camera_pin')).toMatchObject(world);
    expect(find('__camera')).toMatchObject(world);
    // Scale 1 needs no pivot; the 2× push-in on the far corner pivots on the world's centre (1620,540).
    expect((r['shots'] as Array<Record<string, number>>).map(s => [s['t'], s['scale'], s['x'], s['y']])).toEqual([[0, 1, 0, 0], [2000, 2, -2700, 540]]);
    // The flipbook agrees: the region's centre (2430,270) lands on the canvas centre.
    const cam = (specAt(spec(), 0, 2000).layers as unknown as Node[]).find(l => l.id === '__camera');
    const m = parseTransform(String(cam?.['transform'])) ?? [1, 0, 0, 1, 0, 0];
    expect([m[0] * 2430 + m[2] * 270 + m[4], m[1] * 2430 + m[3] * 270 + m[5]].map(v => Math.round(v))).toEqual([540, 540]);
  });

  it('declares every argument the new ops read in the published schema', () => {
    const props = Object.keys((TIER3_TOOLS.find(t => t.name === 'animation')?.inputSchema.properties) ?? {});
    for (const k of ['shots', 'markers', 'in', 'out', 'start', 'speed', 'loop_ms', 'duplicate', 'channels', 'lag', 'factor', 'world', 'length_ms', 'hold_ms', 'to', 'clear', 'stagger_ms']) {
      expect(props, k).toContain(k);
    }
  });
});
