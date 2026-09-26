// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { resolveSpec, resolveLayers } from './resolve-source';
import { lintComposition } from '../mcp/engine/motion-lint';

const words = (id: string, value: string): object => ({ id, type: 'text', z: 1, width: 300, height: 60, content: { type: 'plain', value },
  style: { font_size: 40, color: '#111111' }, animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, origin: 'offset' } } });
const column = (id: string, x: number, value: string): Layer =>
  ({ id, type: 'auto_layout', z: 1, direction: 'column', x, y: 200, width: 300, height: 400, gap: 8, layers: [words(`${id}_t`, value)] }) as unknown as Layer;

describe('resolveSource', () => {
  it('hands a literal design back as the same object — nothing copied, nothing changed', () => {
    const spec = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC' }] } as unknown as DesignSpec;
    expect(resolveSpec(spec, { place: true })).toBe(spec);
    const flowed = { ...spec, layers: [column('c', 100, 'Hi')] } as unknown as DesignSpec;
    expect(resolveSpec(flowed)).toBe(flowed);
    expect((resolveSpec(flowed, { place: true }).layers?.[0] as Layer & { layers: Layer[] }).layers[0]).toMatchObject({ x: 100, y: 200 });
  });

  it('lets the motion lint read flowed children where they are drawn (op:lint put two columns\' lines on one spot)', () => {
    const layers = [column('left', 100, 'Doors open'), column('right', 600, 'Bar closes')];
    const notes = lintComposition(layers, { width: 1080, height: 1080 }, [], 2000);
    expect(notes.filter(n => n.kind === 'overlap')).toEqual([]);
    expect(resolveLayers(layers)).toBe(layers);
  });
});
