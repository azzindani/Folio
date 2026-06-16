import { describe, it, expect, vi } from 'vitest';

// Mock the native rasterizer so the test exercises only the text-extraction +
// vector-draw logic (no Rust binary, no PNG decode).
vi.mock('@resvg/resvg-js', () => ({
  Resvg: class {
    render(): { asPng(): Buffer } {
      return { asPng: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
    }
  },
}));

import { addVectorPdfPage, type PdfDoc } from './pdf-build';
import { renderToSVGElement } from './svg-export';
import type { DesignSpec } from '../../schema/types';

interface StubPdf { doc: PdfDoc; fonts: string[]; texts: string[]; images: number[] }
function stubPdf(): StubPdf {
  const out: StubPdf = { doc: null as unknown as PdfDoc, fonts: [], texts: [], images: [] };
  out.doc = {
    addImage: () => { out.images.push(1); },
    addFileToVFS: () => {},
    addFont: (_f, family) => { out.fonts.push(family); },
    setFont: () => {},
    setFontSize: () => {},
    setTextColor: () => {},
    setDrawColor: () => {},
    setLineWidth: () => {},
    text: (text) => { out.texts.push(text); },
  };
  return out;
}

const spec: DesignSpec = {
  _protocol: 'design/v2',
  meta: { id: 'd', name: 'T', type: 'poster', created: '', modified: '' },
  document: { width: 400, height: 300, unit: 'px', dpi: 96 },
  theme: { ref: 'midnight' },
  layers: [
    { id: 'h', type: 'text', x: 20, y: 40, width: 360, height: 50, z: 1,
      content: { type: 'plain', value: 'Hello Vector' },
      style: { font_family: 'Inter', font_size: 32, font_weight: 700, color: '#ffffff' } },
  ],
} as unknown as DesignSpec;

describe('addVectorPdfPage', () => {
  it('draws bundled-font text as vector runs, embeds the raster once, and strips the vectorized node', () => {
    const el = renderToSVGElement(spec);
    expect(el.querySelectorAll('text').length).toBe(1);

    const s = stubPdf();
    const runs = addVectorPdfPage(s.doc, { svg: el, width: 400, height: 300 }, 2, new Set());

    expect(runs).toBe(1);
    expect(s.texts).toContain('Hello Vector');
    expect(s.fonts.length).toBe(1);                 // Inter registered once
    expect(s.images.length).toBe(1);                // single background raster
    // The vectorized <text> was removed so the raster won't double-paint it.
    expect(el.querySelectorAll('text').length).toBe(0);
  });

  it('leaves gradient-filled text in the raster (0 vector runs, still 1 image)', () => {
    const grad: DesignSpec = {
      ...spec,
      layers: [
        { id: 'g', type: 'text', x: 10, y: 30, width: 200, height: 40, z: 1,
          content: { type: 'plain', value: 'Gradient' },
          style: { font_family: 'Inter', font_size: 24, color: { type: 'linear', stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] } } },
      ],
    } as unknown as DesignSpec;
    const el = renderToSVGElement(grad);
    const s = stubPdf();
    const runs = addVectorPdfPage(s.doc, { svg: el, width: 400, height: 300 }, 2, new Set());
    expect(runs).toBe(0);
    expect(s.images.length).toBe(1);
    // Gradient text stays in the SVG for the raster to paint.
    expect(el.querySelectorAll('text').length).toBe(1);
  });
});
