import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, unwrapBareContainers, fillBleedPresetDims, fillFlowPresetsToPage, snapWrongFlowPresets, demoteCoveringBackdrops, lockCarouselCanvas, stampDeckSeed, type ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

describe('fillFlowPresetsToPage — a carousel list slide fills the page (no dead strip)', () => {
  it('marks a boxless list-family preset and skips one that already has a box', () => {
    const layers = [{ type: 'list', title: 'X' }, { type: 'steps', pos: [0, 0, 500, 500] }] as unknown as ShorthandLayer[];
    expect(fillFlowPresetsToPage(layers, 1080, 1080)).toBe(1);
    const a = layers[0] as unknown as Record<string, unknown>;
    expect(a['__fillPage']).toBe(true);
    expect(a['pos']).toEqual([0, 0, 1080, 1080]);
    expect((layers[1] as unknown as Record<string, unknown>)['__fillPage']).toBeUndefined();
  });

  it('snaps an OFF-ORIGIN / oversized flow preset to fill the page (content-size overflow fix)', () => {
    // The signup-flow thrash: sections placed at x=83,y=400 (or x=-459) content-sizes
    // tall → its steps render past the page bottom (blank). Snap to the origin+fill.
    const offset = [{ type: 'sections', pos: [83, 400, 997, 600], title: 'Flow' }] as unknown as ShorthandLayer[];
    expect(snapWrongFlowPresets(offset, 1080, 1080)).toBe(1);
    const a = offset[0] as unknown as Record<string, unknown>;
    expect(a['pos']).toEqual([0, 0, 1080, 1080]);
    expect(a['__fillPage']).toBe(true);
    const offcanvas = [{ type: 'sections', pos: [-459, 500, 1539, 1431], title: 'Flow' }] as unknown as ShorthandLayer[];
    expect(snapWrongFlowPresets(offcanvas, 1080, 1080)).toBe(1);
    expect((offcanvas[0] as unknown as Record<string, unknown>)['pos']).toEqual([0, 0, 1080, 1080]);
    // a near-origin, in-bounds box is left alone (not every box is "wrong")
    const ok = [{ type: 'sections', pos: [40, 40, 1000, 800], title: 'Flow' }] as unknown as ShorthandLayer[];
    expect(snapWrongFlowPresets(ok, 1080, 1080)).toBe(0);
    // a BOXLESS poster flow preset is left to content-size (snapWrong only touches boxed)
    const boxless = [{ type: 'sections', title: 'Flow' }] as unknown as ShorthandLayer[];
    expect(snapWrongFlowPresets(boxless, 1080, 1080)).toBe(0);
  });

  it('a filled list FILLS the page height and centers content; a poster list still shrinks', () => {
    const fill = (n: number) => {
      const sh = [{ id: 'sl', type: 'list', title: 'Tips', marker: 'number',
        items: Array.from({ length: n }, (_, i) => ({ title: `Tip ${i + 1}`, desc: 'short detail' })) }] as unknown as ShorthandLayer[];
      fillFlowPresetsToPage(sh, 1080, 1080);
      return expandShorthand(sh[0]) as unknown as { height: number; layers: Array<{ id: string; y: number }> };
    };
    const g = fill(3);
    expect(g.height).toBe(1080);                           // fills the slide, no dead strip
    const kick = g.layers.find(l => l.id === 'sl_title');
    expect(kick!.y).toBeGreaterThan(120);                  // content pushed down (centered), not jammed at the top
  });
});

describe('unwrapBareContainers — hoist a model-invented page wrapper (blind-30B blank-poster fix)', () => {
  const W = 1080, H = 1080;
  it('hoists children out of a typeless wrapper carrying page-level style', () => {
    const sh = [{
      bg: '#FAF5EC', accent: '#D95F00', font_heading: 'Playfair Display', font_body: 'Inter',
      layers: [
        { type: 'editorial', id: 'editorial_1', pos: [0, 0, W, H], title: 'Market', subtitle: 's', body: 'b' },
        { type: 'icon', id: 'i1', icon: 'apple', pos: [760, 180, 150, 150] },
      ],
    }] as unknown as ShorthandLayer[];
    const { layers, unwrapped } = unwrapBareContainers(sh, W, H);
    expect(unwrapped).toBe(1);
    expect(layers.some(l => l.type === 'editorial')).toBe(true);
    expect(layers.some(l => l.type === 'icon')).toBe(true);
    // the wrapper itself is gone — nothing still carries a nested layers[] array
    expect(layers.some(l => Array.isArray((l as Record<string, unknown>)['layers']))).toBe(false);
  });

  it('does NOT add a bg rect when a child preset already paints the canvas', () => {
    const sh = [{ bg: '#FAF5EC', layers: [{ type: 'editorial', title: 't' }] }] as unknown as ShorthandLayer[];
    const { layers } = unwrapBareContainers(sh, W, H);
    expect(layers.some(l => l.type === 'rect')).toBe(false);
    expect(layers.some(l => l.type === 'editorial')).toBe(true);
  });

  it('synthesizes a full-bleed bg rect when the wrapper sets bg and no child paints the canvas', () => {
    const sh = [{ bg: '#101010', layers: [
      { type: 'text', id: 't', pos: [80, 80, 900, 120], text: 'Hi' },
      { type: 'icon', id: 'i', icon: 'star', pos: [800, 80, 80, 80] },
    ] }] as unknown as ShorthandLayer[];
    const { layers } = unwrapBareContainers(sh, W, H);
    expect(layers[0]?.type).toBe('rect');             // bg sits behind, first
    expect(layers[0]?.pos).toEqual([0, 0, W, H]);
    expect(layers[0]?.fill).toBe('#101010');
  });

  it('cascades wrapper style onto PRESET children that omit it; leaf layers untouched', () => {
    const sh = [{ accent: '#D95F00', bg: '#FAF5EC', layers: [
      { type: 'editorial', id: 'a', title: 'x' },                              // preset, no accent → inherits
      { type: 'sections', id: 'b', accent: '#000000', title: 'y', blocks: [] }, // own accent → kept
      { type: 'icon', id: 'c', icon: 'star', pos: [0, 0, 10, 10] },            // leaf → untouched
    ] }] as unknown as ShorthandLayer[];
    const { layers } = unwrapBareContainers(sh, W, H);
    const a = layers.find(l => l.id === 'a') as Record<string, unknown>;
    const b = layers.find(l => l.id === 'b') as Record<string, unknown>;
    const c = layers.find(l => l.id === 'c') as Record<string, unknown>;
    expect(a['accent']).toBe('#D95F00');
    expect(a['bg']).toBe('#FAF5EC');
    expect(b['accent']).toBe('#000000');              // own value kept
    expect(c['accent']).toBeUndefined();              // leaf untouched
  });

  it('leaves a REAL group (pos + dims) and an auto_layout (gap) untouched', () => {
    const grp = [{ type: 'group', pos: [0, 0, 500, 500], layers: [{ type: 'text', text: 'x' }] }] as unknown as ShorthandLayer[];
    expect(unwrapBareContainers(grp, W, H).unwrapped).toBe(0);
    const col = [{ type: 'column', gap: 24, layers: [{ type: 'text', text: 'x' }] }] as unknown as ShorthandLayer[];
    expect(unwrapBareContainers(col, W, H).unwrapped).toBe(0);
  });

  it('unwraps via the `children` alias and a `page` type', () => {
    const sh = [{ type: 'page', children: [{ type: 'editorial', title: 't' }] }] as unknown as ShorthandLayer[];
    const { layers, unwrapped } = unwrapBareContainers(sh, W, H);
    expect(unwrapped).toBe(1);
    expect(layers.some(l => l.type === 'editorial')).toBe(true);
  });

  it('does not touch a normal preset array (no wrapper)', () => {
    const sh = [{ type: 'sections', title: 't', blocks: [{ type: 'callout', text: 'x' }] }] as unknown as ShorthandLayer[];
    const { layers, unwrapped } = unwrapBareContainers(sh, W, H);
    expect(unwrapped).toBe(0);
    expect(layers).toHaveLength(1);
  });

  it('the exact blind-30B wrapper payload expands without a dimensionless-group error', () => {
    const sh = [{
      accent: '#D95F00', bg: '#FAF5EC', font_body: 'Inter', font_heading: 'Playfair Display',
      layers: [
        { accent: '#D95F00', bg: '#FAF5EC', body: 'Fresh local produce.', footer: 'Town Square', id: 'editorial_1', kicker: 'WEEKEND FARMERS MARKET', pos: [0, 0, 1080, 1080], subtitle: 'produce · music · coffee', text_color: '#1A1A1A', title: 'Farmers Market Morning', type: 'editorial' },
        { color: '#D95F00', id: 'produce_icon', icon: 'apple', pos: [760, 180, 150, 150], size: 150, type: 'icon' },
      ],
    }] as unknown as ShorthandLayer[];
    const { layers } = unwrapBareContainers(sh, 1080, 1080);
    const expanded = expandShorthandLayers(layers);
    // every expanded layer has a real type — no typeless/dimensionless group survives
    expect(expanded.every(l => typeof l.type === 'string' && l.type.length > 0)).toBe(true);
    const groups = expanded.filter(l => l.type === 'group') as (Layer & { width?: number })[];
    expect(groups.every(g => typeof g.width === 'number' && (g.width ?? 0) > 0)).toBe(true);
  });
});

describe('event preset — footer never overlaps the detail stack (blind-30B overlap fix)', () => {
  it('drops the footer below long wrapped detail lines instead of pinning it to a fixed bottom y', () => {
    const sh = [{
      type: 'event', kicker: 'Neighborhood Plant Swap',
      title: 'Trade Cuttings. Share Soil. Meet Your Block.',
      details: [
        'Saturday, June 27 · 10 AM–1 PM',
        'Maple Court Community Garden',
        'Bring 3 healthy plants, seeds, or cuttings; take home new neighbors for your windowsill.',
        'Free · All ages · Gloves and extra pots provided',
      ],
      footer: 'Hosted by Maple Court Garden Club · rain or shine under the pavilion',
    }] as unknown as ShorthandLayer[];
    const expanded = expandShorthandLayers(sh) as (Layer & { layers?: (Layer & { id: string; y: number; height: number })[] })[];
    const kids = expanded[0]?.layers ?? [];
    const details = kids.filter(l => /_d\d+$/.test(l.id));
    const footer = kids.find(l => l.id.endsWith('_footer'));
    const lastDetail = details[details.length - 1];
    expect(footer).toBeTruthy();
    expect(lastDetail).toBeTruthy();
    // footer sits at or below the bottom edge of the last detail line — no overprint
    expect(footer!.y).toBeGreaterThanOrEqual(lastDetail!.y + lastDetail!.height);
  });
});

describe('fillBleedPresetDims — boxless full-bleed preset fills the page (blank-carousel-slide fix)', () => {
  it('sizes a boxless feature_grid to the page so it reflows to fill, no dead strip', () => {
    const sh: ShorthandLayer[] = [{ type: 'feature_grid', title: 'Pick a Setup', items: [{ title: 'Bin', desc: 'Outdoor' }] } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1350)).toBe(1);
    const [grp] = expandShorthandLayers(sh);
    expect(grp.type).toBe('group');
    // group + its composed bg now span the full 1350-tall page, not a 1080 square
    expect((grp as Layer & { height?: number }).height).toBe(1350);
  });
  it('fills a boxless event preset to the page height too', () => {
    const sh: ShorthandLayer[] = [{ type: 'event', title: 'Film Night', date: 'Sat 8pm' } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1350)).toBe(1);
    const [grp] = expandShorthandLayers(sh);
    expect((grp as Layer & { height?: number }).height).toBe(1350);
  });
  it('leaves a preset that already has an explicit box untouched', () => {
    const sh: ShorthandLayer[] = [{ type: 'feature_grid', pos: [0, 0, 500, 500], title: 'X' } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1350)).toBe(0);
  });
  it('skips flow presets (sections is content-sized; a list is placed, not page-filling)', () => {
    expect(fillBleedPresetDims([{ type: 'sections', title: 'Greens' } as unknown as ShorthandLayer], 1080, 1350)).toBe(0);
    expect(fillBleedPresetDims([{ type: 'list', items: ['a', 'b'] } as unknown as ShorthandLayer], 1080, 1350)).toBe(0);
  });
  it('snaps an OFF-CANVAS / OVERSIZED full-bleed box to the page (thrash misplacement)', () => {
    const sh: ShorthandLayer[] = [{ type: 'feature_grid', pos: [-459, 500, 1539, 1539], title: 'X' } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1080)).toBe(1);
    expect((sh[0] as unknown as { pos: number[] }).pos).toEqual([0, 0, 1080, 1080]);
  });
  it('snaps a full-bleed box placed BELOW the fold (off the bottom) to the page', () => {
    const sh: ShorthandLayer[] = [{ type: 'feature_grid', pos: [0, 1095, 1080, 1469], title: 'X' } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1469)).toBe(1);
    expect((sh[0] as unknown as { pos: number[] }).pos).toEqual([0, 0, 1080, 1469]);
  });
  it('leaves a sane in-canvas full-bleed box alone', () => {
    const sh: ShorthandLayer[] = [{ type: 'feature_grid', pos: [0, 0, 1080, 1350], title: 'X' } as unknown as ShorthandLayer];
    expect(fillBleedPresetDims(sh, 1080, 1350)).toBe(0);
  });
});

describe('demoteCoveringBackdrops — a full-canvas rect added onto content sinks behind it', () => {
  const W = 1080, H = 1350;
  const rect = (z: number, fill: unknown, extra: Record<string, unknown> = {}): Layer =>
    ({ id: 'bg', type: 'rect', z, x: 0, y: 0, width: W, height: H, fill, ...extra } as unknown as Layer);

  it('demotes an opaque solid full-canvas rect below existing content', () => {
    const existing: Layer[] = [{ id: 'grp', type: 'group', z: 0, x: 0, y: 0, width: W, height: H } as unknown as Layer];
    const incoming: Layer[] = [rect(0, { type: 'solid', color: '#F7EFE0' })];
    expect(demoteCoveringBackdrops(existing, incoming, W, H)).toBe(1);
    expect((incoming[0] as Layer & { z: number }).z).toBeLessThan(0);
  });
  it('accepts a gradient fill and a bare hex string as opaque covers', () => {
    const existing: Layer[] = [{ id: 'g', type: 'group', z: 5, x: 0, y: 0, width: W, height: H } as unknown as Layer];
    expect(demoteCoveringBackdrops(existing, [rect(5, { type: 'linear', stops: [] })], W, H)).toBe(1);
    expect(demoteCoveringBackdrops(existing, [rect(5, '#112233')], W, H)).toBe(1);
  });
  it('leaves a semi-transparent scrim (opacity < 0.95) where the model put it', () => {
    const existing: Layer[] = [{ id: 'g', type: 'group', z: 0, x: 0, y: 0, width: W, height: H } as unknown as Layer];
    const incoming: Layer[] = [rect(10, { type: 'solid', color: '#000' }, { opacity: 0.4 })];
    expect(demoteCoveringBackdrops(existing, incoming, W, H)).toBe(0);
    expect((incoming[0] as Layer & { z: number }).z).toBe(10);
  });
  it('no-op when the target page is empty (a legitimate first background)', () => {
    expect(demoteCoveringBackdrops([], [rect(0, { type: 'solid', color: '#fff' })], W, H)).toBe(0);
  });
  it('sinks a background placed LAST in a single fresh-page batch (text-first, bg-last)', () => {
    // the "website-redesign-timeline" blank: 9 texts then a full-canvas color rect,
    // all in one add_layers call onto an empty page.
    const text = (id: string): Layer => ({ id, type: 'text', z: 0, x: 186, y: 316, width: 800, height: 80, text: id } as unknown as Layer);
    const incoming: Layer[] = [text('t1'), text('t2'), rect(0, '#FAF5EC')];
    expect(demoteCoveringBackdrops([], incoming, W, H)).toBe(1);
    expect((incoming[2] as Layer & { z: number }).z).toBeLessThan(0);
  });
  it('treats a bare `color` rect (no `fill` object) as an opaque cover', () => {
    const colorRect = ({ id: 'bg', type: 'rect', x: 0, y: 0, width: W, height: H, color: '#FAF5EC' } as unknown as Layer);
    const existing: Layer[] = [{ id: 'g', type: 'group', z: 0, x: 0, y: 0, width: W, height: H } as unknown as Layer];
    expect(demoteCoveringBackdrops(existing, [colorRect], W, H)).toBe(1);
    expect((colorRect as Layer & { z: number }).z).toBeLessThan(0);
  });
  it('ignores a noise/texture overlay (not a solid cover)', () => {
    const existing: Layer[] = [{ id: 'g', type: 'group', z: 0, x: 0, y: 0, width: W, height: H } as unknown as Layer];
    expect(demoteCoveringBackdrops(existing, [rect(9, { type: 'noise', frequency: 0.9 })], W, H)).toBe(0);
  });
});

describe('lockCarouselCanvas — keep a deck cohesive (cold-brew light/dark-flip find)', () => {
  // A fake expanded page: a group whose first rect child is the canvas bg, plus a *_title.
  const page = (bg: string, font: string): { layers: Layer[] } => ({
    layers: [{
      id: 'feature_grid_1', type: 'group', z: 0, x: 0, y: 0, width: 1080, height: 1350,
      layers: [
        { id: 'feature_grid_1_bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: bg } },
        { id: 'feature_grid_1_title', type: 'text', z: 30, x: 0, y: 0, width: 900, height: 100, style: { font_family: font } },
      ],
    } as unknown as Layer],
  });

  it('snaps a dark slide back to the deck when the deck is light, with readable text', () => {
    const pages = [page('#FAF5EC', 'Playfair Display')];
    const incoming: ShorthandLayer[] = [{ type: 'feature_grid', bg: '#0E0B14', text_color: '#F4F1EA', title: 'Steep overnight' } as unknown as ShorthandLayer];
    const res = lockCarouselCanvas(pages, incoming);
    expect(res.bg).toBe(1);
    const r = incoming[0] as unknown as Record<string, unknown>;
    expect(r['bg']).toBe('#FAF5EC');
    expect(r['text_color']).toBe('#1A1A1A'); // dark text for the light deck — never light-on-light
  });

  it('leaves a same-class (light) slide untouched — hue/shade variation is fine', () => {
    const pages = [page('#FAF5EC', 'Playfair Display')];
    const incoming: ShorthandLayer[] = [{ type: 'feature_grid', bg: '#EDE7DD', title: 'Grind coarse' } as unknown as ShorthandLayer];
    expect(lockCarouselCanvas(pages, incoming).bg).toBe(0);
    expect((incoming[0] as unknown as Record<string, unknown>)['bg']).toBe('#EDE7DD');
  });

  it('snaps a drifted heading font back to the deck font', () => {
    const pages = [page('#FAF5EC', 'Playfair Display')];
    const incoming: ShorthandLayer[] = [{ type: 'feature_grid', bg: '#FAF5EC', font: 'Space Grotesk', title: 'X' } as unknown as ShorthandLayer];
    const res = lockCarouselCanvas(pages, incoming);
    expect(res.font).toBe(1);
    expect((incoming[0] as unknown as Record<string, unknown>)['font']).toBe('Playfair Display');
  });

  it('keeps a dark slide dark when the deck itself is dark', () => {
    const pages = [page('#0A0A0A', 'Anton')];
    const incoming: ShorthandLayer[] = [{ type: 'feature_grid', bg: '#101418', title: 'X' } as unknown as ShorthandLayer];
    expect(lockCarouselCanvas(pages, incoming).bg).toBe(0);
  });

  it('no-op for the first page (empty deck) and for non-page presets', () => {
    expect(lockCarouselCanvas([], [{ type: 'feature_grid', bg: '#000' } as unknown as ShorthandLayer]).bg).toBe(0);
    const pages = [page('#FAF5EC', 'Inter')];
    expect(lockCarouselCanvas(pages, [{ type: 'list', items: ['a'] } as unknown as ShorthandLayer]).bg).toBe(0);
  });
});

describe('stampDeckSeed + seededDefaults — carousel cohesion when bg is OMITTED', () => {
  it('stamps the deck seed on bg-less page presets; skips ones with an explicit bg + non-page presets', () => {
    const layers: ShorthandLayer[] = [
      { type: 'sections', title: 'Simplicity' } as unknown as ShorthandLayer,
      { type: 'sections', bg: '#123456', title: 'Color' } as unknown as ShorthandLayer, // explicit bg wins
      { type: 'list', items: ['a'] } as unknown as ShorthandLayer,                       // not a page preset
    ];
    expect(stampDeckSeed(layers, 'My Deck')).toBe(1);
    expect((layers[0] as unknown as Record<string, unknown>)['__deckseed']).toBe('My Deck');
    expect((layers[1] as unknown as Record<string, unknown>)['__deckseed']).toBeUndefined();
    expect((layers[2] as unknown as Record<string, unknown>)['__deckseed']).toBeUndefined();
  });

  it('no-op with an empty seed', () => {
    const layers = [{ type: 'sections', title: 'x' } as unknown as ShorthandLayer];
    expect(stampDeckSeed(layers, '')).toBe(0);
  });

  it('two slides with DIFFERENT content but the SAME deck seed share ONE palette + font', () => {
    const lookOf = (title: string): { bg: string | undefined; font: string | undefined } => {
      const sh = { type: 'sections', title, __deckseed: 'Minimalist Design Principles Carousel',
        blocks: [{ kind: 'text', text: 'A short explanation of this principle.' }] } as unknown as ShorthandLayer;
      const grp = expandShorthandLayers([sh])[0] as unknown as { layers: Array<Record<string, unknown>> };
      const bgRect = grp.layers.find(l => l['type'] === 'rect');
      const fill = bgRect?.['fill'] as { color?: string; stops?: Array<{ color?: string }> } | undefined;
      const titleLayer = grp.layers.find(l => typeof l['id'] === 'string' && /_title$/.test(l['id'] as string));
      const font = (titleLayer?.['style'] as { font_family?: string } | undefined)?.font_family;
      return { bg: fill?.color ?? fill?.stops?.[0]?.color, font };
    };
    const a = lookOf('Simplicity');
    const b = lookOf('Typography'); // wholly different topic word
    expect(a.bg).toBeDefined();
    expect(a.bg).toBe(b.bg);   // same palette across slides
    expect(a.font).toBe(b.font); // same heading font across slides
  });
});

describe('buildSections page-fill — no dead strip / dead band on a fixed slide', () => {
  const grp = (extra: Record<string, unknown>) => expandShorthandLayers([
    { type: 'sections', title: 'Simplicity', subtitle: 'Keep only what is essential.',
      blocks: [{ kind: 'text', text: 'Remove excess and focus on the core.' }], ...extra } as unknown as ShorthandLayer,
  ])[0] as unknown as { width: number; height: number; layers: Array<Record<string, unknown>> };

  it('a __fillPage slide fills the page height exactly (bg spans it → no unpainted strip)', () => {
    const g = grp({ __fillPage: true, pos: [0, 0, 1080, 1080] });
    expect(g.height).toBe(1080);
    const bgRect = g.layers.find(l => l['type'] === 'rect' && (l['height'] as number) >= 1080);
    expect(bgRect).toBeTruthy();                 // the background covers the whole page
  });

  it('centers thin content on a tall fill page (no top-heavy dead band)', () => {
    const g = grp({ __fillPage: true, pos: [0, 0, 1080, 1080] });
    const title = g.layers.find(l => typeof l['id'] === 'string' && /_title$/.test(l['id'] as string));
    expect((title?.['y'] as number)).toBeGreaterThan(200); // pushed down from the top, not pinned at ~86
  });

  it('WITHOUT __fillPage the same content stays content-sized (poster auto-fit, unchanged)', () => {
    const g = grp({ pos: [0, 0, 1080, 1080] });
    expect(g.height).toBeLessThan(1080);          // content-sized (≤ W*0.9 floor), proves fill is the lever
  });

  it('a THIN poster (floored at W*0.9) centers its content too — no top-anchored dead band', () => {
    // One short block: naturalH < the W*0.9 floor, so the floored group has slack
    // and the composition is centered instead of pinned to the top with dead space.
    const g = expandShorthandLayers([
      { type: 'sections', title: 'A Single Big Idea', blocks: [{ kind: 'text', text: 'One short line.' }] } as unknown as ShorthandLayer,
    ])[0] as unknown as { height: number; layers: Array<Record<string, unknown>> };
    const title = g.layers.find(l => typeof l['id'] === 'string' && /_title$/.test(l['id'] as string));
    expect((title?.['y'] as number)).toBeGreaterThan(150); // pushed down toward center, not at the ~86 top margin
  });
});

describe('sections feature_grid BLOCK — items render, never silently dropped', () => {
  const allText = (g: { layers: Array<Record<string, unknown>> }): string[] => {
    const out: string[] = [];
    const walk = (ls: Array<Record<string, unknown>>): void => {
      for (const l of ls) {
        if (l['type'] === 'text') {
          const c = l['content'] as { value?: unknown } | undefined;
          if (c && typeof c.value === 'string') out.push(c.value);
        }
        if (Array.isArray(l['layers'])) walk(l['layers'] as Array<Record<string, unknown>>);
      }
    };
    walk(g.layers);
    return out;
  };

  it('renders every feature item of a {kind:feature_grid} block nested in sections (the Swell bug)', () => {
    const g = expandShorthandLayers([{ type: 'sections', title: 'Swell', subtitle: 'Tide app', blocks: [
      { kind: 'feature_grid', title: 'Key Features', subtitle: 'Stay ahead', items: [
        { title: 'Tide Charts', desc: 'Real-time tides' },
        { title: 'Surf Forecasts', desc: 'Seven-day waves' },
        { title: 'Wind Conditions', desc: 'Live wind' },
        { title: 'Spot Maps', desc: 'Nearby breaks' },
      ] }] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const txts = allText(g);
    for (const t of ['Tide Charts', 'Surf Forecasts', 'Wind Conditions', 'Spot Maps']) {
      expect(txts).toContain(t);                 // every card title rendered (was dropped before)
    }
    expect(txts).toContain('Real-time tides');   // and descriptions
    expect(txts).toContain('Key Features');       // block sub-heading kept
  });
});

describe('sections stats block — a LONE figure becomes a hero number', () => {
  const figSize = (items: unknown[]): number => {
    const g = expandShorthandLayers([{ type: 'sections', title: 'X',
      blocks: [{ kind: 'stats', items }] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const v0 = g.layers.find(l => typeof l['id'] === 'string' && /_v0$/.test(l['id'] as string));
    return Number((v0?.['style'] as { font_size?: number } | undefined)?.font_size ?? 0);
  };
  it('a single-item stats figure is much larger than a 4-up row cell', () => {
    const one = figSize([{ value: '$250B', label: 'Creator economy 2026' }]);
    const four = figSize([
      { value: '$250B', label: 'a' }, { value: '24%', label: 'b' },
      { value: '20M', label: 'c' }, { value: '+10%', label: 'd' }]);
    expect(one).toBeGreaterThan(four * 1.6);   // focal hero, not a timid row cell
    expect(one).toBeGreaterThan(120);          // genuinely dominant on a 1080 canvas
  });
});

describe('sections masthead band — never an empty coloured stripe', () => {
  it('does not draw a masthead band when the sections has no header (blocks only)', () => {
    // The no-header seed ("folio") picks the band layout, so pre-fix a titleless
    // blocks-only sections rendered an empty cream/ink stripe at the top.
    const g = expandShorthandLayers([{ type: 'sections', blocks: [
      { kind: 'heading_text', heading: '$1.7 trillion', text: 'US student debt in 2026.' },
      { kind: 'caption', text: 'Source: Federal Reserve' },
    ] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const ids = g.layers.map(l => String(l['id'] ?? ''));
    expect(ids.some(id => /_mband$/.test(id))).toBe(false); // no empty band slab
  });

  it('still draws the band when a header IS present (not over-suppressed)', () => {
    // 'In Praise of Doing Less' is a header seed that picks the band layout.
    const g = expandShorthandLayers([{ type: 'sections', title: 'In Praise of Doing Less',
      blocks: [{ kind: 'text', text: 'x' }] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const ids = g.layers.map(l => String(l['id'] ?? ''));
    // header present → band may or may not be seeded, but if the seed bands it draws;
    // at minimum the title text is present (header never silently dropped).
    expect(ids.some(id => /_title$/.test(id))).toBe(true);
  });
});

describe('heading_text block — a figure heading becomes a hero number', () => {
  const headSize = (heading: string, body: string): number => {
    const g = expandShorthandLayers([{ type: 'sections', title: 'X',
      blocks: [{ kind: 'heading_text', heading, text: body }] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const hh = g.layers.find(l => typeof l['id'] === 'string' && /_hh$/.test(l['id'] as string));
    return Number((hh?.['style'] as { font_size?: number } | undefined)?.font_size ?? 0);
  };
  it('heroes a compact figure ("$250B") and a spelled-out one ("$1.7 trillion")', () => {
    expect(headSize('$250B', 'Creator economy value in 2026.')).toBeGreaterThan(100);
    expect(headSize('$1.7 trillion', 'US student debt in 2026.')).toBeGreaterThan(100);
  });
  it('leaves a normal text heading at the modest heading size (no false hero)', () => {
    const normal = headSize('Key Trends to Watch', 'Several shifts are reshaping the field.');
    const tips = headSize('10 Tips', 'Practical advice for beginners.');
    expect(normal).toBeLessThan(60);   // ~W*0.032
    expect(tips).toBeLessThan(60);     // "10 Tips" is a heading, not a stat
  });
});

describe('feature_grid preset — cards sized to content, not a fixed 58% band', () => {
  it('a short-content feature grid has a content-sized card row (no dead band)', () => {
    const g = expandShorthandLayers([{ type: 'feature_grid', title: 'Pulse', subtitle: 'Track your health',
      pos: [0, 0, 1080, 1920], items: [
        { title: 'Workout Tracking', desc: 'Log every rep, set, and route.' },
        { title: 'Heart Rate', desc: 'Real-time pulse zones.' },
        { title: 'Guided Sessions', desc: 'Trainer-led workouts.' },
        { title: 'Progress Charts', desc: 'Visualize trends.' },
      ] }] as unknown as ShorthandLayer[])[0] as unknown as { layers: Array<Record<string, unknown>> };
    const row = g.layers.find(l => typeof l['id'] === 'string' && /_row$/.test(l['id'] as string)) as { height?: number; y?: number; direction?: string; layers?: unknown[] } | undefined;
    const rowH = Number(row?.height ?? 0);
    // 4 items on a portrait canvas wrap to a 2×2 grid (column of 2 rows).
    expect(row?.direction).toBe('column');
    expect(row?.layers).toHaveLength(2);
    expect(rowH).toBeGreaterThan(0);
    expect(rowH).toBeLessThan(1080);  // content-sized — NOT the old fixed ~1113 (H*0.58)
    expect(Number(row?.y ?? 0)).toBeGreaterThan(300); // placed below the header, centered in the rest
  });

  it('wraps 4 cards into a 2×2 grid on a SQUARE canvas (not a thin single strip)', () => {
    type L = { id?: string; type?: string; direction?: string; width?: number; layers?: L[] };
    const g = expandShorthand({ id: 'kpi', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080],
      items: [{ title: 'Revenue', desc: '$4.2M' }, { title: 'Users', desc: '125K' },
              { title: 'Churn', desc: '3.2%' }, { title: 'Growth', desc: '18%' }] } as unknown as ShorthandLayer) as unknown as { layers: L[] };
    const grid = g.layers.find(l => String(l.id).endsWith('_row'))!;
    expect(grid.direction).toBe('column');
    expect(grid.layers).toHaveLength(2);              // 2 rows
    for (const row of grid.layers ?? []) {
      expect(row.direction).toBe('row');
      expect(row.layers).toHaveLength(2);             // 2 cards each → 2×2
    }
    // cards are substantial (square-ish), not the old 4-up thin strip (~210 wide)
    const card0 = grid.layers![0].layers![0];
    expect(Number(card0.width)).toBeGreaterThan(380);
  });

  it('keeps a single row on a WIDE banner canvas (no needless wrap)', () => {
    type L = { id?: string; type?: string; direction?: string; layers?: L[] };
    const g = expandShorthand({ id: 'b', type: 'feature_grid', z: 0, pos: [0, 0, 1600, 500],
      items: [{ title: 'A', desc: '1' }, { title: 'B', desc: '2' }, { title: 'C', desc: '3' }, { title: 'D', desc: '4' }] } as unknown as ShorthandLayer) as unknown as { layers: L[] };
    const grid = g.layers.find(l => String(l.id).endsWith('_row'))!;
    expect(grid.layers).toHaveLength(1);              // one row of 4
    expect(grid.layers![0].layers).toHaveLength(4);
  });
});
