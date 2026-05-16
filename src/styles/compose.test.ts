import { describe, it, expect } from 'vitest';
import { composeTheme } from './compose';
import type { ThemeSpec, PaletteSpec, TypePackSpec, EffectsPackSpec } from '../schema/types';

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

  // ── TypePack overlay ────────────────────────────────────────

  it('typePack families overlay theme.typography.families', () => {
    const base = makeTheme();
    const typePack: TypePackSpec = {
      _protocol: 'type-pack/v1',
      id: 'tp', name: 'tp', version: '1.0.0',
      families: { heading: 'Playfair', display: 'Anton' },
    };
    const out = composeTheme(base, { typePack });
    expect(out.typography.families.heading).toBe('Playfair'); // overlaid
    expect(out.typography.families.body).toBe('Inter');       // fall-through
    expect(out.typography.families.display).toBe('Anton');    // new key
  });

  it('typePack without scale leaves theme.typography.scale intact', () => {
    const base = makeTheme();
    const typePack: TypePackSpec = {
      _protocol: 'type-pack/v1',
      id: 'tp', name: 'tp', version: '1.0.0',
      families: { heading: 'Playfair' },
    };
    const out = composeTheme(base, { typePack });
    expect(out.typography.scale).toBe(base.typography.scale);
  });

  it('typePack with scale overlays theme.typography.scale', () => {
    const base = makeTheme();
    const typePack: TypePackSpec = {
      _protocol: 'type-pack/v1',
      id: 'tp', name: 'tp', version: '1.0.0',
      families: { heading: 'Playfair' },
      scale: { h1: { size: 100, weight: 800, line_height: 1.0 } },
    };
    const out = composeTheme(base, { typePack });
    expect(out.typography.scale.h1).toEqual({ size: 100, weight: 800, line_height: 1.0 });
  });

  // ── EffectsPack overlay ─────────────────────────────────────

  it('effectsPack effects overlay theme.effects', () => {
    const base = makeTheme();
    const effectsPack: EffectsPackSpec = {
      _protocol: 'effects-pack/v1',
      id: 'fx', name: 'fx', version: '1.0.0',
      effects: { shadow_card: '0 8px 32px rgba(0,0,0,0.6)', glow_accent: '0 0 24px #f0f' },
    };
    const out = composeTheme(base, { effectsPack });
    expect(out.effects.shadow_card).toBe('0 8px 32px rgba(0,0,0,0.6)');
    expect(out.effects.glow_accent).toBe('0 0 24px #f0f');
  });

  // ── All three axes combined ─────────────────────────────────

  it('all three primitives compose independently', () => {
    const base = makeTheme();
    const palette = makePalette({ primary: '#00FF00' });
    const typePack: TypePackSpec = {
      _protocol: 'type-pack/v1',
      id: 'tp', name: 'tp', version: '1.0.0',
      families: { heading: 'Playfair' },
    };
    const effectsPack: EffectsPackSpec = {
      _protocol: 'effects-pack/v1',
      id: 'fx', name: 'fx', version: '1.0.0',
      effects: { glow: '0 0 24px #fff' },
    };
    const out = composeTheme(base, { palette, typePack, effectsPack });
    expect(out.colors.primary).toBe('#00FF00');
    expect(out.typography.families.heading).toBe('Playfair');
    expect(out.effects.glow).toBe('0 0 24px #fff');
    // Fall-through preserved across all axes
    expect(out.colors.background).toBe('#000000');
    expect(out.typography.families.body).toBe('Inter');
    expect(out.effects.shadow_card).toBe('0 0 0');
  });
});
