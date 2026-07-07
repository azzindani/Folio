import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, coerceShorthandLayers, diagnoseLayers, diagnoseShorthandKeys, detectTextOverlap, type ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

describe('auto-layout containers (declarative complex layout)', () => {
  it('maps row/column/stack/grid → auto_layout with direction/wrap', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      a: { type: 'row', pos: [0, 0, 900, 200], gap: 24, layers: [] },
      b: { type: 'column', pos: [0, 0, 200, 900], layers: [] },
      c: { type: 'stack', pos: [0, 0, 200, 900], layers: [] },
      d: { type: 'grid', pos: [0, 0, 900, 900], layers: [] },
    })) as Array<{ type?: string; direction?: string; wrap?: boolean; gap?: number }>;
    const [a, b, c, d] = out;
    expect(a.type).toBe('auto_layout'); expect(a.direction).toBe('row'); expect(a.gap).toBe(24);
    expect(b.direction).toBe('column');
    expect(c.direction).toBe('column');
    expect(d.direction).toBe('row'); expect(d.wrap).toBe(true);
  });

  it('maps align/justify words onto the schema enums', () => {
    const [a] = expandShorthandLayers(coerceShorthandLayers({
      bar: { type: 'row', pos: [0, 0, 900, 100], align: 'middle', justify: 'between', layers: [] },
    })) as Array<{ align_items?: string; justify_content?: string }>;
    expect(a.align_items).toBe('center');
    expect(a.justify_content).toBe('space-between');
  });

  it('normalizes nested children through the full pipeline (aliases, types, defaults)', () => {
    const [row] = expandShorthandLayers(coerceShorthandLayers({
      cards: { type: 'row', pos: [0, 0, 900, 300], gap: 20, layers: {
        card1: { type: 'rect', pos: [0, 0, 280, 300], fill: '#222' },
        title: { content: 'Hi', size: 40, pos: [0, 0, 280, 60] }, // content→text, inferred text
        ico: { type: 'icon', symbol: 'photo', pos: [0, 0, 60, 60] }, // symbol→icon, photo→image
      } },
    })) as Array<{ type?: string; layers?: Array<{ id?: string; type?: string; content?: { value?: string }; name?: string }> }>;
    expect(row.type).toBe('auto_layout');
    const kids = row.layers ?? [];
    expect(kids).toHaveLength(3);
    expect(kids.find(k => k.id === 'title')?.type).toBe('text');
    expect(kids.find(k => k.id === 'title')?.content?.value).toBe('Hi');
    expect(kids.find(k => k.id === 'ico')?.name).toBe('photo'); // resolved at render
  });

  it('infers auto_layout from layers+direction, group from layers alone', () => {
    const [al, grp] = expandShorthandLayers([
      { pos: [0, 0, 900, 100], direction: 'row', layers: [] },
      { pos: [0, 0, 100, 100], layers: [] },
    ] as unknown as ShorthandLayer[]) as Array<{ type?: string }>;
    expect(al.type).toBe('auto_layout');
    expect(grp.type).toBe('group');
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

  it('maps name→icon for an explicit icon layer (and diagnoses an unreal name)', () => {
    const [ic] = expandShorthandLayers(coerceShorthandLayers({
      mug: { type: 'icon', name: 'coffee mug', pos: [0, 0, 100, 100] },
    })) as Array<{ type?: string; name?: string }>;
    expect(ic.type).toBe('icon');
    expect(ic.name).toBe('coffee mug'); // honored, not silently 'circle'
    expect(diagnoseLayers(expandShorthandLayers(coerceShorthandLayers({
      mug: { type: 'icon', name: 'coffee mug', pos: [0, 0, 100, 100] },
    }))).some(n => n.includes('coffee mug'))).toBe(true);
  });

  it('does not turn a stray-named rect into an icon', () => {
    const [r] = expandShorthandLayers(coerceShorthandLayers({
      box: { type: 'rect', name: 'whatever', pos: [0, 0, 10, 10], fill: '#abc' },
    })) as Array<{ type?: string }>;
    expect(r.type).toBe('rect');
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

  it('turns a bare "gradient" keyword into a themed $primary→$surface gradient', () => {
    const [r] = expandShorthandLayers([
      { type: 'rect', pos: [0, 0, 10, 10], fill: 'gradient' },
    ] as unknown as ShorthandLayer[]) as Array<{ fill?: { type?: string; stops?: { color: string; position: number }[] } }>;
    expect(r.fill?.type).toBe('linear');
    expect(r.fill?.stops).toEqual([{ color: '$primary', position: 0 }, { color: '$surface', position: 100 }]);
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

  it('does NOT flag preset / pattern / shape / type-effect fields (WS1–6)', () => {
    const notes = diagnoseShorthandKeys([
      { id: 'ed', type: 'editorial', pos: [0, 0, 1080, 1350], kicker: 'k', title: 't', subtitle: 's', body: 'b', footer: 'f', accent: '#000' } as unknown as ShorthandLayer,
      { id: 'sp', type: 'split', pos: [0, 0, 1200, 800], side: 'left', ratio: 'golden', panel: '#000', panel_label: '04', panel_text: '#fff' } as unknown as ShorthandLayer,
      { id: 'st', type: 'star', pos: [0, 0, 100, 100], points: 5, inner_ratio: 0.4 } as unknown as ShorthandLayer,
      { id: 'tx', type: 'text', pos: [0, 0, 100, 50], text: 'Hi', uppercase: true, outline: { color: '#000', width: 2 }, highlight: '#ff0', variation: { wght: 350 }, features: { tnum: 1 }, curve: 'M0 0' } as unknown as ShorthandLayer,
    ]);
    expect(notes).toHaveLength(0);
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

  it('stays silent for a well-formed set (resolved icon, assets/ image, real text)', () => {
    const layers: Layer[] = [
      { id: 'ico', type: 'icon', z: 0, x: 0, y: 0, name: 'star', size: 24 },
      { id: 'pic', type: 'image', z: 0, x: 0, y: 0, width: 10, height: 10, src: 'assets/images/a.png' },
      { id: 'cap', type: 'text', z: 0, x: 0, y: 0, width: 10, height: 10, content: { type: 'plain', value: 'Hi' } },
    ] as unknown as Layer[];
    expect(diagnoseLayers(layers)).toEqual([]);
  });

  it('warns that a remote-URL image src is editor-only (blank in PNG/PDF exports)', () => {
    const layers: Layer[] = [
      { id: 'pic', type: 'image', z: 0, x: 0, y: 0, width: 10, height: 10, src: 'https://example.com/a.png' },
    ] as unknown as Layer[];
    const notes = diagnoseLayers(layers);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/EDITOR only/);
    expect(notes[0]).toMatch(/asset_add/);
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

describe('detectTextOverlap — catches hand-placed colliding cards (small-model failure)', () => {
  it('flags top-level text layers piled at the same spot and steers to the preset', () => {
    // The exact failure: three card headings hand-placed at overlapping coords.
    const layers = [
      { id: 'c1-h', type: 'text', z: 10, pos: [120, 840, 300, 60], content: { type: 'plain', value: 'Single Origin' } },
      { id: 'c2-h', type: 'text', z: 10, pos: [130, 845, 300, 60], content: { type: 'plain', value: 'Monthly Box' } },
      { id: 'c3-h', type: 'text', z: 10, pos: [125, 850, 300, 60], content: { type: 'plain', value: 'Guaranteed' } },
    ] as unknown as Layer[];
    const note = detectTextOverlap(layers);
    expect(note).not.toBeNull();
    expect(note).toContain('feature_grid');
    expect(note).toContain('overlap');
    // it also surfaces the deliberate-overlap escape hatch so a frontier model
    // doing intentional layering isn't only steered to a preset
    expect(note).toContain('locked:true');
    // and it surfaces first in diagnoseLayers
    expect(diagnoseLayers(layers)[0]).toContain('feature_grid');
  });

  it('stays silent for a well-spaced poster (title / subtitle / cta)', () => {
    const layers = [
      { id: 'h',   type: 'text', z: 10, pos: [80, 180, 920, 160], content: { type: 'plain', value: 'Headline' } },
      { id: 'sub', type: 'text', z: 10, pos: [120, 520, 840, 80], content: { type: 'plain', value: 'Subtitle' } },
      { id: 'cta', type: 'text', z: 10, pos: [80, 900, 920, 60], content: { type: 'plain', value: 'Act now' } },
    ] as unknown as Layer[];
    expect(detectTextOverlap(layers)).toBeNull();
  });

  it('does not flag overlap inside a container (engine owns child layout)', () => {
    // Two overlapping texts nested in a group — positioned by the engine, not
    // hand-placed siblings. detectTextOverlap only inspects the top level.
    const layers = [
      { id: 'col', type: 'auto_layout', z: 0, pos: [0, 0, 400, 400], layers: [
        { id: 'a', type: 'text', z: 1, pos: [0, 0, 200, 100], content: { type: 'plain', value: 'A' } },
        { id: 'b', type: 'text', z: 1, pos: [0, 0, 200, 100], content: { type: 'plain', value: 'B' } },
      ] },
    ] as unknown as Layer[];
    expect(detectTextOverlap(layers)).toBeNull();
  });

  it('ignores text layers without a resolvable box (width:auto)', () => {
    const layers = [
      { id: 'a', type: 'text', z: 1, x: 0, y: 0, width: 'auto', height: 'auto', content: { type: 'plain', value: 'A' } },
      { id: 'b', type: 'text', z: 1, x: 0, y: 0, width: 'auto', height: 'auto', content: { type: 'plain', value: 'B' } },
    ] as unknown as Layer[];
    expect(detectTextOverlap(layers)).toBeNull();
  });
});

describe('diagnoseLayers — feature_grid encoded as a string (weak-model failure)', () => {
  it('flags a text layer holding feature_grid DSL and shows the JSON shape', () => {
    const layers = [
      { id: 'feature_grid', type: 'text', z: 0, x: 0, y: 0, width: 100, height: 100,
        content: { type: 'plain', value: '0,0,1080,1080:title=Brew Lab:items=icon=coffee:title=Fresh:desc=Sourced' } },
    ] as unknown as Layer[];
    const notes = diagnoseLayers(layers);
    expect(notes.some(n => n.includes('feature_grid') && n.includes('JSON object'))).toBe(true);
  });

  it('does not flag normal prose that happens to contain the word items', () => {
    const layers = [
      { id: 't', type: 'text', z: 0, x: 0, y: 0, width: 100, height: 100,
        content: { type: 'plain', value: 'Our menu has many items to choose from' } },
    ] as unknown as Layer[];
    expect(diagnoseLayers(layers)).toEqual([]);
  });
});

describe('ellipse fill (regression: type="ellipse" dropped its fill)', () => {
  // Before the fix, the switch had no `case 'ellipse'`, so ellipse layers fell
  // through to default: which strips fill/stroke — every ellipse rendered
  // fill="none" (invisible) in SVG/PNG export.
  it('keeps a solid fill on an ellipse layer', () => {
    const result = expandShorthand({ id: 'e', type: 'ellipse', z: 1, pos: [0, 0, 40, 40], fill: '#C42E78' });
    expect(result.type).toBe('ellipse');
    if ('fill' in result && result.fill && typeof result.fill === 'object') {
      expect((result.fill as { type: string; color: string }).type).toBe('solid');
      expect((result.fill as { type: string; color: string }).color).toBe('#C42E78');
    } else {
      throw new Error('ellipse lost its fill');
    }
  });

  it('keeps a radial gradient fill on an ellipse layer', () => {
    const result = expandShorthand({
      id: 'm', type: 'ellipse', z: 1, pos: [0, 0, 200, 200],
      fill: { type: 'radial', stops: [{ color: '#B9C4F0', position: 0 }, { color: '#F3EEF6', position: 100 }] },
    });
    expect(result.type).toBe('ellipse');
    const fill = (result as { fill?: { type?: string; stops?: unknown[] } }).fill;
    expect(fill?.type).toBe('radial');
    expect(Array.isArray(fill?.stops)).toBe(true);
  });

  it('keeps a stroke on an ellipse (ring) layer', () => {
    const result = expandShorthand({
      id: 'ring', type: 'ellipse', z: 1, pos: [0, 0, 100, 100],
      fill: 'rgba(0,0,0,0)', stroke: { color: '#6231C9', width: 3 },
    });
    const stroke = (result as { stroke?: { color?: string } }).stroke;
    expect(stroke?.color).toBe('#6231C9');
  });
});

describe('marble_bg / backdrop preset', () => {
  it('expands one shorthand into a group: bg rect + gradient ellipse blobs', () => {
    const g = expandShorthand({
      id: 'bd', type: 'marble_bg', z: 1, pos: [0, 0, 1080, 1350],
      bg: '#F3EEF6', palette: ['#B9C4F0', '#A6DAE8'], accent: '#6231C9', corners: ['tr', 'bl'],
    } as unknown as ShorthandLayer) as unknown as { type: string; layers: Array<Record<string, unknown>> };
    expect(g.type).toBe('group');
    // full-canvas flat base first
    const base = g.layers[0];
    expect(base.type).toBe('rect');
    expect((base.fill as { color: string }).color).toBe('#F3EEF6');
    // at least one radial-gradient ellipse blob that fades to the bg color
    const blob = g.layers.find(l => l.type === 'ellipse' && (l.fill as { type?: string })?.type === 'radial') as Record<string, unknown>;
    expect(blob).toBeTruthy();
    const stops = (blob.fill as { stops: Array<{ color: string }> }).stops;
    expect(stops[stops.length - 1].color).toBe('#F3EEF6'); // edge blends into canvas → text stays readable
    // two corners → blobs on both sides of the canvas
    const xs = g.layers.filter(l => l.type === 'ellipse').map(l => l.x as number);
    expect(Math.min(...xs)).toBeLessThan(200);
    expect(Math.max(...xs)).toBeGreaterThan(700);
  });

  it('backdrop alias works and respects intensity/rings/dots/veins', () => {
    const g = expandShorthand({
      id: 'bd2', type: 'backdrop', z: 0, pos: [0, 0, 1080, 1080],
      corners: ['br'], intensity: 0.5, rings: 0, dots: 0, veins: false,
    } as unknown as ShorthandLayer) as unknown as { type: string; layers: Array<Record<string, unknown>> };
    expect(g.type).toBe('group');
    expect(g.layers.some(l => l.type === 'line')).toBe(false); // veins:false
    expect(g.layers.filter(l => l.type === 'ellipse').every(l => (l.opacity as number) <= 0.5)).toBe(true);
  });
});

describe('decor preset — generalized (style families)', () => {
  it('style:"mesh" → spread gradient ellipses, no veins/rings', () => {
    const g = expandShorthand({ id: 'd', type: 'decor', z: 1, pos: [0, 0, 1080, 1350], style: 'mesh',
      palette: ['#B9C4F0', '#A6DAE8'] } as unknown as ShorthandLayer) as unknown as { type: string; layers: Array<Record<string, unknown>> };
    expect(g.type).toBe('group');
    expect(g.layers.some(l => l.type === 'line')).toBe(false);
    const blobs = g.layers.filter(l => l.type === 'ellipse' && (l.fill as { type?: string })?.type === 'radial');
    expect(blobs.length).toBeGreaterThanOrEqual(3);
  });

  it('marble_bg alias still defaults to the marble style (corner blobs + veins)', () => {
    const g = expandShorthand({ id: 'm', type: 'marble_bg', z: 1, pos: [0, 0, 1080, 1350], corners: ['tr', 'bl'] } as unknown as ShorthandLayer) as unknown as { type: string; layers: Array<Record<string, unknown>> };
    expect(g.layers.some(l => l.type === 'line')).toBe(true); // veins present
  });
});

describe('link / href primitive', () => {
  it('link shorthand sets layer.href (hyperlink)', () => {
    const r = expandShorthand({ id: 't', type: 'text', z: 1, pos: [0, 0, 200, 40], text: 'go', link: 'https://example.com' } as unknown as ShorthandLayer);
    expect((r as unknown as { href?: string }).href).toBe('https://example.com');
  });
});

describe('__variant — distinct curated art-direction per sibling design (give-me-N-options)', () => {
  // A weak model passes `variant` to enrich_brief but DROPS the returned bg/accent/
  // font on add_layers, so N same-content designs would seed to ONE mood and render
  // IDENTICALLY. addLayers stamps `__variant` (the design's index in its sibling set)
  // so seededDefaults picks the Nth curated art-direction even with no style passed.
  type Grp = { type: string; layers: Array<Record<string, unknown>> };
  const content = {
    id: 'v', type: 'sections', z: 0, pos: [0, 0, 1080, 1350],
    title: 'Can AI Create Designs?', subtitle: 'Proof a text-only model can design', kicker: 'AI DESIGN',
    blocks: [
      { kind: 'stats', items: [{ value: '120B', label: 'Params' }, { value: '0', label: 'Vision' }] },
      { kind: 'callout', label: 'Key', text: 'Design is structure, not pixels.' },
    ],
  };
  // Signature of the rendered LOOK: base background fill + the title's font.
  const sig = (g: Grp): string => {
    const rect = g.layers.find(l => l['type'] === 'rect');
    const title = g.layers.find(l => typeof l['id'] === 'string' && (l['id'] as string).endsWith('_title'));
    const style = (title?.['style'] ?? {}) as Record<string, unknown>;
    return JSON.stringify(rect?.['fill']) + '|' + String(style['font_family'] ?? '');
  };
  const expand = (variant?: number): Grp =>
    expandShorthand({ ...content, ...(variant === undefined ? {} : { __variant: variant }) } as unknown as ShorthandLayer) as unknown as Grp;

  it('variant 0 is byte-identical to no variant (lone design unchanged)', () => {
    expect(sig(expand(0))).toBe(sig(expand()));
  });

  it('variants 1+ produce a DIFFERENT art-direction from variant 0 (same content)', () => {
    const base = sig(expand(0));
    expect(sig(expand(1))).not.toBe(base);
    expect(sig(expand(2))).not.toBe(base);
    expect(sig(expand(4))).not.toBe(base);
  });

  it('distinct variants differ from EACH OTHER (5 options ⇒ 5 looks)', () => {
    const sigs = [0, 1, 2, 3, 4].map(v => sig(expand(v)));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('an explicit bg always wins — variant is ignored when the model gave style', () => {
    const withBg = (variant: number): Grp =>
      expandShorthand({ ...content, bg: '#0A0A0A', __variant: variant } as unknown as ShorthandLayer) as unknown as Grp;
    const rectFill = (g: Grp): unknown => g.layers.find(l => l['type'] === 'rect')?.['fill'];
    expect(rectFill(withBg(0))).toEqual(rectFill(withBg(3)));
  });
});

describe('sections — connected flow / process block (rasterizing, collision-free)', () => {
  type SL = { id: string; type: string; x: number; y: number; width: number; height: number };
  const flow = (kind: string): { type?: string; layers?: SL[] } => expandShorthand({
    id: 'fl', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'How it works',
    blocks: [{ kind, items: [
      { title: 'Submitted', desc: 'Customer submits a ticket via email or portal, which then needs routing to a team.' },
      { title: 'Triaged', desc: 'The team reviews and categorizes by urgency and product area.' },
      { title: 'Resolved', desc: 'The agent fixes it and closes the loop with the customer.' },
    ] }],
  } as unknown as ShorthandLayer) as { type?: string; layers?: SL[] };

  it('renders numbered nodes + connectors + arrows + measured text, no overlap', () => {
    const g = flow('flow');
    const ids = g.layers!.map(l => l.id);
    expect(ids.filter(i => /_node\d+$/.test(i)).length).toBe(3);   // one node per step
    expect(ids.filter(i => /_rail\d+$/.test(i)).length).toBe(2);   // n-1 connectors
    expect(ids.filter(i => /_arw\d+$/.test(i)).length).toBe(2);    // n-1 arrows
    expect(g.layers!.filter(l => l.type === 'ellipse').length).toBeGreaterThanOrEqual(3);
    expect(ids.some(i => /_ft0$/.test(i))).toBe(true);             // step title
    const ny = (i: number): number => g.layers!.find(l => l.id === `fl_b0_node${i}`)!.y;
    expect(ny(0)).toBeLessThan(ny(1));                             // measured → stacked
    expect(ny(1)).toBeLessThan(ny(2));
  });

  it('`steps` routes to the flow renderer (a step list IS a sequence)', () => {
    expect(flow('steps').layers!.some(l => /_node0$/.test(l.id))).toBe(true);
  });

  it('plain `list` stays bullets — no flow nodes', () => {
    const g = expandShorthand({ id: 'ls', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'X',
      blocks: [{ kind: 'list', items: [{ title: 'A', desc: 'a' }, { title: 'B', desc: 'b' }] }] } as unknown as ShorthandLayer) as { layers?: SL[] };
    expect(g.layers!.some(l => /_node\d+$/.test(l.id))).toBe(false);
  });
});

describe('sections — pricing / plans block', () => {
  type SL = { id: string; type: string };
  const pr = (block: object): { layers?: SL[] } => expandShorthand({
    id: 'pr', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], title: 'X', blocks: [block],
  } as unknown as ShorthandLayer) as { layers?: SL[] };

  it('renders one card per tier + a price + per-feature rows', () => {
    const g = pr({ kind: 'pricing', items: [
      { name: 'Free', price: '$0', period: '/mo', features: ['Basic streaming', 'Ads'] },
      { name: 'Plus', price: '$9', period: '/mo', features: ['Offline', 'No ads', 'HD'], highlight: true },
      { name: 'Pro', price: '$15', period: '/mo', features: ['Hi-fi', 'Family'] },
    ] });
    const ids = g.layers!.map(l => l.id);
    expect(ids.filter(i => /_card\d+$/.test(i)).length).toBe(3);
    expect(ids.filter(i => /_pp\d+$/.test(i)).length).toBe(3);        // one price per tier
    expect(ids.filter(i => /_pf\d+_\d+$/.test(i)).length).toBe(7);    // 2+3+2 features
  });

  it('handles tiers/plans + perks aliases', () => {
    const g = pr({ kind: 'plans', tiers: [
      { title: 'Basic', cost: 'Free', perks: ['x'] },
      { title: 'Pro', cost: '$9', perks: ['y', 'z'] },
    ] });
    expect(g.layers!.filter(l => /_card\d+$/.test(l.id)).length).toBe(2);
  });
});

describe('sections — timeline / milestones block', () => {
  type SL = { id: string; type: string; y: number };
  const tl = (block: object): { layers?: SL[] } => expandShorthand({
    id: 'tl', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'X', blocks: [block],
  } as unknown as ShorthandLayer) as { layers?: SL[] };

  it('renders a date + node + rail + event per milestone, measured & stacked', () => {
    const g = tl({ kind: 'timeline', items: [
      { date: '2019', title: 'Founded', desc: 'Two engineers in a garage with one idea.' },
      { date: '2021', title: 'Seed round', desc: 'Raised capital to grow the team.' },
      { date: '2024', title: 'Acquired', desc: 'A big exit caps the journey.' },
    ] });
    const ids = g.layers!.map(l => l.id);
    expect(ids.filter(i => /_node\d+$/.test(i)).length).toBe(3);
    expect(ids.filter(i => /_dt\d+$/.test(i)).length).toBe(3);    // date labels
    expect(ids.filter(i => /_rail\d+$/.test(i)).length).toBe(2);  // n-1 connectors
    expect(ids.filter(i => /_tt\d+$/.test(i)).length).toBe(3);    // event titles
    const ny = (i: number): number => g.layers!.find(l => l.id === `tl_b0_node${i}`)!.y;
    expect(ny(0)).toBeLessThan(ny(1));
    expect(ny(1)).toBeLessThan(ny(2));
  });
});

describe('sections — versus / comparison block', () => {
  type SL = { id: string; type: string };
  const vs = (block: object): { layers?: SL[] } => expandShorthand({
    id: 'cmp', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'X', blocks: [block],
  } as unknown as ShorthandLayer) as { layers?: SL[] };

  it('renders two option headers + per-row A/B values + a center divider', () => {
    const g = vs({ kind: 'versus', a_label: 'Classroom', b_label: 'App', rows: [
      { label: 'Cost', a: 'High upfront', b: 'Low monthly' },
      { label: 'Pace', a: 'Fixed schedule', b: 'Flexible' },
      { label: 'Speaking', a: 'Lots of practice', b: 'Limited' },
    ] });
    const ids = g.layers!.map(l => l.id);
    expect(ids.some(i => /_ha$/.test(i))).toBe(true);
    expect(ids.some(i => /_hb$/.test(i))).toBe(true);
    expect(ids.filter(i => /_ra\d+$/.test(i)).length).toBe(3);
    expect(ids.filter(i => /_rb\d+$/.test(i)).length).toBe(3);
    expect(ids.some(i => /_div$/.test(i))).toBe(true);
  });

  it('handles alias data shapes (options[] + left/right)', () => {
    const g = vs({ kind: 'comparison', options: ['A', 'B'], items: [{ attribute: 'Speed', left: 'Slow', right: 'Fast' }] });
    expect(g.layers!.filter(l => /_ra\d+$/.test(l.id)).length).toBe(1);
    expect(g.layers!.filter(l => /_rb\d+$/.test(l.id)).length).toBe(1);
  });
});

describe('sections — native donut + line data viz (rasterizing, no foreignObject)', () => {
  type SL = { id: string; type: string };
  const sec = (block: object): { layers?: SL[] } => expandShorthand({
    id: 'dv', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'Data', blocks: [block],
  } as unknown as ShorthandLayer) as { layers?: SL[] };

  it('donut renders one arc path per slice + a legend (swatch + label + %)', () => {
    const g = sec({ kind: 'donut', items: [{ label: 'BEV', value: 70 }, { label: 'PHEV', value: 20 }, { label: 'FCEV', value: 10 }] });
    const ids = g.layers!.map(l => l.id);
    expect(ids.filter(i => /_arc\d+$/.test(i)).length).toBe(3);
    expect(g.layers!.filter(l => l.type === 'path' && /_arc/.test(l.id)).length).toBe(3);
    expect(ids.filter(i => /_sw\d+$/.test(i)).length).toBe(3);   // legend swatches
    expect(ids.filter(i => /_lp\d+$/.test(i)).length).toBe(3);   // % labels
  });

  it('line/trend renders a polyline path + area + dots + x labels', () => {
    const g = sec({ kind: 'line', items: [{ x: '2019', y: 2 }, { x: '2020', y: 4 }, { x: '2021', y: 9 }, { x: '2022', y: 14 }] });
    const ids = g.layers!.map(l => l.id);
    expect(ids.some(i => /_line$/.test(i))).toBe(true);
    expect(ids.some(i => /_area$/.test(i))).toBe(true);
    expect(ids.filter(i => /_dot\d+$/.test(i)).length).toBe(4);
    expect(ids.filter(i => /_lx\d+$/.test(i)).length).toBe(4);
  });

  it('pie still emits one path per slice (no inner hole)', () => {
    const g = sec({ kind: 'pie', items: [{ label: 'A', value: 1 }, { label: 'B', value: 1 }] });
    expect(g.layers!.filter(l => /_arc\d+$/.test(l.id)).length).toBe(2);
  });
});

describe('composeBackground — engine-composed rich backgrounds (bg_style)', () => {
  const sec = (bg_style: string) => expandShorthand({
    id: 'sx', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'T', bg_style,
    blocks: [{ kind: 'text', text: 'Body.' }],
  } as unknown as ShorthandLayer) as unknown as { type: string; layers: Array<Record<string, unknown>> };

  it('"gradient + dots + curve" → linear base + pattern overlay + curved-gradient sweep, content above bg', () => {
    const g = sec('gradient + dots + curve');
    const base = g.layers.find(l => l.id === 'sx_bg')!;
    expect((base.fill as { type?: string }).type).toBe('linear');
    const tex = g.layers.find(l => l.id === 'sx_tex')!;
    expect((tex.fill as { type?: string; pattern?: string }).pattern).toBe('dots');
    const curve = g.layers.find(l => l.id === 'sx_curve')!;
    expect(curve.type).toBe('ellipse');
    // content title z sits above every background layer
    const bgZmax = Math.max(...g.layers.filter(l => /_(bg|tex|curve|mesh|glow|band)/.test(String(l.id))).map(l => Number(l.z)));
    const title = g.layers.find(l => l.id === 'sx_title')!;
    expect(Number(title.z)).toBeGreaterThan(bgZmax);
  });

  it('"mesh" → solid base + ≥3 soft radial blobs, kept SUBTLE (de-glowed)', () => {
    const g = sec('mesh');
    const blobs = g.layers.filter(l => l.type === 'ellipse' && (l.fill as { type?: string })?.type === 'radial');
    expect(blobs.length).toBeGreaterThanOrEqual(3);
    // Each mesh blob must stay a quiet tonal wash, not a saturated "AI glow" blob:
    // low opacity, and tinted TOWARD the bg (not the raw palette hue).
    for (const b of blobs) {
      expect(Number((b as unknown as { opacity: number }).opacity)).toBeLessThanOrEqual(0.3);
      const stops = (b.fill as { stops?: { color: string }[] }).stops ?? [];
      expect(stops[0]?.color.toLowerCase()).not.toBe('#5b8cff'); // not the raw accent — mixed toward bg
    }
  });

  it('"gradient + grain" → adds a faint noise-fill film-grain overlay', () => {
    const g = sec('gradient + grain');
    const grain = g.layers.find(l => l.id === 'sx_grain')!;
    expect(grain).toBeTruthy();
    expect((grain.fill as { type?: string }).type).toBe('noise');
    expect((grain.fill as { opacity?: number }).opacity).toBeLessThan(0.1);
  });

  it('"marble" → corner radial clusters', () => {
    const g = sec('marble');
    const blobs = g.layers.filter(l => String(l.id).includes('_mb') && l.type === 'ellipse');
    expect(blobs.length).toBeGreaterThanOrEqual(4);
  });

  it('"glow + band" → top glow ellipse + a solid edge band rect', () => {
    const g = sec('glow + band');
    expect(g.layers.some(l => l.id === 'sx_glow' && l.type === 'ellipse')).toBe(true);
    const band = g.layers.find(l => l.id === 'sx_band')!;
    expect(band.type).toBe('rect');
    expect((band.fill as { type?: string }).type).toBe('solid');
  });

  it('no bg_style → a designed default bg with a grain texture floor, NOT a bare flat fill', () => {
    const g = expandShorthand({ id: 'f', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'T',
      blocks: [{ kind: 'text', text: 'b' }] } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
    // A FLAT solid canvas is now a valid, intentional outcome (the over-processed
    // washes were the complaint) — but it always carries a grain texture floor +
    // a real base fill, never the old bare single-rect fallback.
    expect(g.layers.some(l => /_grain$/.test(String(l.id)))).toBe(true);
    expect(g.layers.some(l => l.id === 'f_bg')).toBe(true);
  });
});

describe('composeBackground — wired into feature_grid + split', () => {
  it('feature_grid bg_style → bg stack behind, title/cards z above every bg layer', () => {
    const g = expandShorthand({
      id: 'fg', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080],
      bg: '#0A0A0A', bg_style: 'mesh + glow + grid', accent: '#FF3D00', text_color: '#FAFAFA',
      title: 'Nova', subtitle: 'deck', items: [{ icon: 'zap', title: 'Fast', desc: 'd' }],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
    const bgZ = g.layers.filter(l => /_(bg|mesh|glow|grid|tex|curve|band)/.test(String(l.id))).map(l => Number(l.z));
    expect(bgZ.length).toBeGreaterThanOrEqual(3);
    const title = g.layers.find(l => l.id === 'fg_title')!;
    const row = g.layers.find(l => l.id === 'fg_row')!;
    expect(Number(title.z)).toBeGreaterThan(Math.max(...bgZ));
    expect(Number(row.z)).toBeGreaterThan(Math.max(...bgZ));
  });

  it('split bg_style → rich bg, panel above the bg stack, content above the panel', () => {
    const g = expandShorthand({
      id: 'sp', type: 'split', z: 0, pos: [0, 0, 1200, 800], side: 'left', ratio: 'golden',
      bg: '#FAF5EC', bg_style: 'gradient + dots', accent: '#B8543C', title: 'Headline', subtitle: 'deck',
    } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
    const panel = g.layers.find(l => l.id === 'sp_panel')!;
    const bgOnly = g.layers.filter(l => /_(bg|tex|curve|glow|mesh|band)/.test(String(l.id))).map(l => Number(l.z));
    expect(Number(panel.z)).toBeGreaterThan(Math.max(...bgOnly));
    const title = g.layers.find(l => l.id === 'sp_title')!;
    expect(Number(title.z)).toBeGreaterThan(Number(panel.z));
  });

  it('feature_grid without bg_style → designed default bg (glow + grain on the deep canvas), not flat', () => {
    const g = expandShorthand({
      id: 'fg2', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080], bg: '#0A0A0A',
      title: 'X', items: [{ icon: 'zap', title: 'A', desc: 'd' }],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
    expect(g.layers.some(l => /_glow/.test(String(l.id)))).toBe(true);
    expect(g.layers.some(l => /_grain$/.test(String(l.id)))).toBe(true);
    expect(g.layers.some(l => l.id === 'fg2_bg')).toBe(true);
  });
});
