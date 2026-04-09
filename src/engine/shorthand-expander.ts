import type { Layer } from '../schema/types';

/**
 * Expands shorthand position notation into explicit fields.
 *
 * Supported shorthands:
 *   pos: [x, y, w, h]  →  x, y, width, height
 */
export function expandShorthand(raw: Record<string, unknown>): Layer {
  const result = { ...raw } as Record<string, unknown>;

  // pos: [x, y, w, h] array shorthand — must be exactly 4 numeric elements
  if (Array.isArray(result['pos']) && result['pos'].length === 4) {
    const [x, y, w, h] = result['pos'] as number[];
    result['x'] = x;
    result['y'] = y;
    result['width'] = w;
    result['height'] = h;
    delete result['pos'];
  }

  return result as unknown as Layer;
}

export function expandLayerShorthands(layers: Layer[]): Layer[] {
  return layers.map(layer =>
    expandShorthand(layer as unknown as Record<string, unknown>),
  );
}
