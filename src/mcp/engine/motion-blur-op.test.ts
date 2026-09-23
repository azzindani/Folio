import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';
import { decodeJsonStringArgs } from '../json-string-args';
import { TIER3_TOOLS } from '../tier3/registry';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mblur-'));
let dPath = '';
let n = 0;
const box = (id: string, x: number, y: number): object => ({ id, type: 'rect', z: 2, x, y, width: 120, height: 120, fill: '#E4572E' });
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 }, layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' },
    box('ball', 100, 400), box('hub', 500, 500), box('moon', 800, 500), box('still', 100, 800),
  ] }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const call = async (a: Record<string, unknown>): Promise<ToolResult & Record<string, unknown>> =>
  (await dispatchAnimation(decodeJsonStringArgs('animation', { design_path: dPath, ...a }))) as ToolResult & Record<string, unknown>;
type Node = Record<string, unknown> & { id: string; layers?: Node[] };
const find = (id: string, ls: Node[] = ((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? []) as unknown as Node[]): Node | undefined => {
  for (const l of ls) { if (l.id === id) return l; const hit = find(id, l.layers ?? []); if (hit) return hit; }
  return undefined;
};
/** 600 px in 300 ms, linearly: 2 px/ms. */
const whip = { keyframes: [{ t: 0, x: 0, easing: 'linear' }, { t: 300, x: 600 }] };

describe('animation op:motion_blur', () => {
  it('switches a layer on and measures its longest streak', async () => {
    await call({ op: 'track', layer_id: 'ball', ...whip });
    const r = await call({ op: 'motion_blur', layer_id: 'ball' });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(find('ball')?.['motion_blur']).toBe(true);
    // 2 px/ms over a 180° shutter at 30 fps (16.7 ms) ≈ 33 px.
    expect((r['streaks'] as Record<string, { px: number }>)['ball']?.px).toBe(33);
    const wide = await call({ op: 'motion_blur', layer_id: 'ball', shutter: 360 });
    expect(find('ball')?.['motion_blur']).toEqual({ shutter: 360 });
    expect((wide['streaks'] as Record<string, { px: number }>)['ball']?.px).toBe(67);
  });

  it('flags the wrapper a parented child moves through, and warns about a layer that never travels', async () => {
    await call({ op: 'track', layer_id: 'hub', keyframes: [{ t: 0, x: 0, easing: 'linear' }, { t: 300, x: -300 }] });
    await call({ op: 'parent', layer_id: 'moon', to: 'hub' });
    const r = await call({ op: 'motion_blur', layer_ids: ['moon', 'still'] });
    expect(find('moon_link')?.['motion_blur']).toBe(true);
    expect(find('moon')?.['motion_blur']).toBe(true);
    expect(Object.keys(r['streaks'] as object)).toEqual(['moon']);
    expect(JSON.stringify(r.progress)).toContain('Never smears');
  });

  it('clears, and refuses a shutter out of range or a missing layer', async () => {
    await call({ op: 'motion_blur', layer_id: 'ball' });
    await call({ op: 'motion_blur', layer_id: 'ball', clear: true });
    expect(find('ball')?.['motion_blur']).toBeUndefined();
    expect((await call({ op: 'motion_blur', layer_id: 'ball', shutter: 900 })).error).toContain('1–720');
    expect((await call({ op: 'motion_blur', layer_id: 'nope' })).error).toContain('"nope"');
  });

  it('declares the op and its shutter in the published schema', () => {
    const props = (TIER3_TOOLS.find(t => t.name === 'animation')?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
    expect(Object.keys(props)).toContain('shutter');
    expect(props['op']?.enum).toContain('motion_blur');
  });
});
