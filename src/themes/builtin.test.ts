import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES } from './builtin';

describe('BUILTIN_THEMES', () => {
  it('exports the original 3 themes plus catalog additions', () => {
    const keys = Object.keys(BUILTIN_THEMES);
    for (const id of ['dark-tech', 'light-clean', 'ocean-blue']) {
      expect(keys).toContain(id);
    }
    // Catalog additions
    for (const id of ['neon-bloom', 'indigo-pro', 'sunset-glow', 'mono-print', 'forest-deep']) {
      expect(keys).toContain(id);
    }
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has correct protocol', (id) => {
    expect(BUILTIN_THEMES[id]._protocol).toBe('theme/v1');
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has all required color tokens', (id) => {
    const { colors } = BUILTIN_THEMES[id];
    for (const key of ['background', 'surface', 'primary', 'secondary', 'text', 'text_muted', 'border']) {
      expect(colors).toHaveProperty(key);
      expect(typeof colors[key as keyof typeof colors]).toBe('string');
    }
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has typography scale with all levels', (id) => {
    const { scale } = BUILTIN_THEMES[id].typography;
    for (const level of ['display', 'h1', 'h2', 'h3', 'body', 'caption', 'label']) {
      expect(scale).toHaveProperty(level);
    }
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has font families', (id) => {
    const { families } = BUILTIN_THEMES[id].typography;
    expect(families.heading).toBeTruthy();
    expect(families.body).toBeTruthy();
    expect(families.mono).toBeTruthy();
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has spacing scale', (id) => {
    const { spacing } = BUILTIN_THEMES[id];
    expect(spacing.unit).toBe(8);
    expect(Array.isArray(spacing.scale)).toBe(true);
    expect(spacing.scale.length).toBeGreaterThan(0);
  });

  it.each(['dark-tech', 'light-clean', 'ocean-blue'])('%s has radii tokens', (id) => {
    const { radii } = BUILTIN_THEMES[id];
    for (const key of ['sm', 'md', 'lg', 'xl', 'full']) {
      expect(radii).toHaveProperty(key);
    }
  });

  it('dark-tech has dark background', () => {
    const bg = BUILTIN_THEMES['dark-tech'].colors.background as string;
    expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
    const r = parseInt(bg.slice(1, 3), 16);
    expect(r).toBeLessThan(80);
  });

  it('light-clean has light background', () => {
    const bg = BUILTIN_THEMES['light-clean'].colors.background as string;
    const r = parseInt(bg.slice(1, 3), 16);
    expect(r).toBeGreaterThan(200);
  });

  it('each theme has a heading/body/mono families triple', () => {
    for (const id of Object.keys(BUILTIN_THEMES)) {
      const f = BUILTIN_THEMES[id].typography.families;
      expect(typeof f.heading).toBe('string'); expect(f.heading.length).toBeGreaterThan(0);
      expect(typeof f.body).toBe('string');    expect(f.body.length).toBeGreaterThan(0);
      expect(typeof f.mono).toBe('string');    expect(f.mono.length).toBeGreaterThan(0);
    }
  });

  it('themes have differentiated typography (not all identical)', () => {
    // Reason: the original SHARED_TYPOGRAPHY made every theme render in
    // Inter — switching themes never changed fonts. Each theme now
    // declares its own family triple. This guards against accidentally
    // collapsing them back to a single shared constant.
    const keys = Object.keys(BUILTIN_THEMES);
    const triples = keys.map(k => JSON.stringify(BUILTIN_THEMES[k].typography.families));
    const unique = new Set(triples);
    expect(unique.size).toBeGreaterThan(1);
  });
});
