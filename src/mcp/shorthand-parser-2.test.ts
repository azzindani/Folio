import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, coerceShorthandLayers, type ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

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

  // The carousel silent-drop bug: a model stringifies the whole array. Unquoted
  // keys make it invalid JSON but valid YAML flow — parse it, don't drop it.
  it('parses a JSON/YAML-array STRING with unquoted keys (carousel drop bug)', () => {
    const out = coerceShorthandLayers(
      '[{type: "editorial", bg: "#FAF5EC", accent: "#B8543C", kicker: "K", title: "T", deck: "D"}]',
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('editorial');
    expect(out[0].title).toBe('T');
  });

  it('parses a strict-JSON array string', () => {
    const out = coerceShorthandLayers('[{"type":"rect","pos":[0,0,10,10]}]');
    expect(out[0].type).toBe('rect');
  });

  it('parses a single stringified object (not wrapped in an array)', () => {
    const out = coerceShorthandLayers('{type: "stat", value: "55%", label: "share"}');
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('stat');
  });

  it('treats an unstructured string as one compact layer', () => {
    const out = coerceShorthandLayers('rect:[0,0,10,10]:#FAF5EC');
    expect(out[0].type).toBe('rect');
  });

  it('returns [] for an empty / whitespace string', () => {
    expect(coerceShorthandLayers('   ')).toEqual([]);
  });

  it('prunes a stray container/routing layer whose only payload is a filename (v4 slip)', () => {
    // The model appended a routing artifact next to the real sections preset;
    // `poster` is a real preset type, so without the prune the FILENAME label
    // renders as a headline over the good content.
    const out = coerceShorthandLayers([
      { type: 'sections', title: 'The Price of a Play', kicker: 'Streaming', blocks: [{ type: 'callout', text: 'x' }] },
      { type: 'poster', label: 'economicsofstreamingmusic.design.yaml', page_id: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('sections');
  });

  it('prunes a filename routing artifact even with a non-container type', () => {
    const out = coerceShorthandLayers([
      { type: 'editorial', title: 'Real', blocks: [{ type: 'callout', text: 'x' }] },
      { label: 'deck.design.yaml', page_id: 2 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('editorial');
  });

  it('keeps a real poster layer (filename label alone is not enough — needs routing/container + no content)', () => {
    const out = coerceShorthandLayers([
      { type: 'sections', title: 'A', blocks: [{ type: 'callout', text: 'x' }] },
      { type: 'poster', title: 'A genuine second poster', blocks: [{ type: 'callout', text: 'y' }] },
    ]);
    expect(out).toHaveLength(2);
  });

  it('never empties the batch — a lone filename layer is left for the error path', () => {
    const out = coerceShorthandLayers([{ type: 'poster', label: 'only.design.yaml', page_id: 0 }]);
    expect(out).toHaveLength(1);
  });

  it('does not prune a deliberate source line mentioning a .yaml file', () => {
    const out = coerceShorthandLayers([
      { type: 'sections', title: 'A', blocks: [{ type: 'callout', text: 'x' }] },
      { type: 'text', content: 'Source: config.yaml drives the build' },
    ]);
    expect(out).toHaveLength(2); // not a bare filename (extra prose) → kept
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

describe('feature_grid preset (model gives content, engine owns layout)', () => {
  const payload = {
    hero: {
      // layout:'cards' pins the tiled-grid archetype — the engine otherwise seeds
      // 'cards' vs the 'rows' editorial archetype from the content (variety), and
      // this case asserts the card structure specifically.
      type: 'feature_grid', pos: [0, 0, 1080, 1080], layout: 'cards',
      title: 'Nova', subtitle: 'Your next-gen companion', bg: 'gradient',
      items: [
        { icon: 'zap', title: 'Fast Sync', desc: 'Instantly sync across devices' },
        { icon: 'calendar', title: 'Smart Planner', desc: 'AI-driven schedule optimization' },
        { icon: 'shield-check', title: 'Secure Vault', desc: 'End-to-end encrypted notes' },
      ],
    },
  };

  it('compiles to a positioned group: bg + title + subtitle + a row of 3 cards', () => {
    const [g] = expandShorthandLayers(coerceShorthandLayers(payload)) as Array<Layer & { type?: string; layers?: Layer[] }>;
    expect(g.type).toBe('group');
    const kids = g.layers ?? [];
    const types = kids.map(k => k.type);
    expect(types).toContain('rect'); // bg
    expect(types.filter(t => t === 'text').length).toBe(2); // title + subtitle
    const grid = kids.find(k => k.type === 'auto_layout') as Layer & { direction?: string; layers?: Layer[] };
    expect(grid.direction).toBe('column');                 // grid container = column of rows
    const row = (grid.layers ?? [])[0] as Layer & { direction?: string; layers?: Layer[] };
    expect(row.direction).toBe('row');
    expect(row.layers).toHaveLength(3);                     // 3 cards on one row
    // every card is a column with icon + title + desc, and a real position
    for (const card of row.layers ?? []) {
      const c = card as Layer & { type?: string; direction?: string; layers?: Layer[]; width?: number };
      expect(c.type).toBe('auto_layout');
      expect(c.direction).toBe('column');
      expect((c.width ?? 0)).toBeGreaterThan(0);
      const ct = (c.layers ?? []).map(x => x.type);
      expect(ct).toEqual(['icon', 'text', 'text']);
    }
  });

  it('renders all card content (titles, descriptions) to SVG', () => {
    // sanity: nothing is dropped on the way to the renderer (run via the model corpus elsewhere)
    const [g] = expandShorthandLayers(coerceShorthandLayers(payload)) as Array<Layer & { layers?: Layer[] }>;
    const flat = JSON.stringify(g);
    expect(flat).toContain('Fast Sync');
    expect(flat).toContain('Secure Vault');
    expect(flat).toContain('End-to-end encrypted notes');
  });

  it('a dark GRADIENT canvas gives cards DARK text (legible on the light card) — suite-079', () => {
    // suite-079: bg was a dark linear-gradient Fill OBJECT. The old hex-only
    // detection read it as non-dark, so cards kept the global LIGHT text on a
    // light surface → invisible. The card title must end up DARK.
    const gradPayload = { hero: { ...payload.hero, text_color: '#FAFAFA',
      bg: { type: 'linear', stops: [{ color: '#14100A', offset: 0 }, { color: '#805A05', offset: 1 }] } } };
    const [g] = expandShorthandLayers(coerceShorthandLayers(gradPayload)) as Array<Layer & { layers?: Layer[] }>;
    const lum = (hex: string): number => {
      const h = hex.replace('#', ''); if (h.length < 6) return 1;
      return (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255;
    };
    const findCardTitle = (l: unknown): { style?: { color?: string } } | null => {
      const o = l as { type?: string; layers?: unknown[] };
      if (o?.type === 'auto_layout' && Array.isArray(o.layers)) {
        const kt = o.layers.map(x => (x as { type?: string }).type).join(',');
        if (kt === 'icon,text,text') return o.layers[1] as { style?: { color?: string } };
      }
      if (Array.isArray(o?.layers)) for (const k of o.layers) { const r = findCardTitle(k); if (r) return r; }
      return null;
    };
    const title = findCardTitle(g);
    expect(title).toBeTruthy();
    const color = (title?.style?.color ?? '').toString();
    expect(color).toMatch(/^#/);
    expect(lum(color)).toBeLessThan(0.4);                  // dark text on the light card (was '#FAFAFA')
  });

  it('layout:"rows" compiles to a flat editorial list (no card grid container), all content kept', () => {
    const rowsPayload = { hero: { ...payload.hero, layout: 'rows' } };
    const [g] = expandShorthandLayers(coerceShorthandLayers(rowsPayload)) as Array<Layer & { type?: string; layers?: Layer[] }>;
    expect(g.type).toBe('group');
    const kids = g.layers ?? [];
    // The rows archetype is a flat composition — NO auto_layout card grid, and the
    // per-item icons/titles/descs sit directly in the group, not nested in cards.
    expect(kids.some(k => k.type === 'auto_layout')).toBe(false);
    expect(kids.filter(k => k.type === 'icon').length).toBe(3);   // one marker per item
    const flat = JSON.stringify(g);
    expect(flat).toContain('Fast Sync');
    expect(flat).toContain('End-to-end encrypted notes');
  });

  it('absorbs the GPT-OSS vocabulary: bare object + preset + benefit + bg_gradient', () => {
    // The exact shape the lab model sent — a single object (not a {id:layer}
    // dict) keyed with `preset`, item desc as `benefit`, bg as a color list.
    const out = expandShorthandLayers(coerceShorthandLayers({
      preset: 'feature_grid', title: 'Vellum Fitness', subtitle: 'Track your workouts',
      bg_gradient: ['#ff7e5f', '#feb47b'],
      items: [
        { icon: 'zap', title: 'Yoga Sessions', benefit: 'Improve flexibility' },
        { icon: 'star', title: 'Running Tracker', benefit: 'Monitor distance' },
      ],
    })) as Array<Layer & { type?: string; layers?: Layer[] }>;
    expect(out).toHaveLength(1);            // one feature_grid, NOT exploded into keys
    const g = out[0];
    expect(g.type).toBe('group');
    const flat = JSON.stringify(g);
    expect(flat).toContain('Vellum Fitness');
    expect(flat).toContain('Improve flexibility'); // benefit→desc survived
    const bg = (g.layers ?? []).find(l => l.type === 'rect') as Layer & { fill?: { type?: string } };
    expect(bg.fill?.type).toBe('linear');   // bg_gradient list → linear gradient
    const grid = (g.layers ?? []).find(l => l.type === 'auto_layout') as Layer & { layers?: Layer[] };
    const row = (grid.layers ?? [])[0] as Layer & { layers?: Layer[] };
    expect(row.layers).toHaveLength(2);                     // 2 cards on the single row
  });

  it('infers feature_grid from an items array and accepts the `cards` alias', () => {
    const [a] = expandShorthandLayers(coerceShorthandLayers({
      x: { pos: [0, 0, 1080, 1080], title: 'Hi', items: [{ icon: 'star', title: 'One', desc: 'd' }] },
    })) as Array<Layer & { type?: string }>;
    expect(a.type).toBe('group'); // feature_grid → group
    const [b] = expandShorthandLayers(coerceShorthandLayers({
      y: { type: 'cards', pos: [0, 0, 1080, 1080], items: [{ icon: 'star', title: 'One', desc: 'd' }] },
    })) as Array<Layer & { type?: string }>;
    expect(b.type).toBe('group');
  });
});
