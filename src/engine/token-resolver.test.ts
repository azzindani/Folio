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
