import { describe, it, expect } from 'vitest';
import { MOOD_BANK, pickMood, pickMoodVariant, seededMood, proceduralBgStyle, pickSecLayout, isDarkHex, type Mood } from './mood-bank';

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

  it('pickMoodVariant gives N DISTINCT options for one topic (variant 0 == the apt default)', () => {
    const topic = 'the future of artificial intelligence';
    expect(pickMoodVariant(topic, topic, 0)).toEqual(pickMood(topic, topic)); // 0 = unchanged default
    // 8 options → at least 6 distinct palettes (a couple may coincide as it wraps the bank)
    const bgs = new Set(Array.from({ length: 8 }, (_, i) => pickMoodVariant(topic, topic, i).bg));
    expect(bgs.size).toBeGreaterThanOrEqual(6);
    // deterministic — option 3 is always the same mood
    expect(pickMoodVariant(topic, topic, 3)).toEqual(pickMoodVariant(topic, topic, 3));
    // every variant is a complete mood
    expect(pickMoodVariant(topic, topic, 5).font.length).toBeGreaterThan(0);
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
    const parts = r.split(' + ');
    expect(parts.length).toBeGreaterThanOrEqual(2);          // base + grain minimum (a FLAT canvas is a valid outcome)
    expect(parts[parts.length - 1]).toBe('grain');           // grain is always the floor layer
  });
  it('flat canvases occur but sweeps still appear across many topics', () => {
    const seeds = Array.from({ length: 80 }, (_, i) => `subject ${i} edition ${(i * 5) % 9}`);
    const recipes = seeds.map((s, i) => proceduralBgStyle(s, i % 2 === 0));
    const flat = recipes.filter(r => r.split(' + ').length === 2).length;   // base + grain only
    expect(flat).toBeGreaterThan(0);              // some canvases are clean/flat now
    expect(flat).toBeLessThan(seeds.length);      // but not all — sweeps still happen
  });
  it('two different topics in the same colour mood get different geometry', () => {
    // both space topics → same navy mood, but procedural geometry differs across a set
    const dark = true;
    const seeds = ['the race to explore mars', 'the physics of black holes', 'voyager and the outer planets', 'mapping the cosmic web', 'a short history of rocketry'];
    expect(new Set(seeds.map(s => proceduralBgStyle(s, dark))).size).toBeGreaterThan(1);
  });
  it('isDarkHex distinguishes dark from light canvases', () => {
    expect(isDarkHex('#0A0A0A')).toBe(true);
    expect(isDarkHex('#FAF5EC')).toBe(false);
  });
});

describe('pickSecLayout — structural variety decorrelated from colour', () => {
  it('is deterministic per seed and returns a complete variant', () => {
    expect(pickSecLayout('the future of solar energy')).toEqual(pickSecLayout('the future of solar energy'));
    const v = pickSecLayout('jazz history');
    expect(['left', 'center']).toContain(v.align);
    expect([2, 4]).toContain(v.statCols);
    expect(['plain', 'band']).toContain(v.header);
    expect(['accent', 'ink']).toContain(v.bandTone);
  });
  it('both alignments AND both stat layouts appear across many topics', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `topic number ${i} about ${(i * 5) % 7}`);
    const aligns = new Set(seeds.map(s => pickSecLayout(s).align));
    const cols = new Set(seeds.map(s => pickSecLayout(s).statCols));
    expect(aligns.size).toBe(2);   // not every poster is left-anchored
    expect(cols.size).toBe(2);     // not every stat block is the same row
  });
  it('a masthead band appears for some seeds but not most (it is the minority cue)', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `subject ${i} variation ${(i * 3) % 11}`);
    const headers = seeds.map(s => pickSecLayout(s).header);
    const bands = headers.filter(h => h === 'band').length;
    expect(bands).toBeGreaterThan(0);              // the band archetype does fire
    expect(bands).toBeLessThan(seeds.length / 2);  // but the plain masthead stays the default
    expect(new Set(seeds.map(s => pickSecLayout(s).bandTone)).size).toBe(2); // both tones occur
  });
});
