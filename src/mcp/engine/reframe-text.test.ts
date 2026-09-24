// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { fitTextBoxes } from './reframe-text';
import { drawnBox } from '../../export/frame-geometry';

const text = (x: number, width: number, align?: string): Layer => ({ id: 't', type: 'text', z: 2, x, y: 400, width, height: 1200,
  content: { type: 'plain', value: 'Ship it faster' }, style: { font_family: 'Archivo', font_size: 80, ...(align ? { text_align: align } : {}) } }) as unknown as Layer;

describe('fitTextBoxes', () => {
  it('trims a box wider and taller than its letters back inside the frame, letters unmoved', () => {
    const l = text(100, 1400), ink = drawnBox(l);
    expect(fitTextBoxes([l], 1080, 1350)).toBe(1);
    expect(l).toMatchObject({ x: 100, width: 980, height: 950 });
    expect(drawnBox(l)).toEqual(ink);
  });

  it('trims a centred box about its centre, and leaves one whose letters would move', () => {
    const c = text(-200, 1480, 'center');
    fitTextBoxes([c], 1080, 1920);
    expect(c).toMatchObject({ x: 0, width: 1080 });
    const tight = text(700, 600);   // the words need more than the 380 px left: the lines would re-wrap
    expect(fitTextBoxes([tight], 1080, 1920)).toBe(0);
    expect(tight).toMatchObject({ x: 700, width: 600 });
  });
});
