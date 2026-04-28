import { describe, it, expect } from 'vitest';
import { bindLayer, bindLayers } from './binder';
import type { LoadedDataset } from './data-loader';
import type { Layer } from '../schema/types';

const rows = [{ label: 'Q1', value: 420 }, { label: 'Q2', value: 510 }];
const datasets = new Map<string, LoadedDataset>([['metrics', { id: 'metrics', rows }]]);

function makeText(text: string): Layer {
  return {
    id: 'lbl',
    type: 'text',
    z: 0,
    content: { type: 'plain', value: text },
  } as Layer;
}

describe('bindLayer', () => {
  it('leaves non-expression strings unchanged', () => {
    const layer = makeText('Hello world');
    const result = bindLayer(layer, datasets);
    expect((result as { content: { value: string } }).content.value).toBe('Hello world');
  });

  it('resolves $data.* expression in a field', () => {
    const layer: Layer = {
      id: 'chart',
      type: 'interactive_chart',
      z: 0,
      chart_type: 'bar',
      data_ref: '$data.metrics',
    } as Layer;
    const result = bindLayer(layer, datasets) as unknown as Record<string, unknown>;
    expect(result['data_ref']).toEqual(rows);
  });

  it('resolves $agg.* expression', () => {
    const layer: Layer = {
      id: 'kpi',
      type: 'kpi_card',
      z: 0,
      label: 'Total',
      value: '$agg.metrics.sum(value)',
    } as Layer;
    const result = bindLayer(layer, datasets) as unknown as Record<string, unknown>;
    expect(result['value']).toBe(930);
  });

  it('resolves nested object expressions', () => {
    const layer: Layer = {
      id: 'g',
      type: 'group',
      z: 0,
      layers: [{
        id: 'inner',
        type: 'kpi_card',
        z: 1,
        label: 'Max',
        value: '$agg.metrics.max(value)',
      } as Layer],
    } as Layer;
    const result = bindLayer(layer, datasets) as unknown as { layers: Array<Record<string, unknown>> };
    expect(result.layers[0]['value']).toBe(510);
  });

  it('passes through null/undefined fields unchanged', () => {
    const layer: Layer = { id: 'r', type: 'rect', z: 0 } as Layer;
    const result = bindLayer(layer, datasets) as unknown as Record<string, unknown>;
    expect(result['fill']).toBeUndefined();
  });
});

describe('bindLayers', () => {
  it('maps over all layers', () => {
    const layers = [
      makeText('static'),
      { id: 'k', type: 'kpi_card', z: 0, label: 'X', value: '$agg.metrics.count()' } as Layer,
    ];
    const results = bindLayers(layers, datasets);
    expect((results[0] as { content: { value: string } }).content.value).toBe('static');
    expect((results[1] as unknown as Record<string, unknown>)['value']).toBe(2);
  });
});
