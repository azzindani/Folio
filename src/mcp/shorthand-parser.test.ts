import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, coerceShorthandLayers, compressDesignContext, diagnoseLayers, diagnoseShorthandKeys, type ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

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
    expect((result as unknown as Record<string, unknown>).y).toBeUndefined();
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

describe('expandShorthandLayers — infers missing type/id/z (small-model robustness)', () => {
  // Exactly what the harness small model emitted: an array of layers with only
  // pos (+text), no type/id/z. Previously rejected with "Invalid layer.type".
  it('infers type from fields, auto-assigns ids, defaults z to order', () => {
    const layers = [
      { pos: [0, 0, 1080, 1080] },
      { pos: [200, 200, 800, 200], text: 'GET FIT NOW' },
      { pos: [200, 400, 800, 100], text: 'STRENGTH TRAINING' },
    ] as unknown as ShorthandLayer[];
    const out = expandShorthandLayers(layers);
    expect(out.map(l => l.type)).toEqual(['rect', 'text', 'text']);
    expect(out.map(l => l.id)).toEqual(['rect_1', 'text_2', 'text_3']);
    expect(out.map(l => l.z)).toEqual([0, 1, 2]);
  });

  it('infers image from src and icon from icon', () => {
    const out = expandShorthandLayers([
      { pos: [0, 0, 100, 100], src: '/a.png' },
      { pos: [0, 0, 64, 64], icon: 'star' },
    ] as unknown as ShorthandLayer[]);
    expect(out.map(l => l.type)).toEqual(['image', 'icon']);
  });

  it('does not collide auto-ids with user-provided ids', () => {
    const out = expandShorthandLayers([
      { text: 'A' },                       // would be text_1
      { id: 'text_1', text: 'B' },         // explicit text_1
    ] as unknown as ShorthandLayer[]);
    const ids = out.map(l => l.id);
    expect(new Set(ids).size).toBe(2);     // unique
    expect(ids).toContain('text_1');
  });
});

describe('coerceShorthandLayers — accepts the shapes small models actually send', () => {
  // Exactly the dict-of-compact-strings the harness model emitted.
  it('coerces a {id: "type:[pos]:text"} dict', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      bg: 'pos:[0,0,1080,1080]',
      headline: 'text:[200,200,800,200]:BREWED TO PERFECTION',
      cta: 'text:[200,500,800,100]:VISIT US TODAY!',
    }));
    expect(out.map(l => l.id)).toEqual(['bg', 'headline', 'cta']);
    expect(out.map(l => l.type)).toEqual(['rect', 'text', 'text']);
    const headline = out[1] as { content?: { value?: string } };
    expect(headline.content?.value).toBe('BREWED TO PERFECTION');
  });

  it('coerces a {id: {object}} dict, using the key as id', () => {
    const out = coerceShorthandLayers({ hero: { pos: [0, 0, 100, 100], text: 'Hi' } });
    expect(out[0].id).toBe('hero');
    expect(out[0].text).toBe('Hi');
  });

  it('coerces an array of compact strings', () => {
    const out = coerceShorthandLayers(['rect:[0,0,10,10]', 'text:[1,1,5,5]:Yo']);
    expect(out[0].type).toBe('rect');
    expect(out[1].type).toBe('text');
    expect(out[1].text).toBe('Yo');
  });

  it('passes the canonical array of objects through unchanged', () => {
    const out = coerceShorthandLayers([{ id: 'a', type: 'rect', z: 0, pos: [0, 0, 1, 1] }]);
    expect(out[0]).toMatchObject({ id: 'a', type: 'rect' });
  });

  it('returns [] for null/garbage', () => {
    expect(coerceShorthandLayers(null)).toEqual([]);
    expect(coerceShorthandLayers(42)).toEqual([]);
  });
});

describe('expandShorthandLayers — visible defaults (no blank designs)', () => {
  it('gives text a theme color token and a size proportional to its box', () => {
    const [t] = expandShorthandLayers([
      { type: 'text', pos: [0, 0, 800, 180], text: 'HELLO' },
    ] as unknown as ShorthandLayer[]) as Array<{ style?: { color?: string; font_size?: number } }>;
    expect(t.style?.color).toBe('$text');
    expect(t.style?.font_size).toBe(90); // 180 * 0.5
  });

  it('falls back to size 48 when the text box has no height', () => {
    const [t] = expandShorthandLayers([
      { type: 'text', text: 'HI' },
    ] as unknown as ShorthandLayer[]) as Array<{ style?: { font_size?: number } }>;
    expect(t.style?.font_size).toBe(48);
  });

  it('gives an unfilled shape a theme surface fill', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 1080, 1080] },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { color?: string } }>;
    expect(r.fill?.color).toBe('$surface');
  });

  it('does not override an explicit fill/color/size', () => {
    const [r, t] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 10, 10], fill: '#abc' },
      { type: 'text', pos: [0, 0, 10, 40], text: 'x', color: '#f00', size: 12 },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { color?: string }; style?: { color?: string; font_size?: number } }>;
    expect(r.fill?.color).toBe('#abc');
    expect(t.style?.color).toBe('#f00');
    expect(t.style?.font_size).toBe(12);
  });
});

describe('expandShorthandLayers — verbose-schema field aliases (small-model robustness)', () => {
  it('maps content + font_size onto the text value and size', () => {
    const [t] = expandShorthandLayers([
      { type: 'text', pos: [200, 50, 800, 150], content: 'Morning Coffee', font_size: 80, color: '#333' },
    ] as unknown as ShorthandLayer[]) as Array<{ content?: { value?: string }; style?: { font_size?: number; color?: string } }>;
    expect(t.content?.value).toBe('Morning Coffee');
    expect(t.style?.font_size).toBe(80); // honored, not the height*0.5 default
    expect(t.style?.color).toBe('#333');
  });

  it('reads content given as a {value} object', () => {
    const [t] = expandShorthandLayers([
      { type: 'text', pos: [0, 0, 10, 40], content: { value: 'Hello' } },
    ] as unknown as ShorthandLayer[]) as Array<{ content?: { value?: string } }>;
    expect(t.content?.value).toBe('Hello');
  });

  it('maps symbol/glyph onto the icon name', () => {
    const [a, b] = expandShorthandLayers([
      { type: 'icon', pos: [0, 0, 24, 24], symbol: 'coffee' },
      { type: 'icon', pos: [0, 0, 24, 24], glyph: 'star' },
    ] as unknown as ShorthandLayer[]) as Array<{ name?: string }>;
    expect(a.name).toBe('coffee');
    expect(b.name).toBe('star');
  });

  it('maps url/href onto image src', () => {
    const [a, b] = expandShorthandLayers([
      { type: 'image', pos: [0, 0, 10, 10], url: 'a.png' },
      { type: 'image', pos: [0, 0, 10, 10], href: 'b.png' },
    ] as unknown as ShorthandLayer[]) as Array<{ src?: string }>;
    expect(a.src).toBe('a.png');
    expect(b.src).toBe('b.png');
  });

  it('infers type from an alias when the model omits type', () => {
    const [t, i] = expandShorthandLayers([
      { pos: [0, 0, 100, 50], content: 'Headline' }, // → text via content
      { pos: [0, 0, 24, 24], symbol: 'bolt' },        // → icon via symbol
    ] as unknown as ShorthandLayer[]) as Array<{ type?: string; content?: { value?: string }; name?: string }>;
    expect(t.type).toBe('text');
    expect(t.content?.value).toBe('Headline');
    expect(i.type).toBe('icon');
    expect(i.name).toBe('bolt');
  });

  it('lets the canonical field win over its alias', () => {
    const [t] = expandShorthandLayers([
      { type: 'text', pos: [0, 0, 10, 40], text: 'canonical', content: 'alias', size: 10, font_size: 99 },
    ] as unknown as ShorthandLayer[]) as Array<{ content?: { value?: string }; style?: { font_size?: number } }>;
    expect(t.content?.value).toBe('canonical');
    expect(t.style?.font_size).toBe(10);
  });

  it('sizes an icon to its box when no explicit size is given', () => {
    const [i] = expandShorthandLayers([
      { type: 'icon', pos: [300, 400, 200, 200], symbol: 'coffee_cup' },
    ] as unknown as ShorthandLayer[]) as Array<{ size?: number }>;
    expect(i.size).toBe(200); // min(200,200), not the 24 default
  });

  it('keeps an explicit icon size over the box default', () => {
    const [i] = expandShorthandLayers([
      { type: 'icon', pos: [0, 0, 200, 200], icon: 'star', size: 40 },
    ] as unknown as ShorthandLayer[]) as Array<{ size?: number }>;
    expect(i.size).toBe(40);
  });

  it('regression: renders the exact dict payload the nemotron model sent', () => {
    // Replays the live small-model add_layers call that previously produced a
    // blank poster — content/font_size/symbol were dropped. Now they survive.
    const out = expandShorthandLayers(coerceShorthandLayers({
      title:       { pos: [200, 50, 800, 150], type: 'text', content: 'Morning Coffee', font_size: 80, color: '#333' },
      description: { pos: [100, 850, 800, 150], type: 'text', content: 'Start your day with a perfect cup of coffee.', font_size: 30, color: '#555' },
      icon:        { pos: [300, 400, 200, 200], type: 'icon', symbol: 'coffee_cup' },
    })) as Array<{ id?: string; content?: { value?: string }; name?: string }>;
    const byId = Object.fromEntries(out.map(l => [l.id, l]));
    expect(byId['title'].content?.value).toBe('Morning Coffee');
    expect(byId['description'].content?.value).toContain('perfect cup');
    expect(byId['icon'].name).toBe('coffee_cup');
  });
});

describe('expandFill — tolerates the gradient shapes small models send', () => {
  it('maps type:"gradient" + stops{pos:0-1} → linear + position:0-100', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 100, 100], fill: { type: 'gradient', angle: 135, stops: [{ color: '#1A1A2E', pos: 0 }, { color: '#0f3057', pos: 1 }] } },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; angle?: number; stops?: { color: string; position: number }[] } }>;
    expect(r.fill?.type).toBe('linear');
    expect(r.fill?.angle).toBe(135);
    expect(r.fill?.stops).toEqual([{ color: '#1A1A2E', position: 0 }, { color: '#0f3057', position: 100 }]);
  });

  it('keeps 0-100 positions as-is and defaults a missing angle', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 10, 10], fill: { type: 'linear', stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 50 }] } },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; angle?: number; stops?: { position: number }[] } }>;
    expect(r.fill?.type).toBe('linear');
    expect(r.fill?.angle).toBe(135);
    expect(r.fill?.stops?.[1].position).toBe(50);
  });

  it('maps radial-gradient and carries center/radius', () => {
    const [r] = expandShorthandLayers([
      { type: 'circle', pos: [0, 0, 10, 10], fill: { type: 'radial-gradient', cx: 50, cy: 50, radius: 70, stops: [{ color: '#fff', pos: 0 }, { color: '#000', pos: 1 }] } },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; cx?: number; radius?: number } }>;
    expect(r.fill?.type).toBe('radial');
    expect(r.fill?.cx).toBe(50);
    expect(r.fill?.radius).toBe(70);
  });
});

describe('terse single-letter keys (token-saving small-model shorthand)', () => {
  it('maps p/t/f/c/col → pos/type/fill/text/color', () => {
    const [t] = expandShorthandLayers(coerceShorthandLayers({
      headline: { p: [200, 200, 800, 150], t: 'text', c: 'BREW AND CO', s: 80, col: '#333' },
    })) as Array<{ type?: string; x?: number; width?: number; content?: { value?: string }; style?: { font_size?: number; color?: string } }>;
    expect(t.type).toBe('text');
    expect(t.x).toBe(200);
    expect(t.width).toBe(800);
    expect(t.content?.value).toBe('BREW AND CO');
    expect(t.style?.font_size).toBe(80);
    expect(t.style?.color).toBe('#333');
  });

  it('disambiguates s: number→size, string→src', () => {
    const [txt, img] = expandShorthandLayers(coerceShorthandLayers({
      h: { p: [0, 0, 100, 50], t: 'text', c: 'Hi', s: 60 },
      pic: { p: [0, 0, 100, 100], t: 'image', s: 'photo.png' },
    })) as Array<{ type?: string; style?: { font_size?: number }; src?: string }>;
    expect(txt.type).toBe('text');
    expect(txt.style?.font_size).toBe(60);
    expect(img.type).toBe('image');
    expect(img.src).toBe('photo.png');
  });

  it('maps w/h → width/height when no pos array', () => {
    const [r] = expandShorthandLayers(coerceShorthandLayers({
      bg: { x: 0, y: 0, w: 1080, h: 720, t: 'rect', f: '#123456' },
    })) as Array<{ width?: number; height?: number; fill?: { color?: string } }>;
    expect(r.width).toBe(1080);
    expect(r.height).toBe(720);
    expect(r.fill?.color).toBe('#123456');
  });
});

describe('expandFill — parses CSS gradient strings', () => {
  it('parses linear-gradient(to right, …) → linear with mapped angle + stops', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 100, 100], fill: 'linear-gradient(to right, #f5c6a5, #e0a96d)' },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; angle?: number; stops?: { color: string; position: number }[] } }>;
    expect(r.fill?.type).toBe('linear');
    expect(r.fill?.angle).toBe(90); // "to right"
    expect(r.fill?.stops).toEqual([{ color: '#f5c6a5', position: 0 }, { color: '#e0a96d', position: 100 }]);
  });

  it('parses a 135deg gradient with explicit stop percentages', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 10, 10], fill: 'linear-gradient(135deg, #000 10%, #fff 90%)' },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; angle?: number; stops?: { position: number }[] } }>;
    expect(r.fill?.angle).toBe(135);
    expect(r.fill?.stops?.[0].position).toBe(10);
    expect(r.fill?.stops?.[1].position).toBe(90);
  });

  it('leaves a plain hex string as a solid fill', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 10, 10], fill: '#abc' },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; color?: string } }>;
    expect(r.fill?.type).toBe('solid');
    expect(r.fill?.color).toBe('#abc');
  });
});

describe('diagnoseShorthandKeys — flags silently-ignored fields', () => {
  it('notes truly unknown keys but not known aliases', () => {
    const notes = diagnoseShorthandKeys([
      { id: 'a', t: 'text', c: 'Hi', p: [0, 0, 1, 1], wobble: 3 } as unknown as ShorthandLayer,
      { id: 'b', type: 'rect', pos: [0, 0, 1, 1] } as unknown as ShorthandLayer,
    ]);
    expect(notes).toHaveLength(1); // layer "b" is clean; t/c/p on "a" are known aliases
    expect(notes[0]).toContain('"a"');
    expect(notes[0]).toContain('[wobble]'); // only the genuinely-unknown key is listed
  });
});

describe('diagnoseLayers — self-correction notes for the tool loop', () => {
  it('flags an unknown icon, a local image src, and empty text', () => {
    const layers: Layer[] = [
      { id: 'ico', type: 'icon', z: 0, x: 0, y: 0, name: 'coffee_cup', size: 24 },
      { id: 'pic', type: 'image', z: 0, x: 0, y: 0, width: 10, height: 10, src: 'coffee.jpg' },
      { id: 'cap', type: 'text', z: 0, x: 0, y: 0, width: 10, height: 10, content: { type: 'plain', value: '' } },
    ] as unknown as Layer[];
    const notes = diagnoseLayers(layers);
    expect(notes.find(n => n.includes('ico') && n.includes('not a known icon'))).toBeTruthy();
    expect(notes.find(n => n.includes('pic') && n.includes('local file'))).toBeTruthy();
    expect(notes.find(n => n.includes('cap') && n.includes('empty'))).toBeTruthy();
  });

  it('stays silent for a well-formed set (resolved icon, URL image, real text)', () => {
    const layers: Layer[] = [
      { id: 'ico', type: 'icon', z: 0, x: 0, y: 0, name: 'star', size: 24 },
      { id: 'pic', type: 'image', z: 0, x: 0, y: 0, width: 10, height: 10, src: 'https://example.com/a.png' },
      { id: 'cap', type: 'text', z: 0, x: 0, y: 0, width: 10, height: 10, content: { type: 'plain', value: 'Hi' } },
    ] as unknown as Layer[];
    expect(diagnoseLayers(layers)).toEqual([]);
  });

  it('accepts a synonym icon name without a note', () => {
    const layers = [{ id: 'i', type: 'icon', z: 0, x: 0, y: 0, name: 'photo', size: 24 }] as unknown as Layer[];
    expect(diagnoseLayers(layers)).toEqual([]);
  });

  it('recurses into groups', () => {
    const layers = [
      { id: 'g', type: 'group', z: 0, x: 0, y: 0, width: 10, height: 10, layers: [
        { id: 'inner', type: 'icon', z: 0, x: 0, y: 0, name: 'definitely_not_an_icon', size: 24 },
      ] },
    ] as unknown as Layer[];
    expect(diagnoseLayers(layers).some(n => n.includes('inner'))).toBe(true);
  });
});
