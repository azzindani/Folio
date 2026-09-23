import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import { readingTimes, readingNotes } from './layout-reading';
import { reviewMotionPage } from './layout-review-motion';

const W = 1920, H = 1080;
const fadeIn = (delay: number): object =>
  ({ keyframes: [{ t: 0, opacity: 0 }, { t: 200, opacity: 1 }], playback: { duration: 200, delay, origin: 'offset', easing: 'linear' } });
const text = (id: string, value: string, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 5, x: 100, y: 100, width: 1600, height: 120, content: { type: 'plain', value }, style: { font_size: 48, color: '#111111' }, ...extra }) as unknown as Layer;
const TWELVE = 'Air keeps the heap working and stops the smell, once a week.';

describe('readingTimes', () => {
  it('times each text by its longest stretch on screen, against its words', () => {
    const late = text('late', TWELVE, { animation: fadeIn(5400) });
    const whole = text('whole', TWELVE, { y: 400 });
    const r = readingTimes([late, whole], 6000, W, H);
    const byId = Object.fromEntries(r.map(x => [x.id, x]));
    expect(byId['late']?.needs_ms).toBe(3000);
    expect(byId['late']?.on_ms ?? 0).toBeLessThan(800);
    expect(byId['whole']?.on_ms).toBe(6000);
    const notes = readingNotes(r);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^"late" is on screen 0\.\d s at most but carries 12 words \(~3\.0 s to read\)\.$/);
  });

  it('leaves out labels, split letters, monospace, and text that never reaches the canvas', () => {
    const r = readingTimes([
      text('kicker', 'STAGE TWO', { animation: fadeIn(5900) }),
      text('c1', 'A few words here', { split_of: 'title', animation: fadeIn(5900) }),
      text('code', 'npm run build now please', { style: { font_size: 24, font_family: 'JetBrains Mono', color: '#111' }, animation: fadeIn(5900) }),
      text('away', TWELVE, { x: 4000 }),
    ], 6000, W, H);
    expect(r.map(x => x.id)).toEqual(['away']);
    expect(readingNotes(r)).toEqual([]);
  });
});

describe('the motion review times each text (rendered)', () => {
  it('names a line that arrives too late to read in a held scene', () => {
    const layers = [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#FAFAFA' } } as unknown as Layer,
      text('late', TWELVE, { animation: fadeIn(5400) }),
    ];
    const spec = { meta: { name: 't', version: '1' }, document: { width: W, height: H, unit: 'px' }, pages: [{ id: 'turn', layers, auto_advance: 6000 }] } as unknown as DesignSpec;
    const m = reviewMotionPage(spec, spec.pages?.[0] as Page, layers, '/tmp');
    expect(m?.reading?.map(x => x.id)).toEqual(['late']);
    expect(m?.notes.some(n => n.startsWith('"late" is on screen'))).toBe(true);
  }, 30_000);
});
