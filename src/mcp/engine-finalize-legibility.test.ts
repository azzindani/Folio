import { describe, it, expect } from 'vitest';
import { fixCapsTracking } from './engine-finalize-legibility';
import type { Layer } from '../schema/types';

const txt = (style: Record<string, unknown>, value = 'NEW ARRIVALS'): Layer =>
  ({ id: 't', type: 'text', content: { value }, style } as unknown as Layer);

describe('fixCapsTracking', () => {
  it('adds ~0.06em tracking to ALL-CAPS text with none', () => {
    const layers = [txt({ font_size: 40 })];
    expect(fixCapsTracking(layers)).toBe(1);
    expect((layers[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(2); // round(40*0.06)
  });

  it('respects text_transform:uppercase even on a lowercase value', () => {
    const layers = [txt({ font_size: 50, text_transform: 'uppercase' }, 'new arrivals')];
    expect(fixCapsTracking(layers)).toBe(1);
    expect((layers[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(3);
  });

  it('floors at 1px for small caps', () => {
    const layers = [txt({ font_size: 12 })];
    fixCapsTracking(layers);
    expect((layers[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(1);
  });

  it('never overrides tracking the model already set', () => {
    const layers = [txt({ font_size: 40, letter_spacing: 5 })];
    expect(fixCapsTracking(layers)).toBe(0);
    expect((layers[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(5);
  });

  it('keeps tighter tracking the model chose — negative and zero are decisions too', () => {
    // r1 benchmark: -3 on a 160px headline became +10px, and the headline wrapped
    // to three lines into the artwork. Same at text size: a set value stays.
    const layers = [txt({ font_size: 40, letter_spacing: -3 }), txt({ font_size: 40, letter_spacing: 0 })];
    expect(fixCapsTracking(layers)).toBe(0);
    expect(layers.map(l => (l as { style: { letter_spacing: number } }).style.letter_spacing)).toEqual([-3, 0]);
  });

  it('leaves display caps alone, judged against the canvas', () => {
    expect(fixCapsTracking([txt({ font_size: 160 })], 1080)).toBe(0);
    expect(fixCapsTracking([txt({ font_size: 72 })])).toBe(0);
    // 150px is display on a 1080 canvas, body copy on a 3508px A3.
    expect(fixCapsTracking([txt({ font_size: 150 })], 1080)).toBe(0);
    const a3 = [txt({ font_size: 150 })];
    expect(fixCapsTracking(a3, 3508)).toBe(1);
    expect((a3[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(9);
  });

  it('leaves mixed-case + short text untouched', () => {
    expect(fixCapsTracking([txt({ font_size: 40 }, 'New Arrivals')])).toBe(0);
    expect(fixCapsTracking([txt({ font_size: 40 }, 'OK')])).toBe(0);
  });

  it('recurses into groups', () => {
    const layers = [{ id: 'g', type: 'group', layers: [txt({ font_size: 48 })] }] as unknown as Layer[];
    expect(fixCapsTracking(layers)).toBe(1);
  });
});
