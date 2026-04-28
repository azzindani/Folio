import type { Layer } from '../schema/types';
import type { LoadedDataset } from './data-loader';
import { evalDataExpr } from './aggregator';

/**
 * Walks every layer in the spec and replaces $data.* / $agg.* expression
 * strings with their resolved values from the loaded datasets.
 */
export function bindLayer(layer: Layer, datasets: Map<string, LoadedDataset>): Layer {
  return resolveObject(layer, datasets) as Layer;
}

export function bindLayers(layers: Layer[], datasets: Map<string, LoadedDataset>): Layer[] {
  return layers.map(l => bindLayer(l, datasets));
}

function resolveValue(value: unknown, datasets: Map<string, LoadedDataset>): unknown {
  if (typeof value === 'string' && (value.startsWith('$data.') || value.startsWith('$agg.'))) {
    return evalDataExpr(value, datasets);
  }
  return value;
}

function resolveObject(obj: unknown, datasets: Map<string, LoadedDataset>): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(item => resolveObject(item, datasets));
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = resolveObject(resolveValue(v, datasets), datasets);
    }
    return result;
  }
  return obj;
}
