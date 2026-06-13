import { describe, it, expect } from 'vitest';
import { MOOD_BANK, pickMood, seededMood, proceduralBgStyle, isDarkHex, type Mood } from './mood-bank';

describe('mood-bank — 20 distinct styles (color + geometric recipe + font)', () => {
  it('has 20 styles, each fully specified', () => {
    expect(MOOD_BANK.length).toBe(20);
    const treatments = new Set(['rule', 'highlight', 'underline', 'mega', 'rotate']);
    for (const m of MOOD_BANK) {
      expect(m.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(m.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(m.palette.length).toBeGreaterThanOrEqual(3);
      expect(m.font.length).toBeGreaterThan(0);
      expect(m.bg_style).toContain('grain'); // the texture floor on every style
      expect(treatments.has(m.headline)).toBe(true); // a valid title treatment
    }
  });

  it('the title treatments are spread across the bank (not one default)', () => {
    const used = new Set(MOOD_BANK.map(m => m.headline));
    expect(used.size).toBeGreaterThanOrEqual(4); // at least 4 of the 5 treatments in play
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

describe('proceduralBgStyle — 100+ distinct backgrounds from the bg_style grammar', () => {
  it('generates well over 100 distinct recipes across varied seeds', () => {
    const seeds = Array.from({ length: 600 }, (_, i) => `topic number ${i} about ${(i * 7) % 13} things`);
    const set = new Set(seeds.map((s, i) => proceduralBgStyle(s, i % 2 === 0)));
    expect(set.size).toBeGreaterThan(100);
  });
  it('is deterministic per seed and always carries a base + grain texture floor', () => {
    expect(proceduralBgStyle('mars exploration', true)).toBe(proceduralBgStyle('mars exploration', true));
    const r = proceduralBgStyle('mars exploration', true);
    expect(r).toContain('grain');
    expect(r.split(' + ').length).toBeGreaterThanOrEqual(3); // base + sweep + pattern + grain
  });
  it('two different topics in the same colour mood get different geometry', () => {
    // both space topics → same navy mood, but procedural geometry differs
    const dark = true;
    expect(proceduralBgStyle('the race to explore mars', dark)).not.toBe(proceduralBgStyle('the physics of black holes', dark));
  });
  it('isDarkHex distinguishes dark from light canvases', () => {
    expect(isDarkHex('#0A0A0A')).toBe(true);
    expect(isDarkHex('#FAF5EC')).toBe(false);
  });
});
