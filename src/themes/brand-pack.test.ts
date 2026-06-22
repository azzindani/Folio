import { describe, it, expect } from 'vitest';
import { BRAND_THEMES } from './brand-pack';
import { BUILTIN_THEMES } from './builtin';

const lum = (h: string): number => {
  const p = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(p(1)) + 0.7152 * f(p(3)) + 0.0722 * f(p(5));
};
const contrast = (a: string, b: string): number => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe('brand-pack (DESIGN.md → ThemeSpec import)', () => {
  const ids = Object.keys(BRAND_THEMES);

  it('imported a curated set of brand themes', () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids).toEqual(expect.arrayContaining(['apple', 'stripe', 'spotify', 'nike', 'linear']));
  });

  it('every brand theme is well-formed + merged into BUILTIN_THEMES', () => {
    for (const id of ids) {
      const t = BRAND_THEMES[id];
      expect(t._protocol, id).toBe('theme/v1');
      expect(t.name, id).toMatch(/\(inspired\)$/);
      for (const role of ['background', 'surface', 'primary', 'text', 'text_muted', 'border'] as const) {
        expect(t.colors[role], `${id}.${role}`).toMatch(/^#[0-9A-F]{6}$/i);
      }
      expect(t.typography.families.heading, id).toBeTruthy();
      expect(t.typography.scale.body.size, id).toBeGreaterThan(0);
      expect(BUILTIN_THEMES[id], `${id} in BUILTIN_THEMES`).toBe(t);
    }
  });

  it('carries the A3 brand-character fields', () => {
    for (const id of ids) {
      expect(BRAND_THEMES[id].atmosphere, id).toBeTruthy();
      expect(BRAND_THEMES[id].section_rhythm, id).toBeTruthy();
      expect(Array.isArray(BRAND_THEMES[id].type_ladder), id).toBe(true);
    }
  });

  it('text + muted stay readable on the background (no broken contrast)', () => {
    for (const id of ids) {
      const c = BRAND_THEMES[id].colors as Record<string, string>;
      expect(contrast(c.text, c.background), `${id} text/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.text_muted, c.background), `${id} muted/bg`).toBeGreaterThanOrEqual(2.6);
    }
  });

  it('preserves authentic brand accents', () => {
    expect(BRAND_THEMES.apple.colors.primary).toBe('#0071E3');
    expect(BRAND_THEMES.spotify.colors.primary).toBe('#1ED760');
    expect(BRAND_THEMES.nike.colors.primary).toBe('#D30005');
    expect((BRAND_THEMES.spotify.colors.background as string)).toBe('#121212'); // dark theme
  });
});
