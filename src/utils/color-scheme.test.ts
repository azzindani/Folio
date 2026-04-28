import { describe, it, expect } from 'vitest';
import { generateScheme, suggestSchemes } from './color-scheme';

const RED = '#ff0000';
const BLUE = '#0000ff';
const WHITE = '#ffffff';
const BLACK = '#000000';

describe('generateScheme — complementary', () => {
  it('returns 2 colors', () => {
    const s = generateScheme(RED, 'complementary');
    expect(s.colors.length).toBe(2);
  });

  it('base is preserved', () => {
    const s = generateScheme(RED, 'complementary');
    expect(s.base).toBe(RED);
    expect(s.type).toBe('complementary');
  });

  it('colors are valid hex strings', () => {
    const s = generateScheme(BLUE, 'complementary');
    s.colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
  });
});

describe('generateScheme — analogous', () => {
  it('returns count colors', () => {
    const s = generateScheme(RED, 'analogous', 3);
    expect(s.colors.length).toBe(3);
  });

  it('defaults to 5 colors', () => {
    expect(generateScheme(RED, 'analogous').colors.length).toBe(5);
  });
});

describe('generateScheme — triadic', () => {
  it('returns 3 colors', () => {
    const s = generateScheme(RED, 'triadic');
    expect(s.colors.length).toBe(3);
  });
});

describe('generateScheme — split-complementary', () => {
  it('returns 3 colors', () => {
    expect(generateScheme(RED, 'split-complementary').colors.length).toBe(3);
  });
});

describe('generateScheme — tetradic', () => {
  it('returns 4 colors', () => {
    expect(generateScheme(RED, 'tetradic').colors.length).toBe(4);
  });
});

describe('generateScheme — monochromatic', () => {
  it('returns count colors at same hue', () => {
    const s = generateScheme('#336699', 'monochromatic', 4);
    expect(s.colors.length).toBe(4);
  });

  it('handles count=1', () => {
    expect(generateScheme(RED, 'monochromatic', 1).colors.length).toBe(1);
  });
});

describe('generateScheme — edge cases', () => {
  it('handles achromatic color (white)', () => {
    const s = generateScheme(WHITE, 'complementary');
    expect(s.colors.length).toBeGreaterThan(0);
  });

  it('handles achromatic color (black)', () => {
    const s = generateScheme(BLACK, 'triadic');
    expect(s.colors.length).toBe(3);
  });
});

describe('suggestSchemes', () => {
  it('returns 6 schemes (one per type)', () => {
    expect(suggestSchemes(RED)).toHaveLength(6);
  });

  it('each scheme has type and colors', () => {
    suggestSchemes(RED).forEach(s => {
      expect(s.type).toBeTruthy();
      expect(Array.isArray(s.colors)).toBe(true);
      expect(s.colors.length).toBeGreaterThan(0);
    });
  });
});
