import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { drawnBox } from './frame-geometry';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { resvgFontOption } from '../mcp/engine/fonts';
import type { DesignSpec, Layer } from '../schema/types';

// The pivot for pop/rotate and the reveal wipe are only as right as this box.
// Checked against what resvg actually inks with the bundled fonts, because an
// estimate that agrees with itself proves nothing — the flat 0.52em one put a
// live headline at 686px against ~530px of glyphs.
describe('drawnBox — text measured against the rendered ink', () => {
  const inkColumns = (layer: Layer): { left: number; right: number } => {
    const spec = { _protocol: 'design/v1', meta: { id: 'i', name: 'i', type: 'poster', created: '', modified: '' },
      document: { width: 1080, height: 500, unit: 'px', dpi: 96 }, layers: [layer] } as unknown as DesignSpec;
    const img = new Resvg(renderToSVGString(spec), { background: '#FFFFFF', font: resvgFontOption() }).render();
    const px = img.pixels; // a native getter that copies the buffer — read it once
    let left = img.width, right = -1;
    for (let x = 0; x < img.width; x++) {
      for (let y = 0; y < img.height; y++) {
        if (px[(y * img.width + x) * 4] < 128) { left = Math.min(left, x); right = Math.max(right, x); break; }
      }
    }
    return { left, right };
  };

  it.each([
    ['Archivo', 800, 'Wipe it in.'],
    ['Inter', 400, 'Measured, not guessed'],
  ])('%s %s spans its glyphs', (family, weight, value) => {
    const layer = { id: 't', type: 'text', z: 1, x: 80, y: 60, width: 920, height: 380,
      content: { type: 'plain', value }, style: { font_family: family, font_size: 120, font_weight: weight, color: '#000000', align: 'left' } } as unknown as Layer;
    const box = drawnBox(layer);
    const { left, right } = inkColumns(layer);
    const ink = right - left;
    const note = `box ${JSON.stringify(box)} vs ink ${left}→${right} (${ink}px)`;
    expect(ink, note).toBeGreaterThan(100);
    expect(Math.abs((box?.width ?? 0) - ink) / ink, note).toBeLessThan(0.12);
    expect(Math.abs((box?.x ?? 0) - left), note).toBeLessThan(20);
  });
});
