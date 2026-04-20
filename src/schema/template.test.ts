import { describe, it, expect } from 'vitest';
import { exportAsTemplate, injectIntoTemplate, listSlots } from './template';
import type { DesignSpec } from './types';

function makeSpec(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't1', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [
      { id: 'title', type: 'text', z: 10, x: 0, y: 0, width: 500, height: 80,
        content: { type: 'plain', value: 'Hello World' },
        style: { font_size: 48 },
      } as unknown as import('./types').Layer,
      { id: 'hero', type: 'image', z: 5, x: 0, y: 100, width: 400, height: 300,
        src: 'https://example.com/img.jpg',
      } as unknown as import('./types').Layer,
      { id: 'bg', type: 'rect', z: 1, x: 0, y: 0, width: 1080, height: 1080,
        fill: { type: 'solid', color: '#1a1a2e' },
      } as unknown as import('./types').Layer,
    ],
  } as unknown as DesignSpec;
}

describe('exportAsTemplate', () => {
  it('produces _protocol template/v1', () => {
    const t = exportAsTemplate(makeSpec());
    expect(t._protocol).toBe('template/v1');
  });

  it('extracts text slot for text layer', () => {
    const t = exportAsTemplate(makeSpec());
    const slot = t.slots.find(s => s.id === 'title_text');
    expect(slot).toBeDefined();
    expect(slot?.type).toBe('text');
    expect(slot?.default).toBe('Hello World');
    expect(slot?.path).toBe('layers[0].content.value');
  });

  it('extracts image slot for image layer', () => {
    const t = exportAsTemplate(makeSpec());
    const slot = t.slots.find(s => s.id === 'hero_src');
    expect(slot).toBeDefined();
    expect(slot?.type).toBe('image');
    expect(slot?.path).toBe('layers[1].src');
  });

  it('does not create slot for rect layer (no content)', () => {
    const t = exportAsTemplate(makeSpec());
    const bgSlots = t.slots.filter(s => s.id.startsWith('bg'));
    expect(bgSlots.length).toBe(0);
  });

  it('copies layers into template', () => {
    const t = exportAsTemplate(makeSpec());
    expect(t.layers?.length).toBe(3);
  });
});

describe('injectIntoTemplate', () => {
  it('replaces text slot by id', () => {
    const t = exportAsTemplate(makeSpec());
    const design = injectIntoTemplate(t, { title_text: 'New Headline' });
    expect(design.layers?.[0]).toBeDefined();
    const layer = design.layers?.[0] as { content: { value: string } };
    expect(layer.content.value).toBe('New Headline');
  });

  it('replaces image slot by id', () => {
    const t = exportAsTemplate(makeSpec());
    const design = injectIntoTemplate(t, { hero_src: '/local/photo.jpg' });
    const imgLayer = design.layers?.[1] as { src: string };
    expect(imgLayer.src).toBe('/local/photo.jpg');
  });

  it('uses default when slot not provided', () => {
    const t = exportAsTemplate(makeSpec());
    const design = injectIntoTemplate(t, {});
    const layer = design.layers?.[0] as { content: { value: string } };
    expect(layer.content.value).toBe('Hello World');
  });

  it('replaces slot by dot-path key as fallback', () => {
    const t = exportAsTemplate(makeSpec());
    const design = injectIntoTemplate(t, { 'layers[0].content.value': 'By Path' });
    const layer = design.layers?.[0] as { content: { value: string } };
    expect(layer.content.value).toBe('By Path');
  });

  it('returns design/v1 protocol', () => {
    const t = exportAsTemplate(makeSpec());
    const design = injectIntoTemplate(t, {});
    expect(design._protocol).toBe('design/v1');
  });
});

describe('listSlots', () => {
  it('returns same slots as exported template', () => {
    const t = exportAsTemplate(makeSpec());
    expect(listSlots(t)).toBe(t.slots);
  });

  it('count matches slot count', () => {
    const t = exportAsTemplate(makeSpec());
    expect(listSlots(t).length).toBe(2); // title + hero
  });
});
