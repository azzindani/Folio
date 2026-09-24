// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { resolveAutoLayouts } from './auto-layout-place';
import { collectFindings } from '../mcp/engine/diagnose-collect';

const words = (id: string, value: string, height: number, z = 0): object => ({ id, type: 'text', z, width: 376, height,
  content: { type: 'plain', value }, style: { font_family: 'Archivo', font_size: 36, font_weight: 800, color: '#F6EEDC' } });
const card = (id: string, height: number, z: number, time: string, name: string): object => ({ id, type: 'auto_layout', z, direction: 'column',
  width: 420, height, padding: 22, gap: 4, fill: { type: 'solid', color: '#2B3A4A' }, layers: [words(`${id}_t`, time, 36), words(`${id}_n`, name, 100, 1)] });
// b31's Oak Stage: acts flowed down a column, 8 px apart, each a padded card.
const stage = { id: 'oak', type: 'auto_layout', z: 5, direction: 'column', x: 210, y: 774, width: 420, height: 600, gap: 8,
  layers: [card('oak1', 193, 0, '12:00', 'The Hollow Pines'), card('oak2', 193, 1, '13:30', 'Ada Frey')] } as unknown as Layer;

describe('resolveAutoLayouts', () => {
  it('places each child where the renderer draws it — nested containers from their own placed box', () => {
    const [oak] = resolveAutoLayouts([stage]) as Array<Layer & { layers: Array<Layer & { layers: Layer[] }> }>;
    const [a, b] = oak?.layers ?? [];
    expect(a).toMatchObject({ x: 210, y: 774, width: 420, height: 193 });
    expect(b).toMatchObject({ x: 210, y: 975 });
    expect(a?.layers[0]).toMatchObject({ x: 232, y: 796 });
    expect(b?.layers[1]).toMatchObject({ x: 232, y: 975 + 22 + 36 + 4 });
  });

  it('lets diagnose measure a flowed act where it is drawn, not at the canvas corner (r8: 32 false title_safe notes)', () => {
    const spec = { meta: { id: 't', name: 'T', type: 'poster' }, document: { width: 1600, height: 2263 },
      layers: [{ id: 'paper', type: 'rect', z: 0, x: 0, y: 0, width: 1600, height: 2263, fill: '#F4ECDC' },
        { id: 'lamp', type: 'ellipse', z: 2, x: 20, y: 20, width: 60, height: 60, fill: '#F2A541' }, stage] } as unknown as DesignSpec;
    const found = collectFindings(spec, '/nowhere/t.design.yaml');
    expect(found.filter(f => /^oak/.test(f.layer_id ?? '') && /title_safe|overprint/.test(f.code))).toEqual([]);
  });
});
