import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { morphMotion } from './motion-morph-op';
import type { DesignSpec } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-morph-'));
let dPath = '';
let n = 0;
const SQUARE = 'M 400 400 L 600 400 L 600 600 L 400 600 Z';
const DIAMOND = 'M 500 380 L 620 500 L 500 620 L 380 500 Z';
const fadeIn = { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, origin: 'offset' } };

// A shape that already fades in, and a second outline to become.
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
    layers: [
      { id: 'blob', type: 'path', z: 1, d: SQUARE, fill: '#E4572E', animation: fadeIn },
      { id: 'star', type: 'path', z: 2, d: DIAMOND, fill: '#111111' },
      { id: 'label', type: 'rect', z: 3, x: 0, y: 0, width: 10, height: 10 },
    ],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

type Node = { id: string; d?: string; morph_to?: string; visible?: boolean; animation?: { keyframes: Array<Record<string, number>> } };
const byId = (id: string): Node | undefined => (((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? []) as unknown as Node[]).find(l => l.id === id);

describe('animation op:morph', () => {
  it('turns a path into another layer\'s outline after its entrance, and hides the target', () => {
    const r = morphMotion({ design_path: dPath, layer_id: 'blob', to_layer: 'star', delay: 500, duration: 800 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const blob = byId('blob');
    expect(blob?.morph_to).toBe(DIAMOND);
    const frames = blob?.animation?.keyframes ?? [];
    expect(frames.some(k => typeof k['opacity'] === 'number')).toBe(true); // the fade is still there
    expect(frames.find(k => k['morph'] === 0)?.t).toBe(500);
    expect(frames.find(k => k['morph'] === 1)?.t).toBe(1300);
    expect(byId('star')?.visible).toBe(false);
  });

  it('takes an outline as a string, and keeps a target visible when asked', () => {
    expect(morphMotion({ design_path: dPath, layer_id: 'blob', to: DIAMOND, delay: 500 }).success).toBe(true);
    expect(byId('blob')?.morph_to).toBe(DIAMOND);
    expect(morphMotion({ design_path: dPath, layer_id: 'star', to_layer: 'label' }).success).toBe(false); // a rect has no outline
  });

  it('refuses what it cannot morph, and leaves the file alone', () => {
    const before = fs.readFileSync(dPath, 'utf8');
    expect(morphMotion({ design_path: dPath, layer_id: 'blob', to: 'M 0 0 A 10 10 0 0 1 20 0 Z', delay: 500 }).success).toBe(false);
    expect(morphMotion({ design_path: dPath, layer_id: 'label', to: DIAMOND }).success).toBe(false);
    const overlap = morphMotion({ design_path: dPath, layer_id: 'blob', to: DIAMOND }); // starts during the fade
    expect(overlap.success).toBe(false);
    expect(String(overlap['error'])).toContain('overlap');
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
  });

  // Found building the GPT-6 Astra promo: delay:500 was meant as "after the entrance at 3000",
  // the shape changed before the mark existed, and the reply gave no times to catch it.
  it('replies with the scene time it runs, and warns when that is before the layer\'s own motion', () => {
    const spec = yaml.load(fs.readFileSync(dPath, 'utf8')) as { layers: Array<Record<string, unknown>> };
    const star = spec.layers[1];
    if (star) star['animation'] = { ...fadeIn, playback: { ...fadeIn.playback, delay: 3000 } };
    fs.writeFileSync(dPath, yaml.dump(spec));

    const early = morphMotion({ design_path: dPath, layer_id: 'star', to: SQUARE, delay: 500, duration: 800 });
    expect(early.success, JSON.stringify(early)).toBe(true);
    expect(early).toMatchObject({ from_ms: 500, to_ms: 1300 });
    expect(JSON.stringify(early['progress'])).toMatch(/starts at 3000ms/);

    const onTime = morphMotion({ design_path: dPath, layer_id: 'blob', to: DIAMOND, delay: '700' as unknown as number, duration: 400 });
    expect(onTime).toMatchObject({ from_ms: 700, to_ms: 1100 });
    expect(JSON.stringify(onTime['progress'])).not.toMatch(/Starts before/);
  });
});
