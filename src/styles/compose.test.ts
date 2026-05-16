import { describe, it, expect } from 'vitest';
import { composeTheme } from './compose';
import type { ThemeSpec, PaletteSpec } from '../schema/types';

function makeTheme(): ThemeSpec {
  return {
    _protocol: 'theme/v1',
    name: 'base', version: '1.0.0',
    colors: {
      background: '#000000',
      surface:    '#111111',
      primary:    '#FF0000',
      text:       '#FFFFFF',
    },
    typography: { scale: {}, families: { heading: 'Inter', body: 'Inter', mono: 'Mono' } },
    spacing: { unit: 8, scale: [] },
    effects: { shadow_card: '0 0 0' },
    radii: { md: 8 },
  };
}

function makePalette(colors: Record<string, string>): PaletteSpec {
  return { _protocol: 'palette/v1', id: 'p', name: 'p', version: '1.0.0', colors };
}

describe('composeTheme', () => {
  it('returns the base theme unchanged when no inputs are provided', () => {
    const base = makeTheme();
    const out = composeTheme(base);
    expect(out).toBe(base);
  });

  it('returns base theme unchanged when palette is undefined', () => {
    const base = makeTheme();
    const out = composeTheme(base, {});
    expect(out).toBe(base);
  });

  it('palette colors overlay theme colors', () => {
    const base = makeTheme();
    const palette = makePalette({ primary: '#00FF00', accent: '#FFFF00' });
    const out = composeTheme(base, { palette });
    expect(out.colors.primary).toBe('#00FF00'); // overlaid
    expect(out.colors.accent).toBe('#FFFF00');  // new key
    expect(out.colors.background).toBe('#000000'); // fall-through
  });

  it('does not mutate the base theme', () => {
    const base = makeTheme();
    const snapshot = JSON.stringify(base);
    const palette = makePalette({ primary: '#00FF00' });
    composeTheme(base, { palette });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('preserves non-color theme sections under palette overlay', () => {
    const base = makeTheme();
    const palette = makePalette({ primary: '#00FF00' });
    const out = composeTheme(base, { palette });
    expect(out.typography).toBe(base.typography);
    expect(out.spacing).toBe(base.spacing);
    expect(out.effects).toBe(base.effects);
    expect(out.radii).toBe(base.radii);
  });

  it('empty palette colors object falls through to base', () => {
    const base = makeTheme();
    const palette = makePalette({});
    const out = composeTheme(base, { palette });
    expect(out.colors.primary).toBe('#FF0000');
  });
});
