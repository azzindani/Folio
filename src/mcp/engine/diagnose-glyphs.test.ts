// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { glyphFindings } from './diagnose-glyphs';

const text = (id: string, value: string, style: object = {}): Layer =>
  ({ id, type: 'text', z: 1, x: 0, y: 0, width: 800, height: 60, content: { type: 'plain', value }, style: { font_family: 'Outfit', font_size: 42, font_weight: 600, ...style } } as unknown as Layer);
const found = (layers: Layer[]): Array<{ id?: string; message: string }> =>
  glyphFindings(layers, '/nowhere/p/designs/d.design.yaml').map(f => ({ id: f.layer_id, message: f.message }));

describe('glyphFindings — characters a bundled face does not have', () => {
  it('names the character a line needs from another font (benchmark r5: ≈ in Outfit)', () => {
    const [f, ...rest] = found([text('note', '30 years ≈ £761'), text('fine', '30 years → about £761')]);
    expect(rest).toEqual([]);
    expect(f?.id).toBe('note');
    expect(f?.message).toContain('"≈" (U+2248)');
  });

  it('looks inside groups, counts emoji, and ignores spaces, line breaks and faces that are not bundled', () => {
    const group = { id: 'g', type: 'group', z: 1, x: 0, y: 0, width: 800, height: 200, layers: [text('hot', 'Sale 🔥')] } as unknown as Layer;
    expect(found([group]).map(f => f.id)).toEqual(['hot']);
    expect(found([text('lines', 'Start small,\nstart early. ')])).toEqual([]);
    expect(found([text('other', '≈', { font_family: 'Some Unbundled Face' })])).toEqual([]);
  });
});
