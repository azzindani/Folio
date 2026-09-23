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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-rig-'));
let dPath = '';
let n = 0;
const box = (id: string, x: number, y: number): object => ({ id, type: 'rect', z: 2, x, y, width: 200, height: 120, fill: '#E4572E' });
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  // planet centre (200,160); moon centre (500,160); tag centre (500,460)
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 }, layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' },
    box('planet', 100, 100), box('moon', 400, 100), box('tag', 400, 400),
  ] }));
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
/** Where the flipbook puts a canvas point riding on `id` at time t. */
const mapped = (id: string, t: number, p: [number, number]): number[] => {
  const layer = (specAt(spec(), 0, t).layers as unknown as Node[]).find(l => l.id === id);
  const m = parseTransform(String(layer?.['transform'] ?? '')) ?? [1, 0, 0, 1, 0, 0];
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]].map(v => Math.round(v));
};
const spin = { keyframes: [{ t: 0, rotation: 0 }, { t: 500, rotation: 90 }] };

describe('animation op:parent', () => {
  it('turns the child about the PARENT\'s centre — an orbit, in the flipbook and the SVG alike', async () => {
    await call({ op: 'track', layer_id: 'planet', ...spin });
    const r = await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(r['pivot']).toEqual({ x: 200, y: 160 });
    expect(find('moon_link')?.['link']).toMatchObject({ to: 'planet', lag: 0, pivot: { x: 200, y: 160 } });
    // A quarter turn clockwise about (200,160) carries the moon's centre from (500,160) to (200,460).
    expect(mapped('moon_link', 2000, [500, 160])).toEqual([200, 460]);
    const svg = buildAnimatedSVG(spec(), { renderSVG: s => renderToSVGString(s) }).svg;
    expect(svg).toContain('transform-box: view-box; transform-origin: 200px 160px;');
    // op:frame reads the orbit back as numbers: the wrapper's pose, and where the moon's middle now is.
    const poses = (await call({ op: 'frame', t: 2000 }))['poses'] as Array<Record<string, unknown>>;
    expect(poses.find(p => p['id'] === 'moon_link'), JSON.stringify(poses)).toMatchObject({ rotation: 90, center: [200, 460] });
  });

  it('keeps the child\'s own motion playing inside, and clear unparents', async () => {
    await call({ op: 'track', layer_id: 'planet', ...spin });
    await call({ op: 'track', layer_id: 'moon', keyframes: [{ t: 0, scale: 1 }, { t: 500, scale: 2 }] });
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    expect(find('moon')?.['animation']).toBeTruthy();
    expect(find('moon_link')?.['layers']?.[0]?.id).toBe('moon');
    expect((await call({ op: 'parent', layer_id: 'moon', clear: true }))['cleared']).toEqual(['moon']);
    expect(find('moon_link')).toBeUndefined();
  });

  it('notes a child turning about where its parent no longer is', async () => {
    await call({ op: 'track', layer_id: 'planet', ...spin });
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    const moved = spec();
    ((moved.layers ?? []).find(l => l.id === 'planet') as unknown as Node)['x'] = 300;
    fs.writeFileSync(dPath, yaml.dump(moved));
    const lint = await call({ op: 'lint' });
    expect(JSON.stringify(lint['notes'])).toContain('Run op:parent again');
    expect((lint['notes'] as Array<{ note: string }>).map(x => x.note).join(' ')).toContain('"moon" turns about');
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    expect(JSON.stringify((await call({ op: 'lint' }))['notes'] ?? [])).not.toContain('op:parent again');
  });
});

/** Where the flipbook puts a canvas point riding on `id` and every group around it, at time t. */
const world = (id: string, t: number, p: [number, number]): number[] => {
  const walk = (ls: Node[], pt: [number, number][]): [number, number] | null => {
    for (const l of ls) {
      const m = parseTransform(String(l['transform'] ?? '')) ?? [1, 0, 0, 1, 0, 0];
      if (l.id === id) return pt[0] ?? null;
      const hit = walk(l.layers ?? [], pt);
      // Unwind: this group's transform applies after everything inside it.
      if (hit) return [m[0] * hit[0] + m[2] * hit[1] + m[4], m[1] * hit[0] + m[3] * hit[1] + m[5]];
    }
    return null;
  };
  // Apply the layer's own transform first, then its ancestors' on the way out.
  const at = specAt(spec(), 0, t).layers as unknown as Node[];
  const self = find(id, at);
  const m = parseTransform(String(self?.['transform'] ?? '')) ?? [1, 0, 0, 1, 0, 0];
  const own: [number, number] = [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  return (walk(at, [own]) ?? own).map(v => Math.round(v));
};

describe('animation op:parent — chains', () => {
  // planet turns 90° about (200,160); the moon, parented to it, also turns 90° about its own
  // centre (500,160); the tag rides the moon. Its centre (800,160) → (500,460) by the moon's
  // turn → (-100,460) by the planet's. Without the planet's level it would stop at (500,460).
  const rig = async (): Promise<void> => {
    fs.writeFileSync(dPath, yaml.dump({ ...spec(), layers: [...(spec().layers ?? []).filter(l => l.id !== 'tag'), box('tag', 700, 100)] }));
    await call({ op: 'track', layer_id: 'planet', ...spin });
    await call({ op: 'track', layer_id: 'moon', ...spin });
  };

  it('a grandchild rides its parent\'s whole world, whichever order the rig is built in', async () => {
    await rig();
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    const r = await call({ op: 'parent', layer_id: 'tag', to: 'moon' });
    expect(JSON.stringify(r.progress)).toContain('Rides its parent');
    expect(find('tag_link2')?.['link']).toMatchObject({ to: 'moon_link', pivot: { x: 200, y: 160 } });
    expect(world('tag', 2000, [800, 160])).toEqual([-100, 460]);
    // Built the other way round: parenting the moon later re-seats the tag.
    await call({ op: 'parent', layer_id: 'moon', clear: true });
    expect(find('tag_link2')).toBeUndefined();
    expect(world('tag', 2000, [800, 160])).toEqual([500, 460]);
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    expect(world('tag', 2000, [800, 160])).toEqual([-100, 460]);
  });

  it('unparenting the grandchild takes every level off it', async () => {
    await rig();
    await call({ op: 'parent', layer_id: 'moon', to: 'planet' });
    await call({ op: 'parent', layer_id: 'tag', to: 'moon' });
    await call({ op: 'parent', layer_id: 'tag', clear: true });
    expect(find('tag_link')).toBeUndefined();
    expect(find('tag_link2')).toBeUndefined();
    expect(find('tag')).toBeTruthy();
  });

  it('notes a child whose parent took on motion after it was parented', async () => {
    await rig();
    await call({ op: 'parent', layer_id: 'tag', to: 'moon' });
    await call({ op: 'link', layer_id: 'moon', to: 'planet', lag: 80 });
    const notes = ((await call({ op: 'lint' }))['notes'] as Array<{ note: string }>).map(x => x.note).join(' ');
    expect(notes).toContain('Run op:parent on "tag" again');
    await call({ op: 'parent', layer_id: 'tag', to: 'moon' });
    expect(JSON.stringify((await call({ op: 'lint' }))['notes'] ?? [])).not.toContain('again');
  });
});

describe('animation op:null', () => {
  it('adds an invisible controller at a point and parents layers to it in one call', async () => {
    const r = await call({ op: 'null', layer_id: 'rig', x: 500, y: 300, layer_ids: ['moon', 'tag'] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(find('rig')).toMatchObject({ type: 'group', visible: false, x: 450, y: 250, width: 100, height: 100, layers: [] });
    expect(r['pivot']).toEqual({ x: 500, y: 300 });
    expect(JSON.stringify(r.progress)).not.toContain('Target does not move');
    await call({ op: 'track', layer_id: 'rig', ...spin });
    // The tag's centre (500,460) sits 160 below the hub; a quarter turn swings it to (340,300).
    expect(mapped('tag_link', 2000, [500, 460])).toEqual([340, 300]);
    expect(renderToSVGString(spec())).toMatch(/data-layer-id="rig"[^>]*display="none"/);
  });

  it('refuses a taken id or a missing child, writing nothing', async () => {
    const before = fs.readFileSync(dPath, 'utf8');
    expect((await call({ op: 'null', layer_id: 'moon' })).error).toContain('already taken');
    expect((await call({ op: 'null', layer_id: 'rig', layer_ids: ['nope'] })).error).toContain('"nope"');
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
  });

  it('declares its arguments and both ops in the published schema', () => {
    const props = (TIER3_TOOLS.find(t => t.name === 'animation')?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
    for (const k of ['x', 'y', 'width', 'height', 'to', 'layer_ids']) expect(Object.keys(props), k).toContain(k);
    expect(props['op']?.enum).toEqual(expect.arrayContaining(['parent', 'null']));
  });
});
