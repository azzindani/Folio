import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectFindings } from './diagnose-collect';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: object = {}): Layer =>
  ({ id, type: 'rect', z: 2, x, y, width: w, height: h, fill: '#E4572E', ...extra } as unknown as Layer);
const slide = (dx: number): object => ({ animation: { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: dx }], playback: { duration: 1000, origin: 'offset' } } });
const ground = rect('bg', 0, 0, 1080, 1080, { z: 0, fill: '#FAF5EC' });
const doc = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 } };
const codes = (spec: object, page?: string): Array<{ code: string; page?: string; layer_id?: string }> =>
  collectFindings(spec as DesignSpec, '/nowhere/d.design.yaml', undefined, page).filter(f => f.code.startsWith('motion_'));

describe('diagnose_design on a page that moves', () => {
  const cut = [ground, rect('ice', 100, 100, 100, 100, slide(300)), rect('bottle', 450, 50, 200, 400, { z: 5 })];

  it('reports what the motion cuts into each other at a shot\'s rest — as authored they were apart', () => {
    expect(codes({ ...doc, layers: cut })).toEqual([expect.objectContaining({ code: 'motion_collision', layer_id: 'bottle' })]);
  });

  it('scopes to the page it was found on, and says nothing about a still page', () => {
    const spec = { ...doc, pages: [{ id: 'still', layers: [ground, rect('a', 100, 100, 100, 100)] }, { id: 'moving', layers: cut }] };
    expect(codes(spec).map(f => f.page)).toEqual(['moving']);
    expect(codes(spec, 'still')).toEqual([]);
  });

  it('does not call two lines on one spot a collision when one leaves before the other arrives', () => {
    const line = (id: string, value: string, win: object): object =>
      ({ id, type: 'text', z: 5, x: 80, y: 300, width: 800, height: 90, content: { type: 'plain', value }, style: { font_size: 64 }, ...win });
    const pile = (a: object, b: object): string[] =>
      collectFindings({ ...doc, layers: [ground, line('k1', 'First line here', a), line('k3', 'Second line now', b)] } as unknown as DesignSpec, '/nowhere/d.design.yaml')
        .filter(f => /collision|overlap/.test(f.code)).map(f => f.code);
    expect(pile({ out: 3000 }, { in: 3200 })).toEqual([]);
    // On screen together from 2.0 s to 3.0 s: reported once, where the shot rests — not again as authored.
    expect(pile({ out: 3000 }, { in: 2000 })).toEqual(['motion_overlap']);
    // Where a shot rests on the pair, that is the one report — not a second one as authored.
    const fading = { out: 3000, animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }], playback: { duration: 600, origin: 'offset' } } };
    const both = collectFindings({ ...doc, layers: [ground, line('k1', 'First line here', fading), line('k3', 'Second line now', { in: 200 })] } as unknown as DesignSpec, '/nowhere/d.design.yaml');
    expect(both.filter(f => /collision|overlap/.test(f.code)).map(f => f.code)).toEqual(['motion_overlap']);
  });
});

describe('diagnose_design on how a moving page is paced', () => {
  const text = (id: string, y: number, value: string, extra: object = {}): Layer =>
    ({ id, type: 'text', z: 5, x: 80, y, width: 900, height: 80, content: { type: 'plain', value }, style: { font_size: 48, color: '#111111' }, ...extra } as unknown as Layer);
  const fadeIn = (at: number): object => ({ animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, delay: at, origin: 'offset' } } });
  const found = (layers: Layer[]): string[] => codes({ ...doc, layers: [ground, ...layers] }).map(f => f.code);

  it('says when three sentences land together, and not when they are staggered', () => {
    const lines = (step: number): Layer[] => ['First thing to read', 'Second thing to read', 'Third thing to read here']
      .map((v, i) => text(`l${i}`, 200 + i * 150, v, fadeIn(i * step)));
    expect(found(lines(0))).toContain('motion_crowd');
    expect(found(lines(150))).not.toContain('motion_crowd');
  });

  it('judges a piece that stops as its lines land on that last frame, not on its empty opening', () => {
    // Found live: fades 300–900 ms, nothing after — the lint judged the blank 0–300 ms and called it clean.
    const late = (v: string, i: number): Layer => text(`k${i}`, 200 + i * 150, v, { animation: {
      keyframes: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }], playback: { duration: 600, delay: 300, origin: 'offset' } } });
    const got = found(['Plan the week on Sunday', 'Batch the small tasks', 'Protect two deep blocks'].map(late));
    expect(got).toEqual(expect.arrayContaining(['motion_reading', 'motion_crowd']));
  });

  it('says when words leave before they can be read', () => {
    const brief = text('long', 400, 'A long sentence with far too many words to read in half a second', { out: 900, ...fadeIn(0) });
    expect(found([brief])).toContain('motion_reading');
    // With the call that gives them the time: open the shortfall at their landing.
    const f = collectFindings({ ...doc, layers: [ground, brief] } as unknown as DesignSpec, '/nowhere/d.design.yaml').find(x => x.code === 'motion_reading');
    expect(f?.call?.tool).toBe('animation');
    expect(f?.call?.params).toMatchObject({ op: 'retime' });
    const short = Number(/— (\d+)ms short/.exec(f?.message ?? '')?.[1]);
    const by = Number(f?.call?.params['shift_ms']);
    expect(by).toBeGreaterThanOrEqual(short);
    expect(by % 100).toBe(0);
  });

  it('says when nothing holds still for seconds, and not when a beat lands and rests', () => {
    // Back and forth every 0.8 s; `hold` ms of stillness after the third hop.
    const hops = (hold: number): Layer => {
      const at = [0, 800, 1600, 2400, 2400 + hold, 3200 + hold, 4000 + hold, 4800 + hold];
      const x = [0, 300, 0, 300, 300, 0, 300, 0];
      const keyframes = at.map((t, i) => ({ t, x: x[i] })).filter((k, i) => i !== 4 || hold > 0);
      return rect('hop', 100, 600, 80, 80, { animation: { keyframes, playback: { duration: 4800 + hold, origin: 'offset' } } });
    };
    expect(found([hops(0)])).toContain('motion_restless');
    expect(found([hops(1200)])).not.toContain('motion_restless');
  });
});
