import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { normalizeTextAliases } from './engine-finalize-geom';

describe('flat text styling is put where the renderer reads it', () => {
  const text = (extra: Record<string, unknown>): Layer =>
    ({ id: 't', type: 'text', content: { type: 'plain', value: 'x' }, ...extra } as unknown as Layer);

  // From a real harness run: the model wrote `align` on the text layer four
  // times in one deck. diagnose warned each time about something the engine
  // could simply have moved — it already did exactly that for font/size/weight.
  it('lifts align, which used to be warned about instead of fixed', () => {
    const l = text({ align: 'center' });
    normalizeTextAliases([l]);
    const o = l as unknown as Record<string, unknown>;
    expect((o['style'] as Record<string, unknown>)['align']).toBe('center');
    expect(o['align']).toBeUndefined();
  });

  it('lifts every field the warning covers, not a subset of them', () => {
    const l = text({ text_transform: 'uppercase', vertical_align: 'middle', text_decoration: 'underline' });
    normalizeTextAliases([l]);
    const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown>;
    expect(st['text_transform']).toBe('uppercase');
    expect(st['vertical_align']).toBe('middle');
    expect(st['text_decoration']).toBe('underline');
  });

  it('does not clobber a value already set in style', () => {
    const l = text({ align: 'left', style: { align: 'right' } });
    normalizeTextAliases([l]);
    expect(((l as unknown as Record<string, unknown>)['style'] as Record<string, unknown>)['align']).toBe('right');
  });

  it('leaves NON-text layers alone — align means something else on auto_layout', () => {
    const g = { id: 'g', type: 'auto_layout', align: 'stretch' } as unknown as Layer;
    normalizeTextAliases([g]);
    expect((g as unknown as Record<string, unknown>)['align']).toBe('stretch');
  });
});
