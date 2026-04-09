import type { ThemeSpec, Layer, Fill, GradientStop } from '../schema/types';

const TOKEN_PREFIX = '$';
const FALLBACK_COLOR = '#FF00FF'; // debug pink

export interface TokenResolutionContext {
  theme: ThemeSpec;
  overrides?: Record<string, string>;
}

function deepSearch(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = deepSearch(value as Record<string, unknown>, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveToken(token: string, ctx: TokenResolutionContext): string {
  if (!token.startsWith(TOKEN_PREFIX)) return token;

  const key = token.slice(1); // remove $

  // Check overrides first
  if (ctx.overrides && key in ctx.overrides) {
    return ctx.overrides[key];
  }

  // Search theme sections in priority order
  const searchPaths = [
    `colors.${key}`,
    `typography.families.${key}`,
    `effects.${key}`,
    `radii.${key}`,
    `spacing.${key}`,
  ];

  for (const path of searchPaths) {
    const value = getNestedValue(ctx.theme as unknown as Record<string, unknown>, path);
    if (value !== undefined) {
      return String(value);
    }
  }

  // Deep search in colors (e.g., $indigo_900 finds colors.palette.indigo_900)
  const colorDeep = deepSearch(ctx.theme.colors as unknown as Record<string, unknown>, key);
  if (colorDeep !== undefined) {
    return String(colorDeep);
  }

  return FALLBACK_COLOR;
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

function resolveStringValue(value: string, ctx: TokenResolutionContext): string {
  if (isToken(value)) {
    return resolveToken(value, ctx);
  }
  return value;
}

function resolveGradientStops(stops: GradientStop[], ctx: TokenResolutionContext): GradientStop[] {
  return stops.map(stop => ({
    ...stop,
    color: resolveStringValue(stop.color, ctx),
  }));
}

export function resolveFill(fill: Fill, ctx: TokenResolutionContext): Fill {
  switch (fill.type) {
    case 'solid':
      return { ...fill, color: resolveStringValue(fill.color, ctx) };
    case 'linear':
      return { ...fill, stops: resolveGradientStops(fill.stops, ctx) };
    case 'radial':
      return { ...fill, stops: resolveGradientStops(fill.stops, ctx) };
    case 'conic':
      return { ...fill, stops: resolveGradientStops(fill.stops, ctx) };
    case 'multi':
      return { ...fill, layers: fill.layers.map(f => resolveFill(f, ctx)) };
    case 'noise':
    case 'none':
      return fill;
  }
}

export function resolveLayerTokens(layer: Layer, ctx: TokenResolutionContext): Layer {
  const resolved = { ...layer } as Record<string, unknown>;

  // Resolve fill
  if ('fill' in layer && layer.fill) {
    const fillLayer = layer as { fill: Fill };
    resolved['fill'] = resolveFill(fillLayer.fill, ctx);
  }

  // Resolve stroke color
  if ('stroke' in layer && layer.stroke) {
    const strokeLayer = layer as { stroke: { color: string; width: number } };
    resolved['stroke'] = {
      ...strokeLayer.stroke,
      color: resolveStringValue(strokeLayer.stroke.color, ctx),
    };
  }

  // Resolve text style
  if ('style' in layer && layer.style) {
    const style = { ...(layer as unknown as { style: Record<string, unknown> }).style };
    if (typeof style['color'] === 'string') {
      style['color'] = resolveStringValue(style['color'] as string, ctx);
    }
    if (typeof style['font_family'] === 'string') {
      style['font_family'] = resolveStringValue(style['font_family'] as string, ctx);
    }
    resolved['style'] = style;
  }

  // Resolve icon color
  if ('color' in layer && typeof (layer as unknown as Record<string, unknown>)['color'] === 'string') {
    resolved['color'] = resolveStringValue(
      (layer as unknown as Record<string, unknown>)['color'] as string,
      ctx,
    );
  }

  // Resolve shadow colors in effects
  if (layer.effects?.shadows) {
    resolved['effects'] = {
      ...layer.effects,
      shadows: layer.effects.shadows.map(s => ({
        ...s,
        color: resolveStringValue(s.color, ctx),
      })),
    };
  }

  // Recurse into group children
  if (layer.type === 'group' && 'layers' in layer) {
    resolved['layers'] = layer.layers.map((child: Layer) => resolveLayerTokens(child, ctx));
  }

  return resolved as unknown as Layer;
}

export function resolveAllTokens(layers: Layer[], ctx: TokenResolutionContext): Layer[] {
  return layers.map(layer => resolveLayerTokens(layer, ctx));
}
