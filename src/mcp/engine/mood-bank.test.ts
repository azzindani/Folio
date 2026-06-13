import { describe, it, expect } from 'vitest';
import { MOOD_BANK, pickMood, seededMood, type Mood } from './mood-bank';

describe('mood-bank — 20 distinct styles (color + geometric recipe + font)', () => {
  it('has 20 styles, each fully specified', () => {
    expect(MOOD_BANK.length).toBe(20);
    for (const m of MOOD_BANK) {
      expect(m.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(m.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(m.palette.length).toBeGreaterThanOrEqual(3);
      expect(m.font.length).toBeGreaterThan(0);
      expect(m.bg_style).toContain('grain'); // the texture floor on every style
    }
  });

  it('the bank is genuinely varied — many distinct fonts, bgs and geometric recipes', () => {
    const fonts = new Set(MOOD_BANK.map(m => m.font));
    const bgs = new Set(MOOD_BANK.map(m => m.bg.toLowerCase()));
    const recipes = new Set(MOOD_BANK.map(m => m.bg_style));
    expect(fonts.size).toBeGreaterThanOrEqual(8);
    expect(bgs.size).toBeGreaterThanOrEqual(16);
    expect(recipes.size).toBeGreaterThanOrEqual(16);
  });

  it('uses NON-circular geometry, not just the radial glow/mesh — most styles carry a hard-edged sweep', () => {
    const geo = /\b(tri|blocks|rings|arcs|diag|wave|shards|grid|crosshatch|diagonal_stripes|scallop)\b/;
    const geoCount = MOOD_BANK.filter(m => geo.test(m.bg_style)).length;
    expect(geoCount).toBeGreaterThanOrEqual(15); // the anti-"AI circle" majority
  });

  it('pickMood returns a complete Mood (lane match) and is deterministic for the tail', () => {
    const ocean = pickMood('deep sea marine life', 'deep sea marine life');
    expect(ocean.bg.toLowerCase()).toBe('#06141b');
    expect(ocean.font.length).toBeGreaterThan(0);
    const a = seededMood('origami cranes'), b = seededMood('origami cranes');
    expect(a).toEqual(b);
    expect((a as Mood).font.length).toBeGreaterThan(0);
  });
});
