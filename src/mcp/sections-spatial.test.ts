import { describe, it, expect } from 'vitest';
import { renderSectionBlock } from './shorthand-sections';
import { expandShorthand } from './shorthand-expand';
import type { SecCtx } from './shorthand-helpers';
import type { Layer } from '../schema/types';
import type { ShorthandLayer } from './shorthand-parser';

const baseCtx = (over: Partial<SecCtx>): SecCtx => ({
  accent: '#B8543C', text: '#1A1A1A', muted: '#666', bg: '#FAF5EC', W: 1080, palette: [], ...over,
});

const statsBlock = {
  kind: 'stats',
  items: [
    { value: '5+', label: 'Designs' }, { value: '95%', label: 'Saved' },
    { value: '3+', label: 'Models' }, { value: '4', label: 'Formats' },
  ],
};

function style(l: Layer): Record<string, unknown> {
  return ((l as unknown as { style?: Record<string, unknown> }).style) ?? {};
}

describe('sections stats — alignment follows the composition (left by default)', () => {
  it('LEFT composition: a 2-col stat grid left-anchors its cells (col 0 at the margin, no forced center)', () => {
    const ctx = baseCtx({ align: 'left', statCols: 2 });
    const { layers } = renderSectionBlock(statsBlock, 'b', 0, 120, 0, 840, ctx);
    const values = layers.filter(l => /_v\d+$/.test(l.id));
    expect(values.length).toBe(4);
    // col-0 figures start exactly at the content margin (x=120) — the same left
    // edge the heading/text blocks use — so the whole body shares one left edge.
    const col0 = values.filter((_, i) => i % 2 === 0);
    expect(col0.every(l => (l as unknown as { x: number }).x === 120)).toBe(true);
    // and they are NOT force-centered (the old `cols===2` bug)
    expect(values.every(l => style(l).align !== 'center')).toBe(true);
  });

  it('CENTER composition: an explicit centered layout still centers the cells', () => {
    const ctx = baseCtx({ align: 'center', statCols: 2 });
    const { layers } = renderSectionBlock(statsBlock, 'b', 0, 120, 0, 840, ctx);
    const values = layers.filter(l => /_v\d+$/.test(l.id));
    expect(values.length).toBe(4);
    expect(values.every(l => style(l).align === 'center')).toBe(true);
  });
});

describe('sections poster — body shares one left edge; masthead band is tight', () => {
  // This exact title/subtitle seeds a centered keynote + masthead-band layout —
  // the case that used to float the stats ~⅓-canvas off the body's left edge.
  const sh = {
    type: 'sections',
    kicker: 'AI Design Challenge',
    title: 'Folio MCP Enables Vision-Less AI to Design',
    subtitle: 'Using only text tools, Folio creates professional posters in minutes.',
    blocks: [
      statsBlock,
      { kind: 'heading_text', heading: 'From Manual to AI', body: 'Folio shifts the work to text-based MCP tools so the engine handles execution.' },
      { kind: 'heading_text', heading: 'Bulk Generation', body: 'Generate dozens of on-brand designs in a single prompt instead of days of manual work.' },
    ],
  } as unknown as ShorthandLayer;

  function flatten(l: Layer, out: Layer[] = []): Layer[] {
    out.push(l);
    const kids = (l as unknown as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) kids.forEach(k => flatten(k, out));
    return out;
  }

  it('stat figures and heading/body blocks share the same left edge', () => {
    const all = flatten(expandShorthand(sh));
    const x = (id: RegExp): number | undefined => {
      const l = all.find(a => id.test(a.id));
      return l ? (l as unknown as { x: number }).x : undefined;
    };
    const statX = x(/_v0$/);
    const headX = x(/_b1_hh$/);   // first heading_text heading
    const bodyX = x(/_b1_hb$/);   // its body
    expect(statX).toBeDefined();
    expect(headX).toBeDefined();
    expect(statX).toBe(headX);    // stats no longer float off the body's left margin
    expect(bodyX).toBe(headX);
  });

  it('the masthead band ends just below the header, not a dead colour slab', () => {
    const all = flatten(expandShorthand(sh));
    const band = all.find(a => /_mband$/.test(a.id)) as unknown as { y: number; height: number } | undefined;
    const sub = all.find(a => /_sub$/.test(a.id)) as unknown as { y: number; height: number } | undefined;
    if (!band || !sub) return; // layout variant without a band — nothing to assert
    const subBottom = sub.y + sub.height;
    const bandBottom = band.y + band.height;
    // band hugs the header: it may sit slightly below the subtitle box for
    // breathing room, but never a ~100px dead band (the pre-fix over-reserve).
    expect(bandBottom).toBeGreaterThanOrEqual(subBottom - 2);
    expect(bandBottom - subBottom).toBeLessThan(60);
  });
});

describe('sections header — an UPPERCASE headline reserves its wrapped height (suite-004 collision)', () => {
  function flatten(l: Layer, out: Layer[] = []): Layer[] {
    out.push(l);
    const kids = (l as unknown as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) kids.forEach(k => flatten(k, out));
    return out;
  }
  // "WE GO LIVE IN 30 MINS" at weight 800 is wider than the 0.54 mixed-case
  // average → the flat factor predicted ONE line, it rendered TWO, and the
  // subtitle "Get ready…" overprinted the wrapped "MINS" line.
  const sh = {
    type: 'sections',
    headline_style: 'rule',
    font: 'IBM Plex Sans',   // the default sans (charFactor 0.54) — the case that under-reserved
    kicker: 'LIVE STREAM',
    title: 'WE GO LIVE IN 30 MINS',
    subtitle: 'Get ready — countdown starts now',
    blocks: [
      { kind: 'heading_text', heading: 'What to Expect', body: 'Thrilling gameplay, live chat and surprise giveaways throughout the stream.' },
    ],
  } as unknown as ShorthandLayer;

  it('the title box reserves ~2 lines and the subtitle starts below it (no overprint)', () => {
    const all = flatten(expandShorthand(sh));
    const title = all.find(a => /_title$/.test(a.id));
    const sub = all.find(a => /_sub$/.test(a.id));
    if (!title || !sub) throw new Error('expected _title and _sub layers in the sections header');
    const t = title as unknown as { y: number; height: number };
    const s = sub as unknown as { y: number; height: number };
    const ts = (style(title).font_size as number) || 0;
    expect(ts).toBeGreaterThan(0);
    // pre-fix the reserved height was ~1 line (≈1.04×fontSize); the wrapped title
    // needs ~2 lines so whatever sits below clears the real rendered bottom.
    expect(t.height).toBeGreaterThan(ts * 1.6);
    // the subtitle must begin at/after the title's reserved bottom — never inside it
    expect(s.y).toBeGreaterThanOrEqual(t.y + t.height - 2);
  });
});
