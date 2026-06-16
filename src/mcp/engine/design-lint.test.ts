import { describe, it, expect } from 'vitest';
import { lintComposition, reviewComposition } from './design-lint';
import type { Layer } from '../../schema/types';

const rect = (id: string, z: number, x: number, y: number, w: number, h: number, color: string): Layer =>
  ({ id, type: 'rect', z, x, y, width: w, height: h, fill: { type: 'solid', color } } as unknown as Layer);
const text = (id: string, z: number, x: number, y: number, w: number, h: number, color: string, value = 'Hello'): Layer =>
  ({ id, type: 'text', z, x, y, width: w, height: h, content: { type: 'plain', value }, style: { color, font_family: 'Inter' } } as unknown as Layer);

describe('lintComposition', () => {
  it('flags white-on-white invisible text', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#FFFFFF'), text('t', 10, 96, 100, 800, 60, '#FFFFFF')], 1080, 1080);
    expect(notes.some(n => /invisible|contrast/.test(n))).toBe(true);
  });

  it('flags a white label whose pink chip is too small to cover it', () => {
    const notes = lintComposition([
      rect('bg', 0, 0, 0, 1080, 1080, '#FFFFFF'),
      rect('chip', 5, 72, 394, 180, 36, '#FF2E88'),
      text('label', 10, 76, 394, 440, 36, '#FFFFFF'),
    ], 1080, 1080);
    expect(notes.some(n => n.includes('label'))).toBe(true);
  });

  it('passes a clean dark poster (white text on near-black)', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1350, '#0A0A0A'), text('t', 10, 96, 100, 800, 60, '#FAFAFA')], 1080, 1350);
    expect(notes).toEqual([]);
  });

  it('reads a PATTERN panel as its bg color for contrast (no false invisible-text)', () => {
    const panel = { id: 'panel', type: 'rect', z: 1, x: 0, y: 0, width: 460, height: 800, fill: { type: 'pattern', pattern: 'halftone', fg: '#FAF5EC', bg: '#B8543C' } } as unknown as Layer;
    const label = text('lbl', 2, 80, 300, 300, 200, '#FAF5EC', '04'); // cream on terracotta panel = fine
    const notes = lintComposition([rect('bg', 0, 0, 0, 1200, 800, '#FAF5EC'), panel, label], 1200, 800);
    expect(notes.some(n => n.includes('lbl'))).toBe(false);
  });

  it('flags a missing full-canvas background', () => {
    const notes = lintComposition([text('t', 10, 96, 100, 800, 60, '#111111')], 1080, 1080);
    expect(notes.some(n => /background/.test(n))).toBe(true);
  });

  it('flags an off-canvas layer', () => {
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'), rect('x', 5, 1000, 100, 400, 100, '#FF2E88')], 1080, 1080);
    expect(notes.some(n => /outside the/.test(n))).toBe(true);
  });

  it('flags empty text slots the model never filled (empty-shell guard)', () => {
    // The Flowstate pricing failure: every tier card had value:'' where the price belongs.
    const freePrice = { id: 'free_price', type: 'text', z: 5, x: 80, y: 300, width: 200, height: 50, content: { type: 'plain', value: '' }, style: { color: '#FFFFFF', font_size: 40 } } as unknown as Layer;
    const proPrice = { id: 'pro_price', type: 'text', z: 5, x: 380, y: 300, width: 200, height: 50, content: { type: 'plain', value: '   ' }, style: { color: '#FFFFFF', font_size: 40 } } as unknown as Layer;
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'), freePrice, proPrice], 1080, 1080);
    expect(notes.some(n => /EMPTY|empty shell|never filled/.test(n))).toBe(true);
    expect(notes.some(n => n.includes('free_price') && n.includes('pro_price'))).toBe(true);
  });

  it('finds empty slots nested inside a preset group', () => {
    const group = { id: 'sections_1', type: 'group', z: 2, x: 0, y: 0, width: 1080, height: 1080, layers: [
      { id: 'card_price', type: 'text', z: 1, x: 80, y: 300, width: 200, height: 50, content: { type: 'plain', value: '' }, style: { color: '#FFF', font_size: 36 } },
    ] } as unknown as Layer;
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'), group], 1080, 1080);
    expect(notes.some(n => n.includes('card_price'))).toBe(true);
  });

  it('does NOT flag a sizeless empty text (incidental, not a display slot)', () => {
    const t = { id: 'spacer', type: 'text', z: 5, x: 80, y: 300, width: 200, height: 10, content: { type: 'plain', value: '' }, style: { color: '#FFF' } } as unknown as Layer;
    const notes = lintComposition([rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'), t], 1080, 1080);
    expect(notes.some(n => /EMPTY|never filled/.test(n))).toBe(false);
  });

  it('does not flag text correctly sitting on a contrasting chip', () => {
    const notes = lintComposition([
      rect('bg', 0, 0, 0, 1080, 1080, '#0A0A0A'),
      rect('chip', 5, 80, 80, 400, 80, '#FF2E88'),
      text('label', 10, 96, 100, 360, 40, '#0A0A0A'),
    ], 1080, 1080);
    expect(notes).toEqual([]);
  });
});

const txt = (id: string, z: number, x: number, y: number, w: number, h: number, size: number, color = '#222222', value = 'Lorem ipsum dolor'): Layer =>
  ({ id, type: 'text', z, x, y, width: w, height: h, content: { type: 'plain', value }, style: { color, font_size: size, font_family: 'Inter' } } as unknown as Layer);

describe('reviewComposition (quality critic)', () => {
  it('flags weak hierarchy when the largest text barely beats the body', () => {
    const notes = reviewComposition([
      txt('h', 10, 72, 80, 900, 40, 30), txt('a', 11, 72, 160, 900, 30, 24),
      txt('b', 12, 72, 220, 900, 30, 22), txt('c', 13, 72, 280, 900, 30, 20),
    ], 1080, 1350);
    expect(notes.some(n => /weak hierarchy/.test(n))).toBe(true);
  });

  it('passes a strong hierarchy (big headline over small body)', () => {
    const notes = reviewComposition([
      txt('h', 10, 72, 80, 900, 120, 96), txt('a', 11, 72, 260, 900, 30, 24),
      txt('b', 12, 72, 320, 900, 30, 22), txt('c', 13, 72, 380, 900, 30, 20),
    ], 1080, 1350);
    expect(notes.some(n => /weak hierarchy/.test(n))).toBe(false);
  });

  it('flags accent sprawl (too many vivid colors)', () => {
    const notes = reviewComposition([
      txt('h', 10, 72, 80, 900, 120, 96, '#E0307E'), txt('a', 11, 72, 260, 900, 30, 24, '#1E8E3E'),
      txt('b', 12, 72, 320, 900, 30, 22, '#1A73E8'), txt('c', 13, 72, 380, 900, 30, 20, '#F9AB00'),
    ], 1080, 1350);
    expect(notes.some(n => /accent sprawl/.test(n))).toBe(true);
  });

  it('flags text crowding the left edge', () => {
    const notes = reviewComposition([
      txt('h', 10, 8, 80, 700, 120, 96), txt('a', 11, 8, 260, 700, 30, 24), txt('b', 12, 8, 320, 700, 30, 22),
    ], 1080, 1350);
    expect(notes.some(n => /crowds the edge/.test(n))).toBe(true);
  });
});
