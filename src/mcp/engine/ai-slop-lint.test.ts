import { describe, it, expect } from 'vitest';
import { lintAiSlop, accentNote } from './ai-slop-lint';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectFindings } from './diagnose-collect';

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

  it('flags an unlabelled metric with nothing on the page to back it', () => {
    expect(lintAiSlop([txt('m', '10× faster')]).join(' ')).toMatch(/unlabelled metric/i);
    expect(lintAiSlop([txt('m', '99.9% uptime')]).join(' ')).toMatch(/unlabelled metric/i);
  });

  it('does NOT flag a figure on a SOURCED page — a cited number is evidence', () => {
    const notes = lintAiSlop([txt('m', '10× faster'), txt('s', 'Source: Air Traffic Cargo, 2026')]);
    expect(notes.join(' ')).not.toMatch(/metric/i);
  });

  it('flags filler copy', () => {
    expect(lintAiSlop([txt('f', 'Lorem ipsum dolor sit amet')]).join(' ')).toMatch(/filler/i);
    expect(lintAiSlop([txt('f', 'Feature one')]).join(' ')).toMatch(/filler/i);
  });

  it('flags ALL-CAPS without tracking, not with it', () => {
    expect(lintAiSlop([txt('u', 'NEW ARRIVALS', { font_size: 40 })]).join(' ')).toMatch(/caps/i);
    expect(lintAiSlop([txt('u', 'NEW ARRIVALS', { font_size: 40, letter_spacing: 3 })]).join(' ')).not.toMatch(/caps/i);
  });

  it('does not ask display caps for tracking — a tight big headline is a choice', () => {
    // r1 benchmark: a 1250px condensed JAZZ on an A3 poster was told to track out.
    expect(lintAiSlop([txt('j', 'JAZZ', { font_size: 1250, letter_spacing: -4 })], 3508).join(' ')).not.toMatch(/caps/i);
    expect(lintAiSlop([txt('h', 'FILL IT WITH ICE.', { font_size: 160, letter_spacing: -3 })], 1080).join(' ')).not.toMatch(/caps/i);
    expect(lintAiSlop([txt('b', 'DOORS AT EIGHT', { font_size: 150 })], 3508).join(' ')).toMatch(/caps/i);
  });

  it('flags accent overuse across many layers', () => {
    const layers = Array.from({ length: 7 }, (_, i) => L({ id: `r${i}`, type: 'rect', x: i * 300, width: 100 + i * 40, height: 60, fill: '#E11D48' }));
    expect(lintAiSlop(layers).join(' ')).toMatch(/accent hue appears/i);
  });

  // benchmark r7 b28: five identical timeline dots and a kicker were counted as six accent uses.
  it('counts a run of siblings drawn alike as ONE accent use — a timeline\'s dots', () => {
    const dots = Array.from({ length: 5 }, (_, i) => L({ id: `dot${i}`, type: 'ellipse', width: 32, height: 32, y: 600 + i * 208, fill: '#C0643B' }));
    const kicker = L({ id: 'kicker', type: 'text', content: { type: 'plain', value: 'OUR CO-OP' }, style: { color: '#C0643B' } });
    expect(lintAiSlop([kicker, ...dots]).join(' ')).not.toMatch(/accent hue appears/i);
  });

  // benchmark r2 b07: two cookies, each with two marks drawn on it, in natural browns.
  it('counts a drawn object — shapes over one another — as one surface, not one per shape', () => {
    const ground = L({ id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1920, fill: '#E8452C' });
    const cookie = (id: string, x: number, fill: string, mark: string): Layer[] => [L({ id, type: 'ellipse', x, y: 700, width: 420, height: 420, fill }),
      L({ id: `${id}f`, type: 'rect', x: x + 90, y: 850, width: 240, height: 14, fill: mark }), L({ id: `${id}g`, type: 'rect', x: x + 90, y: 950, width: 240, height: 14, fill: mark })];
    expect(lintAiSlop([ground, ...cookie('c1', 60, '#D9A066', '#B07A3E'), ...cookie('c2', 560, '#C98B4E', '#9A6430')]).join(' ')).not.toMatch(/accent hue appears/i);
  });

  // benchmark r7 b27: six mint surfaces across four beats, never more than three on screen at once.
  it('judges a moving piece by what is on screen together', () => {
    const mint = (id: string, w: number, opacity = 1): Layer => L({ id, type: 'rect', x: w * 10, width: w, height: 40, fill: '#3DDC97', opacity });
    const every = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => mint(id, 100 + i * 30));
    expect(accentNote(every)).toMatch(/on 6 layers/);
    const beat1 = every.map((l, i) => (i < 3 ? l : mint(l.id, 100 + i * 30, 0)));
    const beat2 = every.map((l, i) => (i >= 3 ? l : { ...l, visible: false } as Layer));
    expect(accentNote(every, [beat1, beat2])).toBeNull();
    expect(accentNote(every, [every])).toMatch(/on 6 layers at once/);
  });

  // benchmark r6 b23: pale discs (#E6F0FA) and idle progress bars (#C9D6E6) counted as brand-blue accents.
  it('does not count pale tints of the accent as accent uses — only colour the eye reads as colour', () => {
    const blue = ['#0057B8', '#0057B8', '#0057B8'].map((c, i) => L({ id: `b${i}`, type: 'rect', x: i * 400, width: 200 + i * 50, height: 80, fill: c }));
    const tints = ['#E6F0FA', '#C9D6E6', '#C9D6E6', '#C9D6E6', '#DCE9F7'].map((c, i) => L({ id: `t${i}`, type: 'rect', fill: c }));
    expect(lintAiSlop([...blue, ...tints]).join(' ')).not.toMatch(/accent hue appears/i);
    const loud = ['#0057B8', '#1E6FD9', '#0A4C9C', '#0057B8', '#2A7DE1', '#0057B8'].map((c, i) => L({ id: `v${i}`, type: 'rect', x: i * 400, width: 200 + i * 50, height: 80, fill: c }));
    expect(lintAiSlop(loud).join(' ')).toMatch(/accent hue appears on 6 layers/i);
  });

  it('counts a chart series as ONE accent use, not one per bar', () => {
    const bars = Array.from({ length: 12 }, (_, i) => L({ id: `bar${i}`, type: 'rect', fill: '#E11D48' }));
    const chart = L({ id: 'chart', type: 'group', layers: bars });
    expect(lintAiSlop([chart]).join(' ')).not.toMatch(/accent hue appears/i);
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

describe('accent as seen, through diagnose', () => {
  // r7 b27 in small: six mint surfaces, three per beat.
  const spec = (layers: object[], moving: boolean): DesignSpec => ({ meta: { id: 'a', name: 'a', type: 'poster' }, document: { width: 1920, height: 1080 },
    ...(moving ? { markers: { one: 0, two: 3000 } } : {}), layers } as unknown as DesignSpec);
  const beat = (at: number, until?: number): object => ({ in: at, ...(until ? { out: until } : {}),
    animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, delay: at, origin: 'offset' } } });
  const mint = (id: string, i: number, extra: object = {}): object => ({ id, type: 'rect', z: 2, x: 100 + i * 290, y: 400, width: 200 + i * 10, height: 80, fill: '#3DDC97', ...extra });
  const accent = (s: DesignSpec): boolean => collectFindings(s, '/dev/null').some(f => f.code === 'ai_slop' && /accent hue appears/.test(f.message));

  it('flags six surfaces on screen together, and not six that take turns', () => {
    const still = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => mint(id, i));
    expect(accent(spec(still, false))).toBe(true);
    const turns = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => mint(id, i, i < 3 ? beat(0, 3000) : beat(3000)));
    expect(accent(spec(turns, true))).toBe(false);
  });
});
