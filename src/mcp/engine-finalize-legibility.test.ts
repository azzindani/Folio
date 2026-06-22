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
    const layers = [txt({ font_size: 100, text_transform: 'uppercase' }, 'new arrivals')];
    expect(fixCapsTracking(layers)).toBe(1);
    expect((layers[0] as { style: { letter_spacing: number } }).style.letter_spacing).toBe(6);
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

  it('leaves mixed-case + short text untouched', () => {
    expect(fixCapsTracking([txt({ font_size: 40 }, 'New Arrivals')])).toBe(0);
    expect(fixCapsTracking([txt({ font_size: 40 }, 'OK')])).toBe(0);
  });

  it('recurses into groups', () => {
    const layers = [{ id: 'g', type: 'group', layers: [txt({ font_size: 48 })] }] as unknown as Layer[];
    expect(fixCapsTracking(layers)).toBe(1);
  });
});
