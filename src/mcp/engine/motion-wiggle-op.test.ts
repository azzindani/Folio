import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { wiggleMotion } from './motion-wiggle-op';
import { layersAt } from '../../export/gif-frames';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-wiggle-'));
let dPath = '';
let n = 0;
const rise = { keyframes: [{ t: 0, y: 24, opacity: 0 }, { t: 600, y: 0, opacity: 1 }], playback: { duration: 600, origin: 'offset' } };

// A badge that already enters, inside a locked page group — the wiggle must not disturb either.
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
    layers: [{ id: 'page', type: 'group', locked: true, x: 0, y: 0, width: 1080, height: 1080, layers: [
      { id: 'badge', type: 'rect', z: 2, x: 400, y: 400, width: 200, height: 200, fill: '#E4572E', animation: rise },
    ] }],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

type Node = { id: string; type: string; x?: number; width?: number; layers?: Node[]; animation?: { keyframes: Array<Record<string, unknown>>; playback: Record<string, unknown> } };
const load = (): Layer[] => ((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? []) as Layer[];
const wrapper = (): Node | undefined => (load()[0] as unknown as Node).layers?.[0];

describe('animation op:wiggle', () => {
  it('wraps the layer in a looping parent and leaves its own entrance playing', () => {
    const r = wiggleMotion({ design_path: dPath, layer_id: 'badge', amplitude: { x: 10, rotation: 3 } });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const w = wrapper();
    expect(w).toMatchObject({ id: 'badge_wiggle', type: 'group', x: 400, width: 200 });
    expect(w?.animation?.playback).toMatchObject({ loop: true });
    expect(w?.animation?.keyframes.some(k => typeof k['x'] === 'number')).toBe(true);
    expect(w?.layers?.[0]?.animation?.keyframes).toEqual(rise.keyframes);
  });

  it('re-rolls an existing wiggle instead of nesting another', () => {
    wiggleMotion({ design_path: dPath, layer_id: 'badge', amplitude: { x: 10 } });
    const first = wrapper()?.animation?.keyframes;
    wiggleMotion({ design_path: dPath, layer_id: 'badge', amplitude: { x: 10 }, seed: 'again' });
    const w = wrapper();
    expect(w?.id).toBe('badge_wiggle');
    expect(w?.layers?.[0]?.id).toBe('badge');
    expect(w?.animation?.keyframes).not.toEqual(first);
  });

  it('moves in a sampled frame — the flipbook plays the parent', () => {
    wiggleMotion({ design_path: dPath, layer_id: 'badge', amplitude: { x: 40, y: 40 } });
    const frame = layersAt(load(), 700)[0] as unknown as { layers: Array<Record<string, unknown>> };
    expect(String(frame.layers[0]?.['transform'] ?? '')).toMatch(/translate\(/);
  });

  it('refuses a wiggle with no amplitude and leaves the file alone', () => {
    const before = fs.readFileSync(dPath, 'utf8');
    expect(wiggleMotion({ design_path: dPath, layer_id: 'badge' }).success).toBe(false);
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
  });
});
