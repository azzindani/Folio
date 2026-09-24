import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { safeAreaFindings } from './diagnose-safe';
import { collectFindings } from './diagnose-collect';

const doc = (w: number, h: number): DesignSpec => ({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: w, height: h } } as unknown as DesignSpec);
const words = (id: string, x: number, y: number, value = 'Read me', extra: object = {}): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: 600, height: 80, content: { type: 'plain', value }, style: { font_size: 60, color: '#111111' }, ...extra } as unknown as Layer);
const ground = (w: number, h: number): Layer => ({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: w, height: h, fill: '#FAF5EC' } as unknown as Layer);
const found = (spec: DesignSpec, layers: Layer[], code: string): string[] =>
  safeAreaFindings(spec, [ground(spec.document.width, spec.document.height), ...layers]).filter(f => f.code === code).map(f => f.layer_id ?? '');

describe('safe areas on a vertical feed (9:16)', () => {
  const tall = doc(1080, 1920);

  it('flags words under the header, the caption band and the button column — and not the middle', () => {
    const layers = [words('head', 120, 120), words('mid', 120, 900), words('cta', 120, 1600), words('side', 920, 1000, 'Tap')];
    expect(found(tall, layers, 'safe_area').sort()).toEqual(['cta', 'head', 'side']);
    // Each comes with the shortest move out of its zone: the caption band up, the button column left.
    const call = (id: string): Record<string, unknown> | undefined =>
      safeAreaFindings(tall, [ground(1080, 1920), ...layers]).find(f => f.code === 'safe_area' && f.layer_id === id)?.call?.params;
    expect(call('cta')).toMatchObject({ op: 'move', layer_id: 'cta', dx: 0 });
    expect(Number(call('cta')?.['dy'])).toBeLessThan(-160);
    expect(call('side')).toMatchObject({ op: 'move', layer_id: 'side', dy: 0 });
    expect(Number(call('side')?.['dx'])).toBeLessThan(-20);
  });

  it('scales the zones to the canvas, and leaves other shapes alone', () => {
    expect(found(doc(720, 1280), [words('head', 60, 80)], 'safe_area')).toEqual(['head']);
    expect(found(doc(1080, 1350), [words('head', 120, 120)], 'safe_area')).toEqual([]);
  });

  it('judges a moving page where each shot rests — a line that slides into the caption band', () => {
    const slide = { animation: { keyframes: [{ t: 0, y: 0, easing: 'linear' }, { t: 800, y: 900 }], playback: { duration: 800, origin: 'offset' } } };
    const f = safeAreaFindings(tall, [ground(1080, 1920), words('line', 120, 700, 'Read me', slide)]);
    expect(f.map(x => x.code)).toEqual(['safe_area']);
    expect(f[0]?.message).toContain('at 799 ms');
  });
});

describe('title-safe margin', () => {
  const square = doc(1080, 1080);

  it('reads the ink, not the box: a short line in a full-width box is not at the right edge', () => {
    expect(found(square, [words('left', 20, 400)], 'title_safe')).toEqual(['left']);
    const nudge = safeAreaFindings(square, [ground(1080, 1080), words('left', 20, 400)]).find(f => f.code === 'title_safe')?.call;
    expect(nudge?.tool).toBe('edit_layer');
    expect(nudge?.params).toMatchObject({ op: 'move', layer_id: 'left', dy: 0 });
    expect(Number(nudge?.params['dx'])).toBeGreaterThan(0);
    expect(found(square, [words('wide', 100, 400, 'Short', { width: 980 })], 'title_safe')).toEqual([]);
  });

  it('judges the gap as it is said: under a pixel inside is not "64 px … inside the 64 px margin" (r8 footer)', () => {
    const a3 = doc(1600, 2263);
    const footer = (y: number): Layer => words('footer', 80, y, 'All times are start times  ·  the programme may change on the day',
      { width: 1440, height: 36, style: { font_family: 'Archivo', font_size: 26, font_weight: 500, color: '#7A6B55' } });
    expect(found(a3, [footer(2168)], 'title_safe')).toEqual([]);
    expect(found(a3, [footer(2178)], 'title_safe')).toEqual(['footer']);
  });

  it('replaces the critic\'s left-edge note in diagnose', () => {
    const spec = { ...square, layers: [ground(1080, 1080), words('left', 10, 400)] } as unknown as DesignSpec;
    const f = collectFindings(spec, '/nowhere/d.design.yaml');
    expect(f.some(x => x.code === 'title_safe')).toBe(true);
    expect(f.some(x => /crowds the edge/.test(x.message))).toBe(false);
  });
});

describe('one move settles every edge check', () => {
  it('moves a text off a 9:16 edge inside the canvas, the margin and clear of the feed in one call (A6, live)', () => {
    const tall = doc(1080, 1920);
    const note = { ...words('note', 900, 1300, 'Through Sunday'), width: 400, height: 56, style: { font_family: 'Archivo', font_size: 40, color: '#111111' } } as unknown as Layer;
    const layers = [ground(1080, 1920), note];
    const off = collectFindings({ ...tall, layers } as DesignSpec, '/dev/null').find(f => f.code === 'off_canvas' && f.layer_id === 'note');
    const p = off?.call?.params as { dx: number; dy: number } | undefined;
    expect(p).toBeTruthy();
    const moved = { ...note, x: 900 + (p?.dx ?? 0), y: 1300 + (p?.dy ?? 0) } as unknown as Layer;
    const left = collectFindings({ ...tall, layers: [ground(1080, 1920), moved] } as DesignSpec, '/dev/null')
      .filter(f => f.layer_id === 'note' && ['off_canvas', 'title_safe', 'safe_area'].includes(f.code));
    expect(left).toEqual([]);
  });

  it('moves words out of the caption band without landing them under the buttons', () => {
    const tall = doc(1080, 1920);
    const tap = words('tap', 680, 1480, 'Tap to read');
    const f = found(tall, [tap], 'safe_area');
    expect(f).toEqual(['tap']);
    const p = safeAreaFindings(tall, [ground(1080, 1920), tap]).find(x => x.code === 'safe_area')?.call?.params as { dx: number; dy: number };
    const moved = { ...tap, x: 680 + p.dx, y: 1480 + p.dy } as unknown as Layer;
    expect(safeAreaFindings(tall, [ground(1080, 1920), moved]).filter(x => x.code === 'safe_area' || x.code === 'title_safe')).toEqual([]);
  });

  it('keeps a plain 16:9 move to the title-safe margin, not a feed\'s', () => {
    const wide = doc(1920, 1080);
    const note = { ...words('note', 1700, 500, 'Through Sunday'), width: 400, height: 56, style: { font_family: 'Archivo', font_size: 40 } } as unknown as Layer;
    const off = collectFindings({ ...wide, layers: [ground(1920, 1080), note] } as DesignSpec, '/dev/null').find(f => f.code === 'off_canvas');
    expect(off?.call?.params).toMatchObject({ dy: 0 });
    expect(Number((off?.call?.params as { dx: number }).dx)).toBeGreaterThanOrEqual(-220);
  });
});
