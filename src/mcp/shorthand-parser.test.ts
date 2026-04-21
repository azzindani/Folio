import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, compressDesignContext, type ShorthandLayer } from './shorthand-parser';

describe('expandShorthand', () => {
  it('expands rect with pos shorthand', () => {
    const sh: ShorthandLayer = { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '$background' };
    const result = expandShorthand(sh);
    expect(result.type).toBe('rect');
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    if (result.type === 'rect' && result.fill?.type === 'solid') {
      expect(result.fill.color).toBe('$background');
    }
  });

  it('expands rect with string fill to solid fill', () => {
    const sh: ShorthandLayer = { id: 'box', type: 'rect', z: 10, x: 100, y: 100, width: 200, height: 150, fill: '#FF0000' };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill).toEqual({ type: 'solid', color: '#FF0000' });
    }
  });

  it('expands rect with gradient fill object', () => {
    const sh: ShorthandLayer = {
      id: 'grad', type: 'rect', z: 0, pos: [0, 0, 100, 100],
      fill: { type: 'linear', angle: 135, stops: [{ color: '#000', position: 0 }, { color: '#FFF', position: 100 }] },
    };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill?.type).toBe('linear');
    }
  });

  it('expands text with shorthand props', () => {
    const sh: ShorthandLayer = {
      id: 'title', type: 'text', z: 20,
      pos: [80, 200, 920, 0],
      text: 'Hello World',
      font: '$heading', size: 72, weight: 800, color: '$text', align: 'left',
    };
    const result = expandShorthand(sh);
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.content.type).toBe('plain');
      if (result.content.type === 'plain') {
        expect(result.content.value).toBe('Hello World');
      }
      expect(result.style?.font_family).toBe('$heading');
      expect(result.style?.font_size).toBe(72);
      expect(result.style?.font_weight).toBe(800);
      expect(result.style?.color).toBe('$text');
    }
  });

  it('expands line with shorthand', () => {
    const sh: ShorthandLayer = { id: 'divider', type: 'line', z: 15, x1: 80, y1: 540, x2: 400, y2: 540, stroke: '$primary' };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.x1).toBe(80);
      expect(result.y1).toBe(540);
      expect(result.x2).toBe(400);
      expect(result.stroke?.color).toBe('$primary');
      expect(result.stroke?.width).toBe(2);
    }
  });

  it('expands line with stroke object', () => {
    const sh: ShorthandLayer = { id: 'line1', type: 'line', z: 15, x1: 0, y1: 0, x2: 100, y2: 100, stroke: { color: '#F00', width: 4 } };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.stroke).toEqual({ color: '#F00', width: 4 });
    }
  });

  it('expands icon with shorthand', () => {
    const sh: ShorthandLayer = { id: 'ico', type: 'icon', z: 25, x: 50, y: 50, icon: 'download', icon_size: 32, color: '$primary' };
    const result = expandShorthand(sh);
    if (result.type === 'icon') {
      expect(result.name).toBe('download');
      expect(result.size).toBe(32);
      expect(result.color).toBe('$primary');
    }
  });

  it('expands circle', () => {
    const sh: ShorthandLayer = { id: 'dot', type: 'circle', z: 5, x: 200, y: 200, width: 100, height: 100, fill: '$primary' };
    const result = expandShorthand(sh);
    expect(result.type).toBe('circle');
    if (result.type === 'circle') {
      expect(result.fill).toEqual({ type: 'solid', color: '$primary' });
    }
  });

  it('expands polygon with sides', () => {
    const sh: ShorthandLayer = { id: 'hex', type: 'polygon', z: 10, x: 100, y: 100, width: 200, height: 200, sides: 6, fill: '#FF0' };
    const result = expandShorthand(sh);
    if (result.type === 'polygon') {
      expect(result.sides).toBe(6);
    }
  });

  it('expands mermaid layer', () => {
    const sh: ShorthandLayer = { id: 'diagram', type: 'mermaid', z: 30, pos: [0, 0, 400, 300], definition: 'graph TD\n  A-->B' };
    const result = expandShorthand(sh);
    if (result.type === 'mermaid') {
      expect(result.definition).toContain('graph TD');
    }
  });

  it('expands code layer', () => {
    const sh: ShorthandLayer = { id: 'code1', type: 'code', z: 30, pos: [0, 0, 400, 200], code: 'const x = 1;', language: 'javascript' };
    const result = expandShorthand(sh);
    if (result.type === 'code') {
      expect(result.code).toBe('const x = 1;');
      expect(result.language).toBe('javascript');
    }
  });

  it('expands math layer', () => {
    const sh: ShorthandLayer = { id: 'eq', type: 'math', z: 30, pos: [0, 0, 300, 80], expression: 'E = mc^2' };
    const result = expandShorthand(sh);
    if (result.type === 'math') {
      expect(result.expression).toBe('E = mc^2');
    }
  });

  it('expands path layer', () => {
    const sh: ShorthandLayer = {
      id: 'p1', type: 'path', z: 5, pos: [0, 0, 100, 100],
      d: 'M 0 0 L 100 100',
      fill: '#FF0000',
      stroke: '#000000',
    };
    const result = expandShorthand(sh);
    expect(result.type).toBe('path');
    if (result.type === 'path') {
      expect(result.d).toBe('M 0 0 L 100 100');
    }
  });

  it('expands image layer', () => {
    const sh: ShorthandLayer = {
      id: 'img1', type: 'image', z: 5, pos: [0, 0, 200, 150],
      src: 'https://example.com/photo.jpg',
    };
    const result = expandShorthand(sh);
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.src).toBe('https://example.com/photo.jpg');
    }
  });

  it('passes through unknown type as-is (default case)', () => {
    const sh = { id: 'x', type: 'custom_widget' as ShorthandLayer['type'], z: 5 };
    const result = expandShorthand(sh as ShorthandLayer);
    expect(result.type).toBe('custom_widget');
  });

  it('expands group with children', () => {
    const sh: ShorthandLayer = {
      id: 'grp', type: 'group', z: 10,
      layers: [
        { id: 'child1', type: 'rect', z: 0, pos: [0, 0, 50, 50], fill: '#F00' },
        { id: 'child2', type: 'text', z: 1, pos: [0, 0, 50, 20], text: 'Hi' },
      ],
    };
    const result = expandShorthand(sh);
    if (result.type === 'group') {
      expect(result.layers).toHaveLength(2);
      expect(result.layers[0].type).toBe('rect');
      expect(result.layers[1].type).toBe('text');
    }
  });
});

describe('expandShorthandLayers', () => {
  it('expands an array of shorthand layers', () => {
    const layers: ShorthandLayer[] = [
      { id: 'a', type: 'rect', z: 0, pos: [0, 0, 100, 100], fill: '#000' },
      { id: 'b', type: 'text', z: 20, pos: [10, 10, 80, 0], text: 'Hello', color: '#FFF' },
    ];
    const result = expandShorthandLayers(layers);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('rect');
    expect(result[1].type).toBe('text');
  });
});

describe('compressDesignContext', () => {
  it('produces compact summary for poster', () => {
    const summary = compressDesignContext({
      meta: { name: 'MCP Guide', type: 'poster' },
      theme: { ref: 'dark-tech' },
      layers: [
        { id: 'bg', type: 'rect' },
        { id: 'title', type: 'text' },
      ],
    });
    expect(summary).toContain('MCP Guide');
    expect(summary).toContain('poster');
    expect(summary).toContain('dark-tech');
    expect(summary).toContain('bg(rect)');
    expect(summary).toContain('title(text)');
  });

  it('produces compact summary for carousel with pages', () => {
    const summary = compressDesignContext({
      meta: { name: 'Carousel', type: 'carousel' },
      theme: { ref: 'dark-tech' },
      pages: [
        { id: 'p1', label: 'Cover' },
        { id: 'p2', label: 'Step 1' },
        { id: 'p3', label: 'Step 2' },
      ],
    });
    expect(summary).toContain('Cover');
    expect(summary).toContain('Step 1');
    expect(summary).toContain('Next: page 4');
  });

  it('handles undefined meta (?? Untitled / ?? unknown)', () => {
    const summary = compressDesignContext({});
    expect(summary).toContain('Untitled');
    expect(summary).toContain('unknown');
  });

  it('page without label falls back to id (p.label ?? p.id)', () => {
    const summary = compressDesignContext({
      meta: { name: 'X', type: 'carousel' },
      pages: [{ id: 'page-1' }],
    });
    expect(summary).toContain('page-1');
  });

  it('no theme produces no Theme line', () => {
    const summary = compressDesignContext({ meta: { name: 'X', type: 'poster' } });
    expect(summary).not.toContain('Theme:');
  });
});

describe('expandShorthand — additional branch coverage', () => {
  it('rect with sh.color (not fill) → solid fill', () => {
    const sh: ShorthandLayer = { id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, color: '#123456' };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill).toEqual({ type: 'solid', color: '#123456' });
    }
  });

  it('rect with no fill and no color → fill undefined', () => {
    const sh: ShorthandLayer = { id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill).toBeUndefined();
    }
  });

  it('line without stroke or color uses default color=#000', () => {
    const sh: ShorthandLayer = { id: 'ln', type: 'line', z: 0, x1: 0, y1: 0, x2: 100, y2: 0 };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.stroke?.color).toBe('#000');
    }
  });

  it('line with sh.color (no stroke) uses that color', () => {
    const sh: ShorthandLayer = { id: 'ln2', type: 'line', z: 0, x1: 0, y1: 0, x2: 100, y2: 0, color: '#FF0000' };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.stroke?.color).toBe('#FF0000');
    }
  });

  it('text with no optional props leaves style empty', () => {
    const sh: ShorthandLayer = { id: 't', type: 'text', z: 0, x: 0, y: 0, width: 100 };
    const result = expandShorthand(sh);
    expect(result.type).toBe('text');
  });

  it('line with x/y fallback when x1/y1/x2/y2 not provided', () => {
    const sh: ShorthandLayer = { id: 'ln', type: 'line', z: 0, x: 10, y: 20, width: 200 };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.x1).toBe(10); // sh.x1 ?? sh.x → 10
      expect(result.y1).toBe(20); // sh.y1 ?? sh.y → 20
      expect(result.x2).toBe(210); // sh.x2 ?? (sh.x ?? 0) + sh.width → 10 + 200
      expect(result.y2).toBe(20); // sh.y2 ?? sh.y → 20
    }
  });

  it('line x2 with non-numeric width falls back to 100', () => {
    const sh: ShorthandLayer = { id: 'ln', type: 'line', z: 0, x: 0, y: 0, width: 'auto' };
    const result = expandShorthand(sh);
    if (result.type === 'line') {
      expect(result.x2).toBe(100); // typeof 'auto' !== 'number' → uses 100
    }
  });

  it('icon with text fallback when icon not set', () => {
    const sh: ShorthandLayer = { id: 'ico', type: 'icon', z: 0, x: 0, y: 0, text: 'star' };
    const result = expandShorthand(sh);
    if (result.type === 'icon') {
      expect(result.name).toBe('star'); // sh.icon ?? sh.text
    }
  });

  it('icon defaults name=circle and size=24 when neither set', () => {
    const sh: ShorthandLayer = { id: 'ico', type: 'icon', z: 0, x: 0, y: 0 };
    const result = expandShorthand(sh);
    if (result.type === 'icon') {
      expect(result.name).toBe('circle');
      expect(result.size).toBe(24); // icon_size ?? size ?? 24
    }
  });

  it('icon uses size when icon_size not set', () => {
    const sh: ShorthandLayer = { id: 'ico', type: 'icon', z: 0, x: 0, y: 0, icon: 'check', size: 48 };
    const result = expandShorthand(sh);
    if (result.type === 'icon') {
      expect(result.size).toBe(48); // icon_size ?? sh.size
    }
  });

  it('path without fill/stroke produces undefined fill and stroke', () => {
    const sh: ShorthandLayer = { id: 'p', type: 'path', z: 0, pos: [0, 0, 100, 100], d: 'M 0 0' };
    const result = expandShorthand(sh);
    if (result.type === 'path') {
      expect(result.fill).toBeUndefined();
      expect(result.stroke).toBeUndefined();
    }
  });

  it('polygon without fill/stroke produces undefined fill and stroke', () => {
    const sh: ShorthandLayer = { id: 'poly', type: 'polygon', z: 0, x: 0, y: 0, width: 100, height: 100 };
    const result = expandShorthand(sh);
    if (result.type === 'polygon') {
      expect(result.fill).toBeUndefined();
    }
  });

  it('mermaid defaults to empty definition when not set', () => {
    const sh: ShorthandLayer = { id: 'm', type: 'mermaid', z: 0, pos: [0, 0, 100, 100] };
    const result = expandShorthand(sh);
    if (result.type === 'mermaid') {
      expect(result.definition).toBe('');
    }
  });

  it('code defaults to empty code and typescript language', () => {
    const sh: ShorthandLayer = { id: 'c', type: 'code', z: 0, pos: [0, 0, 100, 100] };
    const result = expandShorthand(sh);
    if (result.type === 'code') {
      expect(result.code).toBe('');
      expect(result.language).toBe('typescript');
    }
  });

  it('math defaults to empty expression when not set', () => {
    const sh: ShorthandLayer = { id: 'eq', type: 'math', z: 0, pos: [0, 0, 100, 100] };
    const result = expandShorthand(sh);
    if (result.type === 'math') {
      expect(result.expression).toBe('');
    }
  });

  it('group without layers property produces empty layers array', () => {
    const sh: ShorthandLayer = { id: 'grp', type: 'group', z: 0 };
    const result = expandShorthand(sh);
    if (result.type === 'group') {
      expect(result.layers).toEqual([]);
    }
  });

  it('expandPosition with no pos and partial x/y', () => {
    const sh: ShorthandLayer = { id: 'r', type: 'rect', z: 0, x: 50 }; // no y, width, height
    const result = expandShorthand(sh);
    expect(result.x).toBe(50);
    expect((result as Record<string, unknown>).y).toBeUndefined();
  });

  it('circle with color fallback (no fill)', () => {
    const sh: ShorthandLayer = { id: 'c', type: 'circle', z: 0, x: 0, y: 0, width: 50, height: 50, color: '#FF0' };
    const result = expandShorthand(sh);
    if (result.type === 'circle') {
      expect(result.fill).toEqual({ type: 'solid', color: '#FF0' });
    }
  });

  it('circle with no fill and no color → fill undefined', () => {
    const sh: ShorthandLayer = { id: 'c', type: 'circle', z: 0, x: 0, y: 0, width: 50, height: 50 };
    const result = expandShorthand(sh);
    if (result.type === 'circle') {
      expect(result.fill).toBeUndefined();
    }
  });

  it('rect with string stroke expands to { color, width:2 }', () => {
    const sh: ShorthandLayer = { id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, stroke: '#FF0000' };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.stroke).toEqual({ color: '#FF0000', width: 2 });
    }
  });
});
