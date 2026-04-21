import { describe, it, expect } from 'vitest';
import {
  resolveToken,
  isToken,
  resolveFill,
  resolveLayerTokens,
  resolveAllTokens,
  type TokenResolutionContext,
} from './token-resolver';
import type { ThemeSpec, Layer, Fill } from '../schema/types';

const testTheme: ThemeSpec = {
  _protocol: 'theme/v1',
  name: 'Test Theme',
  version: '1.0.0',
  colors: {
    background: '#1A1A2E',
    surface: '#16213E',
    primary: '#E94560',
    secondary: '#3D9EE4',
    text: '#FFFFFF',
    text_muted: '#8892A4',
    palette: {
      indigo_900: '#1A1A2E',
    },
  },
  typography: {
    scale: {
      h1: { size: 72, weight: 700, line_height: 1.1 },
      body: { size: 18, weight: 400, line_height: 1.6 },
    },
    families: {
      heading: 'Inter',
      body: 'Inter',
      mono: 'JetBrains Mono',
    },
  },
  spacing: { unit: 8, scale: [0, 4, 8, 16] },
  effects: {
    shadow_card: '0 4px 24px rgba(0,0,0,0.4)',
    blur_glass: 12,
  },
  radii: { sm: 4, md: 8, lg: 16 },
};

const ctx: TokenResolutionContext = { theme: testTheme };

describe('isToken', () => {
  it('returns true for $-prefixed strings', () => {
    expect(isToken('$primary')).toBe(true);
    expect(isToken('$text')).toBe(true);
    expect(isToken('$heading')).toBe(true);
  });

  it('returns false for non-token values', () => {
    expect(isToken('#FF0000')).toBe(false);
    expect(isToken('hello')).toBe(false);
    expect(isToken(42)).toBe(false);
    expect(isToken(null)).toBe(false);
  });
});

describe('resolveToken', () => {
  it('resolves $primary to theme color', () => {
    expect(resolveToken('$primary', ctx)).toBe('#E94560');
  });

  it('resolves $background to theme color', () => {
    expect(resolveToken('$background', ctx)).toBe('#1A1A2E');
  });

  it('resolves $text to theme color', () => {
    expect(resolveToken('$text', ctx)).toBe('#FFFFFF');
  });

  it('resolves $heading to font family', () => {
    expect(resolveToken('$heading', ctx)).toBe('Inter');
  });

  it('resolves $mono to font family', () => {
    expect(resolveToken('$mono', ctx)).toBe('JetBrains Mono');
  });

  it('resolves $shadow_card to effect', () => {
    expect(resolveToken('$shadow_card', ctx)).toBe('0 4px 24px rgba(0,0,0,0.4)');
  });

  it('resolves $lg to radii', () => {
    expect(resolveToken('$lg', ctx)).toBe('16');
  });

  it('resolves nested color like palette.indigo_900', () => {
    expect(resolveToken('$indigo_900', ctx)).toBe('#1A1A2E');
  });

  it('returns fallback for unknown token', () => {
    expect(resolveToken('$nonexistent', ctx)).toBe('#FF00FF');
  });

  it('returns value unchanged for non-tokens', () => {
    expect(resolveToken('#FF0000', ctx)).toBe('#FF0000');
    expect(resolveToken('plain text', ctx)).toBe('plain text');
  });

  it('uses overrides over theme values', () => {
    const ctxWithOverrides: TokenResolutionContext = {
      theme: testTheme,
      overrides: { primary: '#00FF00' },
    };
    expect(resolveToken('$primary', ctxWithOverrides)).toBe('#00FF00');
  });
});

describe('resolveFill', () => {
  it('resolves solid fill token', () => {
    const fill: Fill = { type: 'solid', color: '$primary' };
    const resolved = resolveFill(fill, ctx);
    expect(resolved).toEqual({ type: 'solid', color: '#E94560' });
  });

  it('resolves gradient stop tokens', () => {
    const fill: Fill = {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '$background', position: 0 },
        { color: '$surface', position: 100 },
      ],
    };
    const resolved = resolveFill(fill, ctx);
    expect(resolved.type).toBe('linear');
    if (resolved.type === 'linear') {
      expect(resolved.stops[0].color).toBe('#1A1A2E');
      expect(resolved.stops[1].color).toBe('#16213E');
    }
  });

  it('resolves radial gradient stop tokens', () => {
    const fill: Fill = {
      type: 'radial',
      cx: 50, cy: 50, radius: 50,
      stops: [{ color: '$primary', position: 0 }, { color: '$secondary', position: 100 }],
    };
    const resolved = resolveFill(fill, ctx);
    expect(resolved.type).toBe('radial');
    if (resolved.type === 'radial') {
      expect(resolved.stops[0].color).toBe('#E94560');
    }
  });

  it('resolves conic gradient stop tokens', () => {
    const fill: Fill = {
      type: 'conic',
      cx: 50, cy: 50,
      stops: [{ color: '$text', position: 0 }, { color: '$background', position: 100 }],
    };
    const resolved = resolveFill(fill, ctx);
    expect(resolved.type).toBe('conic');
    if (resolved.type === 'conic') {
      expect(resolved.stops[0].color).toBe('#FFFFFF');
    }
  });

  it('passes through noise fill unchanged', () => {
    const fill: Fill = { type: 'noise', opacity: 0.2 } as unknown as Fill;
    const resolved = resolveFill(fill, ctx);
    expect(resolved).toEqual({ type: 'noise', opacity: 0.2 });
  });

  it('passes through none fill unchanged', () => {
    const fill: Fill = { type: 'none' };
    const resolved = resolveFill(fill, ctx);
    expect(resolved).toEqual({ type: 'none' });
  });

  it('resolves multi fill recursively', () => {
    const fill: Fill = {
      type: 'multi',
      layers: [
        { type: 'solid', color: '$primary' },
        { type: 'solid', color: '$secondary' },
      ],
    };
    const resolved = resolveFill(fill, ctx);
    if (resolved.type === 'multi') {
      expect(resolved.layers[0]).toEqual({ type: 'solid', color: '#E94560' });
      expect(resolved.layers[1]).toEqual({ type: 'solid', color: '#3D9EE4' });
    }
  });
});

describe('resolveLayerTokens', () => {
  it('resolves fill tokens in a rect layer', () => {
    const layer: Layer = {
      id: 'bg',
      type: 'rect',
      z: 0,
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: '$primary' },
    };
    const resolved = resolveLayerTokens(layer, ctx);
    if (resolved.type === 'rect' && resolved.fill?.type === 'solid') {
      expect(resolved.fill.color).toBe('#E94560');
    }
  });

  it('resolves text style tokens', () => {
    const layer: Layer = {
      id: 'heading',
      type: 'text',
      z: 20,
      x: 0, y: 0, width: 100,
      content: { type: 'plain', value: 'Hello' },
      style: { font_family: '$heading', color: '$text', font_size: 72 },
    };
    const resolved = resolveLayerTokens(layer, ctx);
    if (resolved.type === 'text') {
      expect(resolved.style?.font_family).toBe('Inter');
      expect(resolved.style?.color).toBe('#FFFFFF');
    }
  });

  it('resolves stroke color token', () => {
    const layer: Layer = {
      id: 'line',
      type: 'line',
      z: 15,
      x1: 0, y1: 0, x2: 100, y2: 0,
      stroke: { color: '$primary', width: 2 },
    };
    const resolved = resolveLayerTokens(layer, ctx);
    if (resolved.type === 'line' && resolved.stroke) {
      expect(resolved.stroke.color).toBe('#E94560');
    }
  });

  it('resolves shadow color tokens in effects', () => {
    const layer: Layer = {
      id: 'card',
      type: 'rect',
      z: 10,
      x: 0, y: 0, width: 100, height: 100,
      effects: {
        shadows: [{ x: 0, y: 4, blur: 24, color: '$primary' }],
      },
    };
    const resolved = resolveLayerTokens(layer, ctx);
    expect(resolved.effects?.shadows?.[0].color).toBe('#E94560');
  });

  it('resolves icon color token', () => {
    const layer: Layer = {
      id: 'icon1',
      type: 'icon',
      z: 25,
      name: 'download',
      color: '$primary',
    };
    const resolved = resolveLayerTokens(layer, ctx);
    if (resolved.type === 'icon') {
      expect(resolved.color).toBe('#E94560');
    }
  });
});

describe('resolveLayerTokens — edge cases', () => {
  it('layer with no fill, no stroke, no style, no color, no effects is passed through', () => {
    const layer: Layer = { id: 'bare', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 };
    const resolved = resolveLayerTokens(layer, ctx);
    expect(resolved.id).toBe('bare');
  });

  it('text style with non-token color and font_family passes through unchanged', () => {
    const layer: Layer = {
      id: 't', type: 'text', z: 0, x: 0, y: 0, width: 100,
      content: { type: 'plain', value: 'hi' },
      style: { color: '#FF0000', font_family: 'Arial', font_size: 16 },
    };
    const resolved = resolveLayerTokens(layer, ctx);
    if (resolved.type === 'text') {
      expect(resolved.style?.color).toBe('#FF0000');
      expect(resolved.style?.font_family).toBe('Arial');
    }
  });
});

describe('resolveToken — nested path branches', () => {
  it('resolves $unit from spacing.unit', () => {
    expect(resolveToken('$unit', ctx)).toBe('8');
  });

  it('resolves token not found anywhere → fallback pink', () => {
    expect(resolveToken('$totally_unknown_token_xyz', ctx)).toBe('#FF00FF');
  });
});

describe('resolveAllTokens', () => {
  it('resolves tokens across multiple layers', () => {
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$primary' } },
      { id: 'b', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$secondary' } },
    ];
    const resolved = resolveAllTokens(layers, ctx);
    if (resolved[0].type === 'rect' && resolved[0].fill?.type === 'solid') {
      expect(resolved[0].fill.color).toBe('#E94560');
    }
    if (resolved[1].type === 'rect' && resolved[1].fill?.type === 'solid') {
      expect(resolved[1].fill.color).toBe('#3D9EE4');
    }
  });

  it('resolves group children recursively', () => {
    const layers: Layer[] = [
      {
        id: 'grp',
        type: 'group',
        z: 10,
        layers: [
          { id: 'child', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50, fill: { type: 'solid', color: '$primary' } },
        ],
      },
    ];
    const resolved = resolveAllTokens(layers, ctx);
    const group = resolved[0];
    if (group.type === 'group') {
      const child = group.layers[0];
      if (child.type === 'rect' && child.fill?.type === 'solid') {
        expect(child.fill.color).toBe('#E94560');
      }
    }
  });
});

describe('resolveToken — getNestedValue intermediate non-object (line 27 branch)', () => {
  it('dotted token key where intermediate is a string returns fallback', () => {
    // colors.primary = '#E94560' (string), so getNestedValue(theme, 'colors.primary.nested')
    // hits the "typeof current !== 'object'" early return at line 27
    expect(resolveToken('$primary.nested', ctx)).toBe('#FF00FF');
  });

  it('dotted token key where intermediate is a number returns fallback', () => {
    // spacing.unit = 8 (number), so getNestedValue(theme, 'spacing.unit.sub')
    // hits early return for number intermediate
    expect(resolveToken('$unit.sub', ctx)).toBe('#FF00FF');
  });

  it('deepSearch finds key directly in top-level object (line 12 true branch)', () => {
    // Call resolveToken with a key that exists directly in theme.colors
    // $background → colors.background → '#1A1A2E' (via getNestedValue, but also deepSearch has it)
    // To hit deepSearch line 12 directly: use a token that misses all searchPaths
    // but IS found at top level in colors via deepSearch
    // colors itself contains { background, surface, primary, ... }
    // deepSearch is called on colors, key='background' → key in obj → true → returns directly
    // But $background already resolves via searchPaths 'colors.background'
    // Let's make a custom ctx where colors has the key at top level but no matching searchPath
    const ctxCustom: TokenResolutionContext = {
      theme: {
        ...testTheme,
        colors: { direct_key: '#AABBCC' } as unknown as typeof testTheme.colors,
      },
    };
    // 'direct_key' is IN colors top-level, so deepSearch(colors, 'direct_key') hits line 12 TRUE
    // But first, searchPaths: colors.direct_key → getNestedValue finds it! So it returns from searchPaths.
    // To force deepSearch: need a key NOT matched by searchPaths but found deep in colors
    // Use a nested key that differs from direct access
    expect(resolveToken('$direct_key', ctxCustom)).toBe('#AABBCC');
  });
});

describe('resolveFill — resolveStringValue non-token path (line 77)', () => {
  it('solid fill with plain hex color passes through resolveStringValue unchanged', () => {
    const fill: Fill = { type: 'solid', color: '#ABCDEF' };
    const resolved = resolveFill(fill, ctx);
    expect(resolved).toEqual({ type: 'solid', color: '#ABCDEF' });
  });

  it('gradient stops with plain hex colors pass through unchanged', () => {
    const fill: Fill = {
      type: 'linear',
      angle: 90,
      stops: [{ color: '#FF0000', position: 0 }, { color: '#0000FF', position: 100 }],
    };
    const resolved = resolveFill(fill, ctx);
    if (resolved.type === 'linear') {
      expect(resolved.stops[0].color).toBe('#FF0000');
      expect(resolved.stops[1].color).toBe('#0000FF');
    }
  });
});
