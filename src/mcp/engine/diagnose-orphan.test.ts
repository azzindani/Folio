// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { orphanFindings } from './diagnose-orphan';

// Benchmark r5, b17 in small: a faint halo behind a clock; the clock leaves at 3 s, a brand line lands below.
const fade = (delay: number, from: number, to: number): object => ({ keyframes: [{ t: 0, opacity: from }, { t: 400, opacity: to }], playback: { duration: 400, delay, origin: 'offset' } });
const halo = (extra: object = {}): object => ({ id: 'halo', type: 'ellipse', z: 1, x: 190, y: 130, width: 700, height: 700, opacity: 0.07, fill: '#FFC857', ...extra });
const clock = { id: 'clock', type: 'group', z: 2, x: 390, y: 330, width: 300, height: 300, out: 3000, animation: fade(0, 0, 1),
  layers: [{ id: 'face', type: 'ellipse', z: 1, x: 390, y: 330, width: 300, height: 300, fill: '#F3E7D6' }] };
const brand = { id: 'brand', type: 'text', z: 3, x: 140, y: 1100, width: 800, height: 160, in: 3000, animation: fade(3000, 0, 1),
  content: { type: 'plain', value: 'FixNow' }, style: { font_family: 'Archivo', font_size: 120 } };
const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1920, fill: '#0E1B2C' };
const spec = (layers: object[]): DesignSpec => ({ meta: { id: 'o', name: 'o', type: 'poster' }, document: { width: 1080, height: 1920 },
  markers: { clock: 0, brand: 3000 }, layers } as unknown as DesignSpec);
const find = (layers: object[]): ReturnType<typeof orphanFindings> => { const s = spec(layers); return orphanFindings(s, s.layers as Layer[]); };

describe('orphanFindings', () => {
  it('names a halo left on after its clock has gone, with the out point that ends it with the clock', () => {
    const [f, ...rest] = find([bg, halo(), clock, brand]);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ code: 'orphan_decoration', layer_id: 'halo', layers: ['halo', 'face'] });
    const out = Number((f?.call?.params as { props: { out: number } }).props.out);
    expect(out).toBeGreaterThanOrEqual(2900);
    expect(out).toBeLessThanOrEqual(3000);
    // Sent as it is, nothing is left framing nothing.
    expect(find([bg, halo({ out }), clock, brand])).toEqual([]);
  });

  it('leaves a moon that rises out from behind the sea — never the sea\'s to hold (r7, b26)', () => {
    const rise = { keyframes: [{ t: 0, y: 0 }, { t: 2800, y: -300, easing: 'ease-out-sine' }], playback: { duration: 2800, delay: 300, origin: 'offset' } };
    const moon = { id: 'moon', type: 'ellipse', z: 1, x: 410, y: 1135, width: 260, height: 260, fill: '#D9E4D8', animation: rise };
    const sea = { id: 'sea', type: 'rect', z: 2, x: 0, y: 1060, width: 1080, height: 860, fill: '#143833' };
    const lowSea = { ...sea, id: 'pool', x: 100, width: 880 };   // not a band: still behind, still not holding it
    const title = { ...brand, id: 'title', y: 300, in: 3400, animation: fade(3400, 0, 1) };   // lands above the horizon, in no one's frame
    const marks = { night: 0, moonrise: 300, title: 3400 };
    const s = { ...spec([bg, moon, sea, title]), markers: marks } as unknown as DesignSpec;
    expect(orphanFindings(s, s.layers as Layer[])).toEqual([]);
    const p = { ...spec([bg, moon, lowSea, title]), markers: marks } as unknown as DesignSpec;
    expect(orphanFindings(p, p.layers as Layer[])).toEqual([]);
  });

  it('leaves a card whose words change, and sprinkles that frame nothing from the start', () => {
    const card = { id: 'card', type: 'rect', z: 1, x: 140, y: 600, width: 800, height: 300, fill: '#1B2A3C' };
    const say = (id: string, inAt: number, outAt?: number): object => ({ id, type: 'text', z: 2, x: 180, y: 680, width: 700, height: 120, in: inAt, ...(outAt ? { out: outAt } : {}),
      animation: fade(inAt, 0, 1), content: { type: 'plain', value: id === 'a' ? 'Before' : 'After' }, style: { font_family: 'Archivo', font_size: 90 } });
    const star = { id: 'star', type: 'ellipse', z: 1, x: 900, y: 300, width: 300, height: 300, opacity: 0.2, fill: '#fff' };
    expect(find([bg, card, say('a', 0, 3000), say('b', 3000), star, brand])).toEqual([]);
  });
});
