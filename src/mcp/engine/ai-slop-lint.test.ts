import { describe, it, expect } from 'vitest';
import { lintAiSlop } from './ai-slop-lint';
import type { Layer } from '../../schema/types';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const txt = (id: string, value: string, style: Record<string, unknown> = {}): Layer =>
  L({ id, type: 'text', content: { value }, style });

describe('lintAiSlop', () => {
  it('flags default Tailwind indigo as accent', () => {
    const notes = lintAiSlop([L({ id: 'cta', type: 'rect', fill: '#6366f1' })]);
    expect(notes.join(' ')).toMatch(/indigo/i);
  });

  it('flags a two-stop purple→blue trust gradient', () => {
    const notes = lintAiSlop([L({
      id: 'hero', type: 'rect',
      fill: { type: 'linear', stops: [{ color: '#7c3aed', position: 0 }, { color: '#2563eb', position: 100 }] },
    })]);
    expect(notes.join(' ')).toMatch(/trust.+gradient|gradient cliché/i);
  });

  it('does NOT flag a tonal one-hue gradient', () => {
    const notes = lintAiSlop([L({
      id: 'warm', type: 'rect',
      fill: { type: 'linear', stops: [{ color: '#F59E0B', position: 0 }, { color: '#92400E', position: 100 }] },
    })]);
    expect(notes.join(' ')).not.toMatch(/gradient/i);
  });

  it('flags emoji used as an icon', () => {
    const notes = lintAiSlop([txt('ico', '🚀')]);
    expect(notes.join(' ')).toMatch(/emoji/i);
  });

  it('does NOT flag emoji embedded in real copy', () => {
    const notes = lintAiSlop([txt('h', 'Ship faster 🚀 every week')]);
    expect(notes.join(' ')).not.toMatch(/emoji/i);
  });

  it('flags invented metrics', () => {
    expect(lintAiSlop([txt('m', '10× faster')]).join(' ')).toMatch(/invented metric/i);
    expect(lintAiSlop([txt('m', '99.9% uptime')]).join(' ')).toMatch(/invented metric/i);
  });

  it('flags filler copy', () => {
    expect(lintAiSlop([txt('f', 'Lorem ipsum dolor sit amet')]).join(' ')).toMatch(/filler/i);
    expect(lintAiSlop([txt('f', 'Feature one')]).join(' ')).toMatch(/filler/i);
  });

  it('flags ALL-CAPS without tracking, not with it', () => {
    expect(lintAiSlop([txt('u', 'NEW ARRIVALS', { font_size: 40 })]).join(' ')).toMatch(/caps/i);
    expect(lintAiSlop([txt('u', 'NEW ARRIVALS', { font_size: 40, letter_spacing: 3 })]).join(' ')).not.toMatch(/caps/i);
  });

  it('flags accent overuse across many layers', () => {
    const layers = Array.from({ length: 7 }, (_, i) => L({ id: `r${i}`, type: 'rect', fill: '#E11D48' }));
    expect(lintAiSlop(layers).join(' ')).toMatch(/accent hue appears/i);
  });

  it('recurses into groups', () => {
    const notes = lintAiSlop([L({ id: 'g', type: 'group', layers: [txt('ico', '✨')] })]);
    expect(notes.join(' ')).toMatch(/emoji/i);
  });

  it('a clean restrained design produces no notes', () => {
    const notes = lintAiSlop([
      L({ id: 'bg', type: 'rect', fill: '#0E1621' }),
      txt('h1', 'Quarterly Review', { font_size: 64, color: '#F5F5F5' }),
      txt('sub', 'Operations · 2026', { font_size: 20, color: '#9CA3AF' }),
    ]);
    expect(notes).toEqual([]);
  });
});
