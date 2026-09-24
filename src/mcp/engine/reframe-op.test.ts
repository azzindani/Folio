// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, Layer } from '../../schema/types';
import { ALL_HANDLERS } from '../handlers';
import { mapSubtree } from './reframe-map';
import { reframeSize } from './reframe-op';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-reframe-'));
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const write = (name: string, body: object): string => {
  const p = path.join(root, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, yaml.dump({ _protocol: 'design/v1', meta: { id: name, name, type: 'poster' }, document: { width: 1920, height: 1080 }, ...body }));
  return p;
};
const reframe = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await ALL_HANDLERS['manage_design']?.({ op: 'reframe', ...args })) as unknown as Record<string, unknown>;
const load = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf8')) as DesignSpec;

describe('mapSubtree', () => {
  it('scales a track\'s pixel keys and moves its canvas points, leaving scale and opacity alone', () => {
    const l = { id: 'a', type: 'path', d: 'M100 100L200 100', morph_to: 'M100 200L200 200', clip_rect: { x: 100, y: 100, width: 200, height: 100 },
      animation: { keyframes: [{ t: 0, x: -600, blur: 20, scale: 0.5, opacity: 0 }, { t: 500, x: 0, blur: 0, scale: 1, opacity: 1 }], playback: { duration: 500, pivot: { x: 150, y: 100 } } } } as unknown as Layer;
    mapSubtree(l, { k: 0.5, ox: 100, oy: 100, dx: 20, dy: 40 });
    const o = l as unknown as { d: string; morph_to: string; clip_rect: object; animation: { keyframes: object[]; playback: { pivot: object } } };
    expect(o.animation.keyframes).toEqual([{ t: 0, x: -300, blur: 10, scale: 0.5, opacity: 0 }, { t: 500, x: 0, blur: 0, scale: 1, opacity: 1 }]);
    expect(o.animation.playback.pivot).toEqual({ x: 145, y: 140 });
    expect(o.clip_rect).toEqual({ x: 120, y: 140, width: 100, height: 50 });
    expect(o.d).toBe('M120 140L170 140');
    expect(o.morph_to).toBe('M120 190L170 190');
  });
});

describe('manage_design {op:"reframe"}', () => {
  it('sizes the frame on the source\'s short side', () => {
    expect(reframeSize(1920, 1080, { aspect: '9:16' })).toMatchObject({ W: 1080, H: 1920 });
    expect(reframeSize(1920, 1080, { aspect: '4:5' })).toMatchObject({ W: 1080, H: 1350 });
    expect(reframeSize(1080, 1920, { aspect: '16:9' })).toMatchObject({ W: 1920, H: 1080 });
    expect(reframeSize(1920, 1080, { aspect: 'tall' })).toBeNull();
  });

  it('writes the story beside the promo, leaves the promo alone, and reviews the new frame', async () => {
    const promo = write('promo', { layers: [
      { id: 'ground', type: 'rect', z: 0, x: 0, y: 0, width: 1920, height: 1080, fill: '#101820' },
      { id: 'title', type: 'text', z: 2, x: 120, y: 380, width: 760, height: 130, content: { type: 'plain', value: 'Ship it faster' },
        style: { font_family: 'Archivo', font_size: 96, font_weight: 800, color: '#F3E7D6' },
        animation: { keyframes: [{ t: 0, x: -400, opacity: 0 }, { t: 600, x: 0, opacity: 1 }], playback: { duration: 600, origin: 'offset' } } },
      { id: 'pic', type: 'rect', z: 2, x: 1040, y: 160, width: 760, height: 760, fill: '#E4572E' },
    ] });
    const before = fs.readFileSync(promo, 'utf8');
    const r = await reframe({ design_path: promo, aspect: '9:16' });
    expect(r['success']).toBe(true);
    expect(fs.readFileSync(promo, 'utf8')).toBe(before);
    const out = String(r['design_path']);
    expect(path.basename(out)).toBe('promo-9x16.design.yaml');
    const story = load(out);
    expect(story.document).toMatchObject({ width: 1080, height: 1920 });
    const [ground, title] = (story.layers ?? []) as unknown as Array<{ width: number; height: number; x: number; animation?: { keyframes: Array<{ x: number }> } }>;
    expect(ground).toMatchObject({ width: 1080, height: 1920 });
    // The slide-in scales with its title (here ×1: both frames are 1080 on the short side).
    expect(title?.animation?.keyframes[0]?.x).toBeCloseTo(-400 * ((title?.width ?? 0) / 760), 0);
    expect(r['review']).toMatchObject({ verdict: expect.any(String) });
    expect((await reframe({ design_path: promo, aspect: '9:16' }))['error']).toMatch(/already exists/);
  });

  it('keeps a band that ran to the bottom edge running to the new bottom edge (b26\'s sea)', async () => {
    const poster = write('sea', { document: { width: 1080, height: 1350 }, layers: [
      { id: 'sky', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#0E2A27' },
      { id: 'sea', type: 'rect', z: 1, x: 0, y: 860, width: 1080, height: 490, fill: '#143833' },
      { id: 'moon', type: 'ellipse', z: 0, x: 390, y: 640, width: 300, height: 300, fill: '#D9E4D8' },
      { id: 'title', type: 'text', z: 2, x: 90, y: 180, width: 900, height: 280, content: { type: 'plain', value: 'The Salt Orchard' }, style: { font_family: 'Fraunces', font_size: 132, text_align: 'center' } },
    ] });
    const r = await reframe({ design_path: poster, aspect: '9:16' });
    const sea = (load(String(r['design_path'])).layers ?? []).find(l => l.id === 'sea') as unknown as { y: number; height: number; width: number };
    expect(sea.width).toBe(1080);
    expect(sea.y + sea.height).toBe(1920);
  });

  it('carries a camera page whole and moves its world with it', async () => {
    const cam = write('cam', { world: { x: 0, y: 0, width: 3840, height: 1080 }, layers: [
      { id: 'a', type: 'rect', z: 1, x: 200, y: 300, width: 400, height: 400, fill: '#111' },
      { id: 'b', type: 'rect', z: 1, x: 2400, y: 300, width: 400, height: 400, fill: '#111' },
    ] });
    const r = await reframe({ design_path: cam, aspect: '1:1' });
    expect(JSON.stringify(r['progress'])).toMatch(/carried whole/);
    expect((load(String(r['design_path'])) as unknown as { world: object }).world).toEqual({ x: 0, y: 236, width: 2160, height: 608 });
  });
});
