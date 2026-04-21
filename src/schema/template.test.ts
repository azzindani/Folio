import { describe, it, expect } from 'vitest';
import { exportAsTemplate, injectIntoTemplate, listSlots, getByPath, setByPath } from './template';
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

describe('group / auto_layout nesting', () => {
  it('extracts text slots from children of a group layer', () => {
    const spec = {
      _protocol: 'design/v1' as const,
      meta: { id: 'g1', name: 'G', type: 'poster' as const, created: '', modified: '' },
      document: { width: 400, height: 400, unit: 'px' as const, dpi: 96 },
      layers: [
        { id: 'grp', type: 'group', z: 1, x: 0, y: 0, width: 400, height: 400,
          layers: [
            { id: 'child-txt', type: 'text', z: 2, x: 0, y: 0, width: 200, height: 50,
              content: { type: 'plain', value: 'Child text' }, style: {} },
          ],
        },
      ],
    } as unknown as import('./types').DesignSpec;
    const t = exportAsTemplate(spec);
    const slot = t.slots.find(s => s.id === 'child-txt_text');
    expect(slot).toBeDefined();
    expect(slot?.path).toContain('layers[0].layers[0]');
  });

  it('extracts text slots from children of an auto_layout layer', () => {
    const spec = {
      _protocol: 'design/v1' as const,
      meta: { id: 'al1', name: 'AL', type: 'poster' as const, created: '', modified: '' },
      document: { width: 400, height: 400, unit: 'px' as const, dpi: 96 },
      layers: [
        { id: 'frame', type: 'auto_layout', z: 1, x: 0, y: 0, width: 400, height: 200,
          direction: 'row', gap: 8, padding: 0, align_items: 'start', justify_content: 'start',
          fill: { type: 'none' }, layers: [
            { id: 'label', type: 'text', z: 2, x: 0, y: 0, width: 100, height: 30,
              content: { type: 'plain', value: 'Label' }, style: {} },
          ],
        },
      ],
    } as unknown as import('./types').DesignSpec;
    const t = exportAsTemplate(spec);
    expect(t.slots.find(s => s.id === 'label_text')).toBeDefined();
  });
});

describe('multi-page template', () => {
  it('extracts slots from carousel pages', () => {
    const spec = {
      _protocol: 'design/v1' as const,
      meta: { id: 'c1', name: 'C', type: 'carousel' as const, created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' as const, dpi: 96 },
      pages: [
        { id: 'p1', label: 'Page 1', layers: [
          { id: 'p1-title', type: 'text', z: 10, x: 0, y: 0, width: 500, height: 80,
            content: { type: 'plain', value: 'Page 1 Title' }, style: {} },
        ] },
        { id: 'p2', label: 'Page 2', layers: [
          { id: 'p2-img', type: 'image', z: 5, x: 0, y: 0, width: 400, height: 300, src: '/img2.jpg' },
        ] },
      ],
    } as unknown as import('./types').DesignSpec;
    const t = exportAsTemplate(spec);
    expect(t.slots.find(s => s.id === 'p1-title_text')).toBeDefined();
    expect(t.slots.find(s => s.id === 'p2-img_src')).toBeDefined();
    expect(t.slots.find(s => s.path.startsWith('pages[0]'))).toBeDefined();
    expect(t.slots.find(s => s.path.startsWith('pages[1]'))).toBeDefined();
  });

  it('inject replaces values in pages', () => {
    const spec = {
      _protocol: 'design/v1' as const,
      meta: { id: 'c2', name: 'C', type: 'carousel' as const, created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' as const, dpi: 96 },
      pages: [
        { id: 'p1', label: 'Page 1', layers: [
          { id: 'h1', type: 'text', z: 10, x: 0, y: 0, width: 500, height: 80,
            content: { type: 'plain', value: 'Original' }, style: {} },
        ] },
      ],
    } as unknown as import('./types').DesignSpec;
    const t = exportAsTemplate(spec);
    const design = injectIntoTemplate(t, { h1_text: 'Injected' });
    const page = design.pages?.[0];
    const layer = page?.layers?.[0] as { content: { value: string } };
    expect(layer.content.value).toBe('Injected');
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

describe('getByPath / setByPath edge cases', () => {
  it('getByPath returns undefined for non-existent path', () => {
    const obj = { a: { b: 42 } };
    expect(getByPath(obj, 'a.c.d')).toBeUndefined();
  });

  it('getByPath handles null intermediate value', () => {
    const obj = { a: null };
    expect(getByPath(obj, 'a.b')).toBeUndefined();
  });

  it('getByPath traverses array index', () => {
    const obj = { items: ['x', 'y', 'z'] };
    expect(getByPath(obj, 'items[1]')).toBe('y');
  });

  it('setByPath handles null intermediate (does not throw)', () => {
    const obj: Record<string, unknown> = { a: null };
    expect(() => setByPath(obj, 'a.b.c', 'val')).not.toThrow();
  });

  it('exportAsTemplate includes theme when present', () => {
    const spec = makeSpec();
    (spec as unknown as Record<string, unknown>)['theme'] = { tokens: {} };
    const t = exportAsTemplate(spec);
    expect(t.theme).toBeDefined();
  });
});
