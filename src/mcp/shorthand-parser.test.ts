import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, coerceShorthandLayers, recoverStringifiedPreset, unwrapBareContainers, fillBleedPresetDims, fillFlowPresetsToPage, demoteCoveringBackdrops, lockCarouselCanvas, compressDesignContext, diagnoseLayers, diagnoseShorthandKeys, detectTextOverlap, type ShorthandLayer } from './shorthand-parser';
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

  it('expands a motif into a group of primitive layers within its box (fills negative space)', () => {
    const sh = { id: 'deco', type: 'motif', motif: 'bolt', pos: [700, 300, 300, 800], color: '#FFCC00' } as unknown as ShorthandLayer;
    const result = expandShorthand(sh) as unknown as { type: string; width: number; height: number; layers: Record<string, unknown>[] };
    expect(result.type).toBe('group');
    expect(result.width).toBe(300);
    expect(result.layers.length).toBeGreaterThan(1);                 // composed, not a single silhouette
    // every primitive is a rasterizing type (no foreignObject) and uses the accent
    for (const l of result.layers) {
      expect(['path', 'ellipse', 'rect', 'line']).toContain(l['type'] as string);
    }
    const colorsUsed = result.layers.map(l => {
      const f = l['fill'] as { color?: string } | undefined;
      const s = l['stroke'] as { color?: string } | undefined;
      return f?.color ?? s?.color;
    });
    expect(colorsUsed.every(c => c === '#FFCC00')).toBe(true);       // single accent, varied opacity
  });

  it('falls back to a valid motif for an unknown name (never empty)', () => {
    const sh = { id: 'd', type: 'illustration', name: 'totally-made-up', pos: [0, 0, 200, 200], accent: '#fff' } as unknown as ShorthandLayer;
    const result = expandShorthand(sh) as unknown as { type: string; layers: unknown[] };
    expect(result.type).toBe('group');
    expect(result.layers.length).toBeGreaterThan(0);                 // unknown → 'arcs', not blank
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

  it('expands a pipe-delimited gradient string ("gradient|#a|#b")', () => {
    const sh: ShorthandLayer = { id: 'g', type: 'rect', z: 0, pos: [0, 0, 100, 100], fill: 'gradient|#3E2723|#FFCC80' };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill?.type).toBe('linear');
      const stops = (result.fill as { stops: { color: string; position: number }[] }).stops;
      expect(stops).toEqual([{ color: '#3E2723', position: 0 }, { color: '#FFCC80', position: 100 }]);
    }
  });

  it('expands a comma-joined hex pair into a linear gradient', () => {
    const sh: ShorthandLayer = { id: 'g', type: 'rect', z: 0, pos: [0, 0, 100, 100], fill: '#112233,#445566,#778899' };
    const result = expandShorthand(sh);
    if (result.type === 'rect') {
      expect(result.fill?.type).toBe('linear');
      const stops = (result.fill as { stops: { position: number }[] }).stops;
      expect(stops.map(s => s.position)).toEqual([0, 50, 100]);
    }
  });

  it('keeps a lone hex / rgba as a solid fill (not a gradient)', () => {
    const hex = expandShorthand({ id: 's', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: '#abcdef' }) as { fill?: unknown };
    expect(hex.fill).toEqual({ type: 'solid', color: '#abcdef' });
    const rgba = expandShorthand({ id: 's', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: 'rgba(0,0,0,0.5)' }) as { fill?: unknown };
    expect(rgba.fill).toEqual({ type: 'solid', color: 'rgba(0,0,0,0.5)' });
  });

  it('parses a radial keyword form ("radial|#a|#b")', () => {
    const result = expandShorthand({ id: 'g', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: 'radial|#000000|#ffffff' }) as { fill?: { type?: string } };
    expect(result.fill?.type).toBe('radial');
  });

  it('parses a compact pattern string ("pattern:halftone")', () => {
    const r = expandShorthand({ id: 'p', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: 'pattern:halftone' }) as { fill?: { type?: string; pattern?: string; fg?: string } };
    expect(r.fill?.type).toBe('pattern');
    expect(r.fill?.pattern).toBe('halftone');
  });

  it('parses pattern fg/bg from "dots/#222 on #faf5ec"', () => {
    const r = expandShorthand({ id: 'p', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: 'dots/#222222 on #FAF5EC' }) as { fill?: { type?: string; pattern?: string; fg?: string; bg?: string } };
    expect(r.fill).toMatchObject({ type: 'pattern', pattern: 'dots', fg: '#222222', bg: '#FAF5EC' });
  });

  it('normalizes a loose pattern object (color→fg, name→pattern, hyphen→underscore)', () => {
    const r = expandShorthand({ id: 'p', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: { type: 'pattern', name: 'diagonal-stripes', color: '#111' } as unknown as ShorthandLayer['fill'] }) as { fill?: { type?: string; pattern?: string; fg?: string } };
    expect(r.fill?.type).toBe('pattern');
    expect(r.fill?.pattern).toBe('diagonal_stripes');
    expect(r.fill?.fg).toBe('#111');
  });

  it('passes an image fill through (url→src)', () => {
    const r = expandShorthand({ id: 'p', type: 'rect', z: 0, pos: [0, 0, 10, 10], fill: { type: 'image', url: 'https://x/p.png', mode: 'tile' } as unknown as ShorthandLayer['fill'] }) as { fill?: { type?: string; src?: string; mode?: string } };
    expect(r.fill).toMatchObject({ type: 'image', src: 'https://x/p.png', mode: 'tile' });
  });

  it('expands a star shape into a filled path layer', () => {
    const r = expandShorthand({ id: 'st', type: 'star', z: 1, pos: [100, 100, 200, 200], points: 6, color: '#FF3D00' } as unknown as ShorthandLayer) as { type?: string; d?: string; fill?: { type?: string; color?: string } };
    expect(r.type).toBe('path');
    expect(r.d?.startsWith('M')).toBe(true);
    expect(r.fill).toEqual({ type: 'solid', color: '#FF3D00' });
  });

  it('expands a donut shape with evenodd fill-rule', () => {
    const r = expandShorthand({ id: 'rg', type: 'donut', z: 1, pos: [0, 0, 120, 120], color: '#222', thickness: 0.3 } as unknown as ShorthandLayer) as { type?: string; fill_rule?: string };
    expect(r.type).toBe('path');
    expect(r.fill_rule).toBe('evenodd');
  });

  it('expands an arc as an open stroke shape (no fill, default stroke)', () => {
    const r = expandShorthand({ id: 'ar', type: 'arc', z: 1, pos: [0, 0, 120, 120], color: '#1040C0', weight: 10 } as unknown as ShorthandLayer) as { type?: string; fill?: unknown; stroke?: { color?: string; width?: number } };
    expect(r.type).toBe('path');
    expect(r.fill).toBeUndefined();
    expect(r.stroke).toEqual({ color: '#1040C0', width: 10 });
  });

  it('expands an editorial preset into a positioned group (kicker/rule/title/body/footer)', () => {
    const r = expandShorthand({ id: 'ed', type: 'editorial', z: 0, pos: [0, 0, 1080, 1350], kicker: 'Notes', title: 'Big Headline', subtitle: 'Deck', body: 'Body', footer: 'foot' } as unknown as ShorthandLayer) as { type?: string; layers?: { id: string; type: string }[] };
    expect(r.type).toBe('group');
    const ids = r.layers!.map(l => l.id);
    expect(ids).toContain('ed_bg');
    expect(ids).toContain('ed_title');
    expect(ids).toContain('ed_rule');
    expect(ids).toContain('ed_footer');
    // every child is fully positioned (no missing geometry)
    expect(r.layers!.every(l => typeof (l as { x?: number }).x === 'number')).toBe(true);
  });

  it('expands a split preset with a golden-ratio pattern panel', () => {
    const r = expandShorthand({ id: 'sp', type: 'split', z: 0, pos: [0, 0, 1200, 800], side: 'left', ratio: 'golden', panel: { type: 'pattern', pattern: 'halftone', fg: '#fff', bg: '#B8543C' }, panel_label: '04', title: 'Hi' } as unknown as ShorthandLayer) as { type?: string; layers?: { id: string; type: string; width?: number; fill?: { type?: string } }[] };
    expect(r.type).toBe('group');
    const panel = r.layers!.find(l => l.id === 'sp_panel')!;
    expect(panel.fill?.type).toBe('pattern');
    expect(panel.width).toBe(Math.round(1200 * 0.382));
    expect(r.layers!.map(l => l.id)).toContain('sp_plabel');
  });

  it('expands a list preset into a measured, non-overlapping numbered stack', () => {
    const r = expandShorthand({
      id: 'lst', type: 'list', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#FAF5EC', accent: '#B8543C', kicker: 'Notes', title: '5 Habits of Highly Effective Engineers',
      marker: 'number', footer: 'folio / 2026',
      items: [
        { title: 'Write Small, Focused Tests', desc: 'Tests that verify one thing pinpoint failures.' },
        { title: 'Read Error Messages Carefully', desc: 'The stack trace tells you what broke.' },
        { title: 'Keep the Debugger Close', desc: 'Validate assumptions before they compound.' },
      ],
    } as unknown as ShorthandLayer) as { type?: string; layers?: { id: string; type: string; x: number; y: number; width: number; height: number }[] };
    expect(r.type).toBe('group');
    const ids = r.layers!.map(l => l.id);
    expect(ids).toContain('lst_bg');
    expect(ids).toContain('lst_title');
    expect(ids).toContain('lst_n0');   // accent number marker for item 0
    expect(ids).toContain('lst_t0');   // item title
    expect(ids).toContain('lst_b0');   // item description
    expect(ids).toContain('lst_footer');
    // Item titles must NOT vertically overlap (the whole point — measured stack).
    const titles = ['lst_t0', 'lst_t1', 'lst_t2'].map(id => r.layers!.find(l => l.id === id)!);
    for (let i = 1; i < titles.length; i++) {
      expect(titles[i].y).toBeGreaterThan(titles[i - 1].y + titles[i - 1].height);
    }
    expect(r.layers!.every(l => typeof l.x === 'number' && typeof l.y === 'number')).toBe(true);
  });

  it('list preset supports bullet markers and item without desc', () => {
    const r = expandShorthand({
      id: 'lb', type: 'steps', z: 0, pos: [0, 0, 1080, 1080], marker: 'bullet',
      items: [{ title: 'Only a title' }, { title: 'Second' }],
    } as unknown as ShorthandLayer) as { layers?: { id: string; type: string }[] };
    const ids = r.layers!.map(l => l.id);
    expect(ids).toContain('lb_d0');           // bullet ellipse
    expect(ids).toContain('lb_t0');
    expect(ids).not.toContain('lb_b0');        // no desc → no body layer
  });

  it('expands a stat preset with a dominant auto-sized number above the caption', () => {
    const r = expandShorthand({
      id: 'st', type: 'stat', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0A0A0A', accent: '#FF3D00', kicker: 'Maker Report', stat: '73%',
      caption: 'of side projects never ship.', footer: 'folio',
    } as unknown as ShorthandLayer) as { type?: string; layers?: { id: string; type: string; y: number; height: number; style?: { font_size?: number } }[] };
    expect(r.type).toBe('group');
    const num = r.layers!.find(l => l.id === 'st_stat')!;
    const cap = r.layers!.find(l => l.id === 'st_cap')!;
    // the number dominates the caption font size and sits above it
    expect(num.style!.font_size!).toBeGreaterThan((cap.style!.font_size ?? 0) * 3);
    expect(num.y + num.height).toBeLessThanOrEqual(cap.y + 2);
  });

  it('keeps the stat caption legible on a LIGHT bg (default white caption would vanish)', () => {
    const r = expandShorthand({
      id: 'lt', type: 'stat', z: 0, pos: [0, 0, 1080, 1080],
      bg: '#FAF5EC', accent: '#B8543C', kicker: 'Annual cost',
      stat: '$37B', caption: 'in the United States',
    } as unknown as ShorthandLayer) as { layers?: { id: string; style?: { color?: string } }[] };
    const cap = r.layers!.find(l => l.id === 'lt_cap')!;
    // No text_color given + light bg → engine must flip the caption off near-white.
    expect(cap.style!.color!.toLowerCase()).not.toBe('#fafafa');
  });

  it('feature_grid keeps card text legible on a dark canvas (light text would vanish on a light card)', () => {
    type FGLayer = { id: string; type: string; fill?: { color?: string }; style?: { color?: string }; layers?: FGLayer[] };
    const r = expandShorthand({
      id: 'fg', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0A0A0A', accent: '#FF3D00', text_color: '#FAFAFA',
      items: [{ icon: 'zap', title: 'Fast', desc: 'Quick sync' }],
    } as unknown as ShorthandLayer) as { layers?: FGLayer[] };
    const row = r.layers!.find(l => l.id === 'fg_row')!;        // cards nest inside the row
    const card = row.layers!.find(l => l.id === 'fg_card0')!;
    const cardBg = (card.fill?.color ?? '').toLowerCase();
    const title = card.layers!.find(l => l.id.endsWith('_title'))!;
    // On a dark canvas the engine flips cards to a light surface with dark text.
    expect(cardBg).not.toBe('#0a0a0a');
    expect(title.style!.color!.toLowerCase()).not.toBe('#fafafa'); // not the invisible light-on-light
  });

  it('expands an event preset: big title above a non-overlapping detail stack + visible bars', () => {
    type EL = { id: string; type: string; x: number; y: number; width: number; height: number; fill?: { color?: string }; style?: { font_size?: number } };
    const r = expandShorthand({
      id: 'ev', type: 'event', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0A0A0A', accent: '#FF3D00', palette: ['#00E5FF', '#FF00E5', '#C6FF00'],
      title: 'Neon Nights', details: ['Saturday 14 June', 'Riverside Park', '7PM till late'], footer: '@neon',
    } as unknown as ShorthandLayer) as { type?: string; layers?: EL[] };
    expect(r.type).toBe('group');
    const title = r.layers!.find(l => l.id === 'ev_title')!;
    const d0 = r.layers!.find(l => l.id === 'ev_d0')!;
    // details sit BELOW the (auto-sized) title — no collision
    expect(d0.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    // decorative bars exist and are NOT the background color (visible)
    const bar0 = r.layers!.find(l => l.id === 'ev_bar0')!;
    expect((bar0.fill?.color ?? '').toLowerCase()).not.toBe('#0a0a0a');
    // title dominates the detail font size
    expect(title.style!.font_size!).toBeGreaterThan((d0.style!.font_size ?? 0) * 2);
  });

  it('event preset drops palette colors that would be invisible on the canvas', () => {
    const r = expandShorthand({
      id: 'ev2', type: 'flyer', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A',
      accent: '#FF3D00', palette: ['#0B0B0B', '#0A0A0A'], title: 'X', details: ['Y'],
    } as unknown as ShorthandLayer) as { layers?: Array<{ id: string; fill?: { color?: string } }> };
    const bar0 = r.layers!.find(l => l.id === 'ev2_bar0')!;
    // both palette colors are ~invisible on #0A0A0A → falls back to a contrasting color
    expect((bar0.fill?.color ?? '').toLowerCase()).not.toBe('#0b0b0b');
    expect((bar0.fill?.color ?? '').toLowerCase()).not.toBe('#0a0a0a');
  });

  it('expands a sections preset: header + flowed, measured, non-overlapping blocks', () => {
    type SL = { id: string; type: string; x: number; y: number; width: number; height: number };
    const r = expandShorthand({
      id: 'sec', type: 'sections', z: 0, pos: [0, 0, 1080, 1920],
      bg: '#FAF5EC', accent: '#B8543C', kicker: 'Report', title: 'The State of Remote Work 2026',
      subtitle: 'A year in review.', footer: 'Source: Index 2026',
      blocks: [
        { kind: 'intro', text: 'Remote work matured in 2026 as hybrid models settled into a default rhythm across most knowledge sectors.' },
        { kind: 'stats', items: [{ value: '58%', label: 'hybrid' }, { value: '27%', label: 'fully remote' }, { value: '+41%', label: 'productivity' }] },
        { kind: 'heading', text: 'The Hybrid Default' },
        { kind: 'text', text: 'Most companies settled on two to three office days, balancing focus and collaboration.' },
        { kind: 'callout', label: 'Key takeaway', text: 'Async-first cultures outperformed meeting-heavy ones on nearly every measure.' },
        { kind: 'quote', text: 'The commute dividend went straight into focus work.', cite: 'GWI 2026' },
      ],
    } as unknown as ShorthandLayer) as { type?: string; layers?: SL[] };
    expect(r.type).toBe('group');
    const ids = r.layers!.map(l => l.id);
    expect(ids).toContain('sec_title');
    expect(ids).toContain('sec_footer');
    expect(ids.some(i => i.startsWith('sec_b0'))).toBe(true);
    expect(ids.some(i => i.startsWith('sec_b5'))).toBe(true);
    expect(ids.filter(i => /^sec_b1_v\d/.test(i)).length).toBe(3);   // 3 stat values
    expect(ids).toContain('sec_b4_box');                            // callout tinted box
    expect(r.layers!.length).toBeGreaterThan(15);                   // a rich composition
    expect(r.layers!.every(l => typeof l.x === 'number' && typeof l.y === 'number')).toBe(true);
  });

  it('sections: stats auto-split a merged "figure + words" value (incl. currency) into value + label', () => {
    type SL = { id: string; type: string; style?: { font_size?: number } };
    const r = expandShorthand({
      id: 'st', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'X',
      blocks: [{ kind: 'stats', items: [{ value: '$250B market size' }, { value: '207M creators' }, { value: '73%' }] }],
    } as unknown as ShorthandLayer) as { layers?: SL[] };
    const big = (id: string): number => r.layers!.find(l => l.id === id)!.style!.font_size!;
    const small = (id: string): number => r.layers!.find(l => l.id === id)!.style!.font_size!;
    // value layer (big) and label layer (small) both exist for the merged "$250B market size"
    expect(big('st_b0_v0')).toBeGreaterThan(small('st_b0_l0') * 2);
    // a bare "73%" with no words stays a value-only stat (no label layer)
    expect(r.layers!.some(l => l.id === 'st_b0_l2')).toBe(false);
  });

  it('sections: native bars block renders rect bars scaled to the max value', () => {
    type SL = { id: string; type: string; width: number };
    const r = expandShorthand({
      id: 'bc', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'Usage',
      blocks: [{ kind: 'bars', items: [{ label: 'Mobile', value: 80 }, { label: 'Desktop', value: 40 }, { label: 'Tablet', value: 10 }] }],
    } as unknown as ShorthandLayer) as { layers?: SL[] };
    const ids = r.layers!.map(l => l.id);
    expect(ids).toContain('bc_b0_bb0');   // bar 0
    expect(ids).toContain('bc_b0_bb2');   // bar 2
    const bar0 = r.layers!.find(l => l.id === 'bc_b0_bb0')!;
    const bar1 = r.layers!.find(l => l.id === 'bc_b0_bb1')!;
    // value 80 → wider bar than value 40 (scaled to max)
    expect(bar0.width).toBeGreaterThan(bar1.width);
    expect(ids).toContain('bc_b0_bt0');   // track behind bar
  });

  it('sections drops leading/trailing divider blocks and the orphan header rule', () => {
    const r = expandShorthand({
      id: 'sd', type: 'sections', z: 0, pos: [0, 0, 1080, 1400],
      blocks: [{ kind: 'divider' }, { kind: 'text', text: 'Body content here.' }, { kind: 'divider' }],
    } as unknown as ShorthandLayer) as { layers?: Array<{ id: string }> };
    const ids = r.layers!.map(l => l.id);
    expect(ids).not.toContain('sd_hr');     // no header content → no orphan rule
    expect(ids.some(i => i.includes('_div'))).toBe(false);  // leading+trailing dividers trimmed
    expect(ids.some(i => i.startsWith('sd_b'))).toBe(true); // the text block survived
  });

  it('sections: a source/caption block renders its text (never silently dropped to a blank rule)', () => {
    const r = expandShorthand({
      id: 'sc', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'X',
      blocks: [
        { kind: 'text', text: 'Body.' },
        { kind: 'source', text: 'Source: Global Work Index 2026' },
      ],
    } as unknown as ShorthandLayer) as { layers?: Array<{ id: string; content?: { value?: string } }> };
    const cap = r.layers!.find(l => l.id === 'sc_b1_cap');
    expect(cap).toBeTruthy();
    expect(cap!.content!.value).toBe('Source: Global Work Index 2026');
  });

  it('sections: an unknown-kind block that carries text renders the text instead of a blank divider', () => {
    const r = expandShorthand({
      id: 'uk', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'X',
      blocks: [{ kind: 'mysteryKind', text: 'Important line.' }],
    } as unknown as ShorthandLayer) as { layers?: Array<{ id: string; type: string; content?: { value?: string } }> };
    const t = r.layers!.find(l => l.id === 'uk_b0_t');
    expect(t).toBeTruthy();
    expect(t!.type).toBe('text');
    expect(t!.content!.value).toBe('Important line.');
  });

  it('maps terse typography aliases (uppercase/italic/outline/highlight/curve)', () => {
    const r = expandShorthand({
      id: 'h', type: 'text', z: 1, pos: [0, 0, 400, 80], text: 'hi',
      uppercase: true, italic: true, outline: { color: '#000', width: 3 },
      highlight: '#FDE047', variation: { wght: 350 }, features: { tnum: 1 },
      curve: 'M0 80 Q100 0 200 80',
    } as unknown as ShorthandLayer) as { style?: Record<string, unknown> };
    expect(r.style).toMatchObject({
      text_transform: 'uppercase', font_style: 'italic',
      stroke: { color: '#000', width: 3 }, highlight: '#FDE047',
      font_variation_settings: { wght: 350 }, font_feature_settings: { tnum: 1 },
    });
    expect((r.style!.text_path as { d?: string }).d).toBe('M0 80 Q100 0 200 80');
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

  it('maps typography craft fields: line_height + letter_spacing (and lh/track aliases)', () => {
    const [canonical] = expandShorthandLayers([
      { id: 'h', type: 'text', pos: [0, 0, 800, 200], text: 'Hi', size: 100, line_height: 1.02, letter_spacing: -1.5 },
    ] as unknown as ShorthandLayer[]) as Array<{ style?: { line_height?: number; letter_spacing?: number } }>;
    expect(canonical.style?.line_height).toBe(1.02);
    expect(canonical.style?.letter_spacing).toBe(-1.5);

    const [aliased] = expandShorthandLayers([
      { id: 'lbl', type: 'text', pos: [0, 0, 800, 40], text: 'TAG', size: 18, lh: 1.4, track: 1.5 },
    ] as unknown as ShorthandLayer[]) as Array<{ style?: { line_height?: number; letter_spacing?: number } }>;
    expect(aliased.style?.line_height).toBe(1.4);
    expect(aliased.style?.letter_spacing).toBe(1.5);

    // none of these are flagged as unrecognized
    expect(diagnoseShorthandKeys([
      { id: 'h', type: 'text', text: 'x', font: 'Playfair Display', line_height: 1, letter_spacing: 0, lh: 1, track: 2 },
    ] as unknown as ShorthandLayer[])).toEqual([]);
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
      type: 'feature_grid', pos: [0, 0, 1080, 1080],
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
    const row = kids.find(k => k.type === 'auto_layout') as Layer & { direction?: string; layers?: Layer[] };
    expect(row.direction).toBe('row');
    expect(row.layers).toHaveLength(3);
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
    const row = (g.layers ?? []).find(l => l.type === 'auto_layout') as Layer & { layers?: Layer[] };
    expect(row.layers).toHaveLength(2);
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

describe('chart / kpi_card / component shorthand (data-viz + reuse)', () => {
  it('builds a bar-chart vega-lite spec from compact data', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      ch: { type: 'chart', chart: 'bar', pos: [0, 0, 400, 300], data: [{ x: 'Q1', y: 10 }, { label: 'Q2', value: 20 }] },
    })) as Array<{ type?: string; spec?: { mark?: unknown; data?: { values?: { x: unknown; y: number }[] } } }>;
    expect(c.type).toBe('chart');
    expect(c.spec?.mark).toBe('bar');
    // label/value normalized to x/y
    expect(c.spec?.data?.values).toEqual([{ x: 'Q1', y: 10 }, { x: 'Q2', y: 20 }]);
  });

  it('builds a donut arc spec', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      ch: { type: 'chart', chart: 'donut', pos: [0, 0, 300, 300], data: [{ x: 'A', y: 1 }] },
    })) as Array<{ spec?: { mark?: { type?: string; innerRadius?: number } } }>;
    expect(c.spec?.mark?.type).toBe('arc');
    expect(c.spec?.mark?.innerRadius).toBe(60);
  });

  it('maps kpi_card fields (label/value/delta/icon/fill→background)', () => {
    const [k] = expandShorthandLayers(coerceShorthandLayers({
      kpi: { type: 'kpi_card', pos: [0, 0, 300, 160], label: 'Revenue', value: '$1.2M', delta: '+12%', icon: 'dollar-sign', fill: '#16213E', radius: 12 },
    })) as Array<{ type?: string; label?: string; value?: string; delta?: string; icon?: string; background?: string; border_radius?: number }>;
    expect(k.type).toBe('kpi_card');
    expect(k.label).toBe('Revenue');
    expect(k.value).toBe('$1.2M');
    expect(k.delta).toBe('+12%');
    expect(k.icon).toBe('dollar-sign');
    expect(k.background).toBe('#16213E');
    expect(k.border_radius).toBe(12);
  });

  it('passes component ref/slots/variant through', () => {
    const [c] = expandShorthandLayers(coerceShorthandLayers({
      inst: { type: 'component', pos: [0, 0, 300, 200], ref: 'feature-card', slots: { title: 'Fast' }, variant: 'dark' },
    })) as Array<{ type?: string; ref?: string; slots?: { title?: string }; variant?: string }>;
    expect(c.type).toBe('component');
    expect(c.ref).toBe('feature-card');
    expect(c.slots?.title).toBe('Fast');
    expect(c.variant).toBe('dark');
  });
});

describe('children→layers alias + shape/corner_radius (UI-tree vocabulary)', () => {
  it('maps `children` to `layers` at every nesting level', () => {
    const [row] = expandShorthandLayers(coerceShorthandLayers({
      r: { type: 'row', pos: [0, 0, 900, 300], gap: 20, children: [
        { type: 'column', width: 280, height: 300, children: [
          { type: 'text', width: 240, height: 50, text: 'Hi', size: 28 },
        ] },
      ] },
    })) as Array<{ type?: string; layers?: Array<{ type?: string; layers?: Array<{ content?: { value?: string } }> }> }>;
    expect(row.type).toBe('auto_layout');
    expect(row.layers).toHaveLength(1);
    expect(row.layers?.[0].type).toBe('auto_layout');
    expect(row.layers?.[0].layers?.[0].content?.value).toBe('Hi');
  });

  it('maps type "shape"/"box" → rect and corner_radius → radius', () => {
    const [a, b] = expandShorthandLayers(coerceShorthandLayers({
      s: { type: 'shape', pos: [0, 0, 100, 100], fill: '#abc', corner_radius: 12 },
      x: { type: 'box', pos: [0, 0, 50, 50], fill: '#def' },
    })) as Array<{ type?: string; radius?: number }>;
    expect(a.type).toBe('rect');
    expect(a.radius).toBe(12);
    expect(b.type).toBe('rect');
  });

  it('canonical layers wins over children if both present', () => {
    const [g] = expandShorthandLayers(coerceShorthandLayers({
      grp: { type: 'group', pos: [0, 0, 100, 100], layers: [{ type: 'rect', pos: [0, 0, 10, 10] }], children: [] },
    })) as Array<{ layers?: unknown[] }>;
    expect(g.layers).toHaveLength(1);
  });
});

describe('repeat (one template × N, with optional data binding)', () => {
  it('repeats a layer N times with unique ids', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      dot: { type: 'circle', repeat: 3, pos: [0, 0, 20, 20], fill: '#fff' },
    })) as Array<{ id?: string; type?: string }>;
    expect(out).toHaveLength(3);
    expect(out.map(l => l.id)).toEqual(['dot_1', 'dot_2', 'dot_3']);
    expect(out.every(l => l.type === 'circle')).toBe(true);
  });

  it('binds a data array, substituting {{tokens}} per row', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      item: { type: 'text', repeat: [{ name: 'Free', price: '$0' }, { name: 'Pro', price: '$9' }],
              pos: [0, 0, 300, 60], text: '{{name}} — {{price}}', size: 30 },
    })) as Array<{ id?: string; content?: { value?: string } }>;
    expect(out).toHaveLength(2);
    expect(out[0].content?.value).toBe('Free — $0');
    expect(out[1].content?.value).toBe('Pro — $9');
  });

  it('repeats children inside a container (data-bound cards in a row)', () => {
    const [row] = expandShorthandLayers(coerceShorthandLayers({
      grid: { type: 'row', pos: [0, 0, 900, 200], gap: 20, layers: {
        card: { type: 'column', width: 280, height: 200, fill: '#222',
                repeat: [{ t: 'A' }, { t: 'B' }, { t: 'C' }],
                layers: { lbl: { type: 'text', width: 240, height: 40, text: 'Plan {{t}}', size: 28 } } },
      } },
    })) as Array<{ layers?: Array<{ id?: string; layers?: Array<{ content?: { value?: string } }> }> }>;
    const cards = row.layers ?? [];
    expect(cards).toHaveLength(3);
    expect(cards[2].id).toBe('card_3');
    expect(cards[0].layers?.[0].content?.value).toBe('Plan A');
    expect(cards[2].layers?.[0].content?.value).toBe('Plan C');
  });

  it('exposes the index as {{i}} / {{n}} for a numeric repeat', () => {
    const out = expandShorthandLayers(coerceShorthandLayers({
      step: { type: 'text', repeat: 3, pos: [0, 0, 100, 40], text: 'Step {{i}}', size: 24 },
    })) as Array<{ content?: { value?: string } }>;
    expect(out.map(l => l.content?.value)).toEqual(['Step 1', 'Step 2', 'Step 3']);
  });
});

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

  it('"mesh" → solid base + ≥3 soft radial blobs', () => {
    const g = sec('mesh');
    const blobs = g.layers.filter(l => l.type === 'ellipse' && (l.fill as { type?: string })?.type === 'radial');
    expect(blobs.length).toBeGreaterThanOrEqual(3);
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

describe('composeBackground — placement, palette gradient, vignette, photo', () => {
  const sx = (extra: Record<string, unknown>) => expandShorthand({
    id: 'b', type: 'sections', z: 0, pos: [0, 0, 1000, 1000], title: 'T',
    blocks: [{ kind: 'text', text: 'x' }], ...extra,
  } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };

  it('curve:bl anchors the sweep at bottom-left', () => {
    const g = sx({ bg: '#FAF5EC', accent: '#B8543C', bg_style: 'curve:bl' });
    const c = g.layers.find(l => l.id === 'b_curve')!;
    // center (X=0,Y=H=1000): x ≈ -s/2 (<0), y ≈ H - s/2 (large)
    expect(Number(c.x)).toBeLessThan(0);
    expect(Number(c.y)).toBeGreaterThan(200);
  });

  it('palette + gradient → a clean 2-stop bg→tint wash (not a muddy multi-hue ramp)', () => {
    const g = sx({ bg: '#FAF5EC', accent: '#B8543C', palette: ['#E0A96D', '#9CAF88', '#6E8BB5'], bg_style: 'gradient' });
    const bg = g.layers.find(l => l.id === 'b_bg')!;
    const f = bg.fill as { type?: string; stops?: Array<{ color?: string; position?: number }> };
    expect(f.type).toBe('linear');
    expect(f.stops!.length).toBe(2);                    // bg → single tint, no multi-hue seam
    expect(f.stops![0].color).toBe('#FAF5EC');          // canvas colour at the start
    expect(f.stops![0].position).toBe(0);
    expect(f.stops![1].position).toBe(100);
  });

  it('vignette → four corner dark radial blobs', () => {
    const g = sx({ bg: '#0E0B14', accent: '#F4B740', text_color: '#F5F1EA', bg_style: 'solid + vignette' });
    const vig = g.layers.filter(l => String(l.id).startsWith('b_vig_'));
    expect(vig.length).toBe(4);
    expect(vig.every(l => l.type === 'ellipse')).toBe(true);
  });

  it('photo base + bg_image → image fill + a legibility scrim', () => {
    const g = sx({ bg: '#101014', accent: '#F4B740', text_color: '#F5F1EA', bg_style: 'photo + grain', bg_image: 'https://example.com/x.jpg' });
    const photo = g.layers.find(l => l.id === 'b_photo')!;
    expect((photo.fill as { type?: string }).type).toBe('image');
    const scrim = g.layers.find(l => l.id === 'b_scrim')!;
    expect(scrim).toBeTruthy();
    expect(g.layers.some(l => l.id === 'b_grain')).toBe(true);
  });

  it('photo base WITHOUT bg_image falls back to a plain bg (no broken image fill)', () => {
    const g = sx({ bg: '#101014', bg_style: 'photo' });
    expect(g.layers.some(l => l.id === 'b_photo')).toBe(false);
    expect(g.layers.some(l => l.id === 'b_bg')).toBe(true);
  });
});

describe('feature_grid card fit (measured heights + scaled type, no overflow)', () => {
  const fgCard = (n: number, titleLen: number, descLen: number, id = 'fg') => {
    const items = Array.from({ length: n }, (_, i) => ({ icon: 'zap', title: 'T'.repeat(titleLen) + i, desc: 'd '.repeat(descLen) }));
    return expandShorthand({ id, type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080], bg: '#0A0A0A', title: 'X', items } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
  };
  const cardKid = (g: { layers: Array<Record<string, unknown>> }, suffix: string) => {
    const row = g.layers.find(l => String(l.id).endsWith('_row')) as { layers?: Array<Record<string, unknown>> };
    const card = row.layers!.find(c => String(c.id).endsWith('_card1')) as { layers?: Array<Record<string, unknown>> };
    return card.layers!.find(k => String(k.id).includes(suffix))!;
  };

  it('a longer description gets a taller measured box (not a fixed height)', () => {
    const short = cardKid(fgCard(3, 4, 2, 'a'), '_desc');
    const long = cardKid(fgCard(3, 4, 20, 'b'), '_desc');
    expect(Number(long.height)).toBeGreaterThan(Number(short.height));
  });

  it('narrower cards (more of them) use a smaller title font', () => {
    const few = cardKid(fgCard(2, 6, 4, 'c'), '_title') as { style?: { font_size?: number } };
    const many = cardKid(fgCard(5, 6, 4, 'd'), '_title') as { style?: { font_size?: number } };
    expect(many.style!.font_size!).toBeLessThan(few.style!.font_size!);
  });
});

describe('sections stats — long unbreakable value fits its column (no collision)', () => {
  it('a long single-token value like "$0.04/kWh" gets a font that fits the column', () => {
    const g = expandShorthand({
      id: 'sv', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], title: 'X',
      blocks: [{ kind: 'stats', items: [
        { value: '230 GW', label: 'capacity' }, { value: '6%', label: 'share' },
        { value: '$0.04/kWh', label: 'LCOE' }, { value: '260k', label: 'jobs' },
      ] }],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; width?: number; content?: { value?: string }; style?: { font_size?: number } }> };
    const long = g.layers.find(l => l.content?.value === '$0.04/kWh')!;
    const fs = long.style!.font_size!;
    // "$0.04/kWh" is 9 chars; it must fit within ITS rendered column width
    // (whatever the layout variant chose — 4-across row or 2-col grid).
    expect(fs * 9 * 0.58).toBeLessThanOrEqual(long.width! * 0.92 + 1);
    expect(fs).toBeGreaterThanOrEqual(22);
  });
});

describe('sections — a MEGA (uppercase) multi-line title does not collide with the subtitle', () => {
  it('reserves enough height for a wrapped mega title so the subtitle sits below it', () => {
    const g = expandShorthand({
      id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1500], headline_style: 'mega',
      kicker: 'NO VISION', title: 'Can a 30B Model Actually Design This Poster',
      subtitle: 'This poster is the proof — built by a 30-billion-parameter language model driving Folio.',
      blocks: [{ kind: 'stats', items: [{ value: '30B', label: 'params' }] }],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; y?: number; height?: number }> };
    const title = g.layers.find(l => l.id === 's_title')!;
    const sub = g.layers.find(l => l.id === 's_sub')!;
    expect(sub.y!).toBeGreaterThanOrEqual(title.y! + (title.height ?? 0));
  });
});

describe('sections — layout variant (centered header / stat grid)', () => {
  const sectionsWith = (extra: Record<string, unknown>) => expandShorthand({
    id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1400], kicker: 'KICKER', title: 'A Real Title', subtitle: 'a subtitle line',
    blocks: [{ kind: 'stats', items: [{ value: '70%', label: 'a' }, { value: '8M', label: 'b' }, { value: '25%', label: 'c' }, { value: '12%', label: 'd' }] }],
    ...extra,
  } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; style?: { align?: string } }> };

  it('an explicit align:"center" centers the title; align:"left" keeps it left', () => {
    const c = sectionsWith({ align: 'center' }).layers.find(l => l.id === 's_title')!;
    const l = sectionsWith({ align: 'left' }).layers.find(l => l.id === 's_title')!;
    expect(c.style!.align).toBe('center');
    expect(l.style!.align).toBeUndefined();
  });

  it('a centered design also centers the kicker and stat figures', () => {
    const g = sectionsWith({ align: 'center' }).layers;
    expect(g.find(l => l.id === 's_kick')!.style!.align).toBe('center');
    // every stat value layer is centered in a centered design
    const vals = g.filter(l => /_v\d+$/.test(l.id));
    expect(vals.length).toBeGreaterThan(0);
    expect(vals.every(v => v.style!.align === 'center')).toBe(true);
  });
});

describe('feature_grid — long-token card title fits a narrow (5-card) column', () => {
  // 5 cards → narrow columns; a long unbreakable token ("Zero-Downtime") at the
  // unclamped font bled past the card edge. Size the title so the longest token
  // fits innerW.
  it('shrinks the title font so the longest token fits the card', () => {
    const items = [0, 1, 2, 3, 4].map(i => ({ icon: 'zap', title: i === 3 ? 'Zero-Downtime Deployments' : 'Short', desc: 'x' }));
    const g = expandShorthand({ id: 'fg', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1350], bg: '#111', accent: '#7c5cff', title: 'CI/CD', items } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; width?: number; style?: { font_size?: number }; layers?: unknown[] }> };
    const find = (ls: Array<{ id: string; layers?: unknown[] }>, id: string): { id: string; width?: number; style?: { font_size?: number } } | undefined => {
      for (const l of ls) { if (l.id === id) return l as never; if (l.layers) { const r = find(l.layers as never, id); if (r) return r; } }
      return undefined;
    };
    const card = find(g.layers, 'fg_card3')!;
    const title = find(g.layers, 'fg_c3_title')! as { style?: { font_size?: number } };
    const innerW = (card.width ?? 0) - 56;
    // longest token "Zero-Downtime" = 13 chars must fit innerW at the chosen size.
    expect(13 * (title.style!.font_size!) * 0.55).toBeLessThanOrEqual(innerW);
  });
});

describe('event preset — caps title that wraps to 3 lines does not collide with details', () => {
  // The blind 120B's "Design Weekend 2026" wrapped to 3 ALL-CAPS lines; the title
  // height was measured at the 0.54 default while the renderer wraps caps wider,
  // so the detail lines overlapped the title's last line (invisible to diagnose —
  // it's inside the preset group).
  it('places the first detail line BELOW the wrapped title', () => {
    const g = expandShorthand({
      id: 'ev', type: 'event', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0B0B0B', accent: '#FF3D00', title: 'Design Weekend 2026',
      details: ['Sat-Sun June 15-16', 'City Design Center', '10AM-6PM daily'],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; y: number; height: number }> };
    const title = g.layers.find(l => l.id === 'ev_title')!;
    const d0 = g.layers.find(l => l.id === 'ev_d0')!;
    expect(d0.y).toBeGreaterThanOrEqual(title.y + title.height);
  });

  it('a 4-word title that word-wraps to 4 lines still clears the details (word-aware height)', () => {
    // "2026 DESIGN SYSTEMS SUMMIT" packs 1 word/line (4 lines); the old char-count
    // estimate said 3 → details overlapped the 4th line. Word-aware estTextHeight fixes it.
    const g = expandShorthand({
      id: 'ev', type: 'event', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0A0A0A', accent: '#FF3D00', title: '2026 Design Systems Summit',
      details: ['June 15-16, 2026', 'San Francisco, CA', '9:00 AM - 6:00 PM'],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; y: number; height: number }> };
    const title = g.layers.find(l => l.id === 'ev_title')!;
    const d0 = g.layers.find(l => l.id === 'ev_d0')!;
    expect(d0.y).toBeGreaterThanOrEqual(title.y + title.height);
  });

  it('heroes a date-like detail as a big accent line, leaving venue/meta in the stack', () => {
    const g = expandShorthand({
      id: 'ev', type: 'event', z: 0, pos: [0, 0, 1080, 1350],
      bg: '#0A0A0A', accent: '#FF3D00', title: 'Stargazing Night',
      details: ['Sat July 18 · 8 PM', 'City Park', 'Free · All ages'],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ id: string; y: number; style?: { font_size?: number; color?: string } }> };
    const hero = g.layers.find(l => l.id === 'ev_hero')!;
    const d0 = g.layers.find(l => l.id === 'ev_d0')!;
    expect(hero).toBeTruthy();
    expect((hero.style!.color ?? '').toLowerCase()).toBe('#ff3d00');                 // the accent moment
    expect(hero.style!.font_size!).toBeGreaterThan((d0.style!.font_size ?? 0) * 1.6); // dominates the meta lines
    expect(d0.y).toBeGreaterThan(hero.y);                                            // venue/meta sits below the date
  });
});

describe('diagnoseLayers recurses into auto_layout (catches nested bad icons)', () => {
  // feature_grid nests icons inside auto_layout cards, not groups — a group-only
  // walk silently skipped them, so an unknown icon went unwarned (blind models
  // can't see the placeholder it renders).
  it('flags an unknown icon nested inside a feature_grid card', () => {
    const layers = expandShorthandLayers(coerceShorthandLayers([
      { type: 'feature_grid', title: 'X', bg: '#000', accent: '#f30',
        items: [{ icon: 'gauge', title: 'A', desc: 'b' }, { icon: 'zap', title: 'C', desc: 'd' }] },
    ]));
    const notes = diagnoseLayers(layers);
    expect(notes.some(n => n.includes('gauge') && n.includes('not a known icon'))).toBe(true);
  });

  it('stays silent when every nested icon resolves', () => {
    const layers = expandShorthandLayers(coerceShorthandLayers([
      { type: 'feature_grid', title: 'X', bg: '#000', accent: '#f30',
        items: [{ icon: 'zap', title: 'A', desc: 'b' }, { icon: 'shield-check', title: 'C', desc: 'd' }] },
    ]));
    expect(diagnoseLayers(layers).some(n => n.includes('not a known icon'))).toBe(false);
  });
});

describe('stat preset caption/footer aliases (model names it context/source)', () => {
  const collect = (l: { content?: { value?: string }; layers?: unknown[] }): string[] => {
    const out: string[] = [];
    if (l.content?.value) out.push(l.content.value);
    for (const c of (l.layers ?? []) as Array<typeof l>) out.push(...collect(c));
    return out;
  };
  it('renders supporting text passed as context, and source as footer', () => {
    const g = expandShorthand({ id: 's', type: 'stat', z: 0, pos: [0, 0, 1080, 1350],
      value: '9.4 hrs', context: 'lost to context-switching every week', source: 'Source: Asana' } as unknown as ShorthandLayer) as unknown as { layers?: Array<{ content?: { value?: string }; layers?: unknown[] }> };
    const all = (g.layers ?? []).flatMap(collect);
    expect(all.some(t => t.includes('context-switching'))).toBe(true);
    expect(all.some(t => t.includes('Source: Asana'))).toBe(true);
  });
});

describe('sections block item-array aliases (model names it rows/data, not items)', () => {
  // The "By the numbers" slide rendered BLANK: model sent stats:{rows:[…]} and
  // bars:{data:[…]} but the engine only read b['items'] → both blocks empty.
  const collectText = (l: { content?: { value?: string }; layers?: unknown[] }): string[] => {
    const out: string[] = [];
    if (l.content?.value) out.push(l.content.value);
    for (const c of (l.layers ?? []) as Array<typeof l>) out.push(...collectText(c));
    return out;
  };
  it('stats accepts rows[], bars accepts data[] — content is not dropped', () => {
    const g = expandShorthand({
      id: 'nums', type: 'sections', z: 0, pos: [0, 0, 1080, 1080], title: 'By the numbers',
      blocks: [
        { kind: 'stats', rows: [{ value: '30%', label: 'renewable share' }, { value: '6%', label: 'solar' }] },
        { kind: 'bars', data: [{ label: 'Renewables', value: 80 }, { label: 'Fossil fuels', value: 20 }] },
      ],
    } as unknown as ShorthandLayer) as unknown as { layers: Array<{ content?: { value?: string }; layers?: unknown[] }> };
    const all = g.layers.flatMap(collectText);
    expect(all).toContain('30%');
    expect(all).toContain('6%');
    expect(all).toContain('Renewables');
    expect(all).toContain('Fossil fuels');
  });
});

describe('heading legibility on a dark canvas (vision-loop: invisible-title fix)', () => {
  type G = { layers: Array<Record<string, unknown>> };
  const exp = (sh: Record<string, unknown>): G => expandShorthand(sh as unknown as ShorthandLayer) as unknown as G;
  const find = (g: G, suffix: string) => g.layers.find(l => String(l.id).endsWith(suffix)) as
    { y?: number; height?: number; style?: { color?: string; font_size?: number } } | undefined;
  const color = (g: G, suffix: string): string => String(find(g, suffix)?.style?.color ?? '');

  it('feature_grid heading on a dark bg flips to light (was invisible #1A1A1A-on-dark)', () => {
    // model set a dark bg but gave NO text_color → engine must not leave a dark title.
    const g = exp({ id: 'fg', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080], bg: '#0A0A0A', accent: '#FF6A3D',
      title: 'Strait of Hormuz Crisis: 5 Immediate Actions', subtitle: 'What the world must do now',
      items: [{ icon: 'anchor', title: 'A', desc: 'd' }, { icon: 'flag', title: 'B', desc: 'd' }] });
    expect(color(g, 'fg_title')).toBe('#FAFAFA');
    expect(color(g, 'fg_subtitle')).toBe('#FAFAFA');
  });

  it('feature_grid: a long wrapped title never overflows into the subtitle or the cards row', () => {
    const g = exp({ id: 'fg', type: 'feature_grid', z: 0, pos: [0, 0, 1080, 1080], bg: '#0A0A0A', accent: '#FF6A3D',
      title: 'Strait of Hormuz Crisis: 5 Immediate Actions', subtitle: 'What the world must do now to protect global energy flows',
      items: [{ icon: 'anchor', title: 'A', desc: 'd' }, { icon: 'flag', title: 'B', desc: 'd' }] });
    const title = find(g, 'fg_title')!, sub = find(g, 'fg_subtitle')!, row = g.layers.find(l => l.id === 'fg_row') as { y?: number };
    expect((title.y! + title.height!)).toBeLessThanOrEqual(sub.y! + 2);     // title clears the subtitle
    expect((sub.y! + sub.height!)).toBeLessThanOrEqual(row.y! as number);   // heading clears the cards
    // the long title was shrunk below the nominal 0.08*W start size
    expect(title.style!.font_size!).toBeLessThan(Math.round(1080 * 0.08));
  });

  it('editorial / sections / list / stat / event headings all go light on a dark bg', () => {
    const dark = { bg: '#0A0A0A', accent: '#FF6A3D' };
    expect(color(exp({ id: 'ed', type: 'editorial', z: 0, pos: [0, 0, 1080, 1350], ...dark, title: 'X', body: 'b' }), 'ed_title')).toBe('#FAFAFA');
    // sections may draw a masthead BAND for some seeds — then the title reads
    // dark-on-light-slab instead of light-on-canvas. Assert legibility against the
    // actual backdrop (band fill if present, else the dark canvas), tone-agnostic.
    const sx = exp({ id: 'sx', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], ...dark, title: 'X', blocks: [{ kind: 'text', text: 't' }] });
    const sxBand = sx.layers.find(l => String(l.id).endsWith('_mband')) as { fill?: { color?: string } } | undefined;
    const lum = (hex: string): number => { const h = hex.replace('#', ''); return (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255; };
    expect(Math.abs(lum(color(sx, 'sx_title')) - lum(sxBand?.fill?.color ?? '#0A0A0A'))).toBeGreaterThan(0.4);
    expect(color(exp({ id: 'ls', type: 'list', z: 0, pos: [0, 0, 1080, 1350], ...dark, title: 'X', items: [{ title: 'a', desc: 'd' }] }), 'ls_title')).toBe('#FAFAFA');
    expect(color(exp({ id: 'st', type: 'stat', z: 0, pos: [0, 0, 1080, 1350], ...dark, stat: '90%', caption: 'a real sentence of context here' }), 'st_cap')).toBe('#FAFAFA');
    expect(color(exp({ id: 'ev', type: 'event', z: 0, pos: [0, 0, 1080, 1350], ...dark, title: 'GALA', details: ['JUN 6'] }), 'ev_title')).toBe('#FAFAFA');
  });

  it('a light bg still yields dark text (no regression on the cream default)', () => {
    const g = exp({ id: 'ed', type: 'editorial', z: 0, pos: [0, 0, 1080, 1350], bg: '#FAF5EC', title: 'X', body: 'b' });
    expect(color(g, 'ed_title')).toBe('#1A1A1A');
  });

  it('an explicit, contrasting text_color is preserved (not force-flipped)', () => {
    const g = exp({ id: 'ed', type: 'editorial', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', text_color: '#FFD400', title: 'X', body: 'b' });
    expect(color(g, 'ed_title')).toBe('#FFD400');
  });
});

describe('seeded default mood — no-bg presets vary by topic (the 30B "same-template" fix)', () => {
  type G = { layers: Array<Record<string, unknown>> };
  const sec = (id: string, title: string, intro: string): G => expandShorthand({
    id, type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title,
    blocks: [{ kind: 'text', text: intro }],
  } as unknown as ShorthandLayer) as unknown as G;
  // The composed canvas base rect carries the bg color/fill.
  const bgOf = (g: G): string => {
    const l = g.layers.find(x => String(x.id).endsWith('_bg'));
    return JSON.stringify((l as { fill?: unknown } | undefined)?.fill ?? null);
  };

  it('two different topics with NO bg get different canvases (not one cream default)', () => {
    const ocean = sec('a', 'Deep Sea Abyss', 'The abyssal zone far below sea level harbors bioluminescent marine creatures.');
    const volcano = sec('b', 'Volcano Science', 'Volcanoes erupt molten rock and lava from deep in the Earth.');
    const neon = sec('c', 'Neon Sign History', 'Neon signs lit cities through the 20th century, a vintage glow.');
    expect(new Set([bgOf(ocean), bgOf(volcano), bgOf(neon)]).size).toBe(3);
  });

  it('the same content is deterministic (no Math.random in the seed)', () => {
    expect(bgOf(sec('a', 'Volcano Science', 'Volcanoes erupt molten rock.')))
      .toBe(bgOf(sec('z', 'Volcano Science', 'Volcanoes erupt molten rock.')));
  });

  it('an explicit bg is always honored over the seeded default', () => {
    const g = expandShorthand({ id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1920],
      bg: '#123456', title: 'X', blocks: [{ kind: 'text', text: 'y' }] } as unknown as ShorthandLayer) as unknown as G;
    expect(bgOf(g).toLowerCase()).toContain('123456');
  });

  it('content lanes steer the seed: an ocean topic lands on a dark teal canvas', () => {
    const g = sec('o', 'Deep Sea Abyss', 'The abyssal zone below sea level — marine life in the deep ocean.');
    // teal-ocean mood bg is #06141B; the base rect should carry it.
    expect(bgOf(g).toLowerCase()).toContain('06141b');
  });
});

describe('coerceShorthandLayers — recover a MALFORMED stringified layers_shorthand (30B blank-design fix)', () => {
  const type0 = (s: string): string | undefined => {
    const out = coerceShorthandLayers(s);
    return out[0]?.type;
  };
  it('a clean stringified array still parses', () => {
    expect(type0('[{"type":"sections","blocks":[{"kind":"text","text":"hi"}]}]')).toBe('sections');
  });
  it('truncated — missing the final closing brace (model hit a token limit)', () => {
    expect(type0('{"type":"sections","bg":"#06141B","blocks":[{"kind":"text","text":"hi"}]')).toBe('sections');
  });
  it('the OTHER tool params got concatenated into the string', () => {
    expect(type0('[{"type":"sections","blocks":[{"kind":"text","text":"hi"}]}],"design_path":"/x.yaml","project_path":"/x"}')).toBe('sections');
  });
  it('a doubled closing brace at the end', () => {
    expect(type0('{"type":"sections","blocks":[{"kind":"text","text":"hi"}]}}')).toBe('sections');
  });
  it('a single stringified object (not an array) is wrapped', () => {
    expect(type0('{"type":"stat","stat":"90%","caption":"a real sentence of context here that is long enough"}')).toBe('stat');
  });
  it('genuine junk still yields no usable layer', () => {
    expect(coerceShorthandLayers('not json at all, just prose').length).toBe(0);
  });
});

describe('composeBackground — geometric (non-circular) sweeps + style font', () => {
  type G = { layers: Array<Record<string, unknown>> };
  const exp = (bg_style: string): G => expandShorthand({
    id: 'g', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF6A3D',
    bg_style, title: 'T', blocks: [{ kind: 'text', text: 'x' }],
  } as unknown as ShorthandLayer) as unknown as G;
  const has = (g: G, suffix: string): boolean => g.layers.some(l => String(l.id).includes(suffix));
  const layer = (g: G, suffix: string) => g.layers.find(l => String(l.id).includes(suffix)) as { type?: string; d?: string; stroke?: unknown } | undefined;

  it('triangles render as path layers (hard corners, not a blob)', () => {
    const g = exp('tri:br + grain');
    expect(layer(g, '_tri0')?.type).toBe('path');
    expect(layer(g, '_tri0')?.d).toContain('Z'); // a closed triangle path
  });
  it('blocks render as rectangles', () => {
    expect(layer(exp('blocks + grain'), '_blk0')?.type).toBe('rect');
  });
  it('rings render as STROKED ovals (outline, no fill)', () => {
    const r = layer(exp('rings:tr + grain'), '_ring0');
    expect(r?.type).toBe('ellipse');
    expect(r?.stroke).toBeTruthy();
  });
  it('arcs / diagonals / waves / shards all emit their layers', () => {
    expect(has(exp('arcs:bottom + grain'), '_arc')).toBe(true);
    expect(has(exp('diag:tr + grain'), '_diag')).toBe(true);
    expect(has(exp('wave:bottom + grain'), '_wave')).toBe(true);
    expect(has(exp('shards + grain'), '_sh0')).toBe(true);
  });
  it('a combined recipe stacks several distinct geometric sweeps', () => {
    const g = exp('tri:br + blocks + rings:tr + grain');
    expect(has(g, '_tri0') && has(g, '_blk0') && has(g, '_ring0')).toBe(true);
  });

  it('the seeded style font lands on the section title; an explicit font overrides', () => {
    const seeded = expandShorthand({ id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1350],
      title: 'Deep Sea Abyss', blocks: [{ kind: 'text', text: 'marine life in the ocean deep' }] } as unknown as ShorthandLayer) as unknown as G;
    const t = seeded.layers.find(l => l.id === 's_title') as { style?: { font_family?: string } } | undefined;
    expect(typeof t?.style?.font_family).toBe('string');
    expect((t?.style?.font_family ?? '').length).toBeGreaterThan(0);
    const explicit = expandShorthand({ id: 'e', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#101010',
      font: 'Bebas Neue', title: 'X', blocks: [{ kind: 'text', text: 'y' }] } as unknown as ShorthandLayer) as unknown as G;
    const te = explicit.layers.find(l => l.id === 'e_title') as { style?: { font_family?: string } } | undefined;
    expect(te?.style?.font_family).toBe('Bebas Neue');
  });
});

describe('sections — canvas auto-fits to content (kills dead space, prevents clipping)', () => {
  type GH = { type?: string; height?: number; layers: { id: string; type: string }[] };
  const block = (i: number) => ({ kind: 'text', heading: `Sub-theme ${i}`, text: 'A reasonably long paragraph of supporting copy that wraps across several lines to take up real vertical space on the page.' });
  const build = (n: number) => expandShorthand({ id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], bg: '#0A0A0A',
    title: 'A Headline', subtitle: 'A two sentence intro deck that frames the topic for the reader.',
    blocks: Array.from({ length: n }, (_, i) => block(i + 1)) } as unknown as ShorthandLayer) as unknown as GH;

  it('a SPARSE deck shrinks the group well below the requested 1920', () => {
    const g = build(1);
    expect(g.type).toBe('group');
    expect(g.height ?? 0).toBeLessThan(1500);
    expect(g.height ?? 0).toBeGreaterThanOrEqual(Math.round(1080 * 0.9)); // not collapsed past the floor
  });
  it('a DENSE deck grows the group past 1920 so nothing clips', () => {
    const sparse = build(1).height ?? 0;
    const g = build(16);
    expect(g.height ?? 0).toBeGreaterThan(1920);   // grows beyond the requested height
    expect(g.height ?? 0).toBeGreaterThan(sparse); // and is taller than the sparse page
  });
  it('the full-bleed background spans the fitted height (sweep geometry matches the page)', () => {
    const g = build(1);
    const bg = g.layers.find(l => l.id === 's_bg') as { height?: number } | undefined;
    expect(bg?.height).toBe(g.height);
  });
});

describe('sections — per-style headline treatments (typographic variety)', () => {
  type L = { id: string; type: string; rotation?: number; style?: { font_size?: number; highlight?: string }; fill?: { color?: string } };
  type G = { layers: L[] };
  const make = (treatment: string) => expandShorthand({ id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#F4B740',
    headline_style: treatment, kicker: 'Field Report', title: 'A Headline', subtitle: 'A deck.',
    blocks: [{ kind: 'text', heading: 'H', text: 'Some body copy that fills a line or two.' }] } as unknown as ShorthandLayer) as unknown as G;
  const find = (g: G, suffix: string) => g.layers.find(l => l.id.includes(suffix));

  it('highlight → the kicker carries a marker band (style.highlight = accent)', () => {
    const k = find(make('highlight'), '_kick') as L | undefined;
    expect(k?.style?.highlight).toBe('#F4B740');
  });
  it('underline → an accent bar (_ul) sits under the title', () => {
    const ul = find(make('underline'), '_ul') as L | undefined;
    expect(ul?.type).toBe('rect');
    expect(ul?.fill?.color).toBe('#F4B740');
  });
  it('rotate → the kicker is a -90° rotated layer; no underline/rule-only-when-due', () => {
    const k = find(make('rotate'), '_kick') as L | undefined;
    expect(k?.rotation).toBe(-90);
  });
  it('mega → the title is meaningfully larger than the plain rule treatment', () => {
    const mega = find(make('mega'), '_title') as L | undefined;
    const plain = find(make('rule'), '_title') as L | undefined;
    expect((mega?.style?.font_size ?? 0)).toBeGreaterThan(plain?.style?.font_size ?? 0);
  });
});

describe('headline overflow — an oversized single word is shrunk to fit the column', () => {
  type LT = { id: string; style?: { font_size?: number } };
  type GT = { layers: LT[] };
  const titleSize = (title: string) => {
    const g = expandShorthand({ id: 's', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A',
      title, blocks: [{ kind: 'text', text: 'body' }] } as unknown as ShorthandLayer) as unknown as GT;
    return (g.layers.find(l => l.id === 's_title') as LT | undefined)?.style?.font_size ?? 0;
  };
  it('a long unwrappable word gets a smaller font than a short title', () => {
    const shortT = titleSize('Brief Title');
    const longWord = titleSize('Internationalization Antidisestablishmentarianism');
    expect(longWord).toBeLessThan(shortT);
    expect(longWord).toBeGreaterThan(0); // floored, never collapses
  });
});

describe('recoverStringifiedPreset — rescues a preset blob stuffed into a text layer', () => {
  const txt = (value: string): Layer => ({ id: 't', type: 'text', content: { type: 'plain', value } } as unknown as Layer);
  const bg = (): Layer => ({ id: 'r', type: 'rect', pos: [0, 0, 1080, 2000] } as unknown as Layer);

  it('array form: [{type:"sections",…,blocks:[…]}] in a text value → one sections layer', () => {
    const blob = JSON.stringify([{ type: 'sections', kicker: 'Astrophysics', title: 'Black Holes',
      subtitle: 'overview', blocks: [{ type: 'stats', items: [{ value: '30 km', label: 'radius' }] }] }]);
    const got = recoverStringifiedPreset([txt(blob), bg()]);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(1);
    expect(got![0].type).toBe('sections');
    // the recovered preset expands into a real layer tree (not a JSON wall)
    const tree = expandShorthandLayers(got!);
    expect(tree[0].type).toBe('group');
  });

  it('object form with blocks but NO type → defaulted to sections (the sleep blank)', () => {
    const blob = JSON.stringify({ accent: '#3E7C5A', bg: '#F2F0E6', kicker: 'Sleep Facts',
      subtitle: 'why rest matters', headline: 'Why We Sleep',
      blocks: [{ type: 'heading_text', heading: 'The Science', subtitles: ['…'] }] });
    const got = recoverStringifiedPreset([txt(blob)]);
    expect(got).not.toBeNull();
    expect(got![0].type).toBe('sections');           // type injected, not exploded into per-key layers
    expect(got!.length).toBe(1);
  });

  it('recovers even from a TRUNCATED blob (closeJsonString repair)', () => {
    const full = JSON.stringify([{ type: 'sections', title: 'X', blocks: [{ type: 'stats', items: [{ value: '1', label: 'a' }] }] }]);
    const got = recoverStringifiedPreset([txt(full.slice(0, full.length - 3))]); // chop the closing braces
    expect(got).not.toBeNull();
    expect(got![0].type).toBe('sections');
  });

  it('single-key wrapper {"sections": {field-keyed blocks}} → one sections layer with blocks (live 30B find)', () => {
    const blob = JSON.stringify({ sections: {
      kicker: 'Ocean Currents',
      stats: [{ value: '15 Sv', label: 'AMOC flow' }, { value: '5-6 mph', label: 'Gulf Stream speed' }],
      heading_text: [{ heading: 'What drives them?', body: 'Wind, temperature, salinity and Coriolis.' }],
      bars: [{ label: 'AMOC', value: 15 }, { label: 'ACC', value: 135 }],
      callout: { label: 'Takeaway', text: 'Currents regulate global climate.' },
    } });
    const got = recoverStringifiedPreset([txt(blob), bg()]);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(1);
    expect(got![0].type).toBe('sections');
    // field-keyed content was synthesized into a real blocks[] array
    const blocks = (got![0] as unknown as { blocks?: unknown[] }).blocks;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks!.length).toBeGreaterThanOrEqual(4); // stats + heading_text + bars + callout
    // and it expands into a real layer tree, not a JSON wall
    expect(expandShorthandLayers(got!)[0].type).toBe('group');
  });

  it('field-keyed sections object WITHOUT a wrapper or type → defaulted to sections + blocks built', () => {
    const blob = JSON.stringify({ kicker: 'Coffee', title: 'The Bean Trade',
      stats: [{ value: '$100B', label: 'market' }], bars: [{ label: 'Brazil', value: 90 }] });
    const got = recoverStringifiedPreset([txt(blob)]);
    expect(got).not.toBeNull();
    expect(got![0].type).toBe('sections');
    expect((got![0] as unknown as { blocks?: unknown[] }).blocks!.length).toBe(2);
  });

  it('does NOT hijack a legitimate text layer that merely contains JSON-like text', () => {
    expect(recoverStringifiedPreset([txt('{"latitude": 40.7, "longitude": -74.0}')])).toBeNull();
    expect(recoverStringifiedPreset([txt('Save 30% on { everything } this week')])).toBeNull();
  });

  it('returns null when there is no text layer carrying a preset (the healthy case)', () => {
    expect(recoverStringifiedPreset([bg()])).toBeNull();
    expect(recoverStringifiedPreset([txt('A Brief History of Jazz')])).toBeNull();
  });
});

describe('sections stat-fill robustness (vision-loop: oceans + energy fixes)', () => {
  type Node = { id?: string; content?: { value?: string }; layers?: Node[] };
  const flat = (l: Node): Node[] => [l, ...((l.layers ?? []).flatMap(flat))];
  const exp = (sh: Record<string, unknown>): Node => expandShorthand(sh as unknown as ShorthandLayer) as unknown as Node;
  const texts = (g: Node): string[] => flat(g).map(n => n.content?.value ?? '').filter(Boolean);
  const byId = (g: Node, suffix: string): Node | undefined => flat(g).find(n => String(n.id ?? '').endsWith(suffix));

  it('coalesces singular {type:"stat",value,label} blocks into ONE row, keeping labels (g_oceans)', () => {
    const g = exp({ id: 'oc', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'Save Our Oceans',
      blocks: [
        { type: 'stat', value: '8M', label: 'tons of plastic enter ocean each year' },
        { type: 'stat', value: '91%', label: 'of plastic is not recycled' },
        { type: 'stat', value: '30%', label: 'of marine species affected' },
        { type: 'stat', value: '100K', label: 'marine animals die annually' },
      ] });
    const all = texts(g);
    // value AND label both survive — the label was previously dropped by the fallback
    expect(all).toContain('8M'); expect(all).toContain('100K');
    expect(all.some(t => t.includes('tons of plastic'))).toBe(true);
    expect(all.some(t => t.includes('not recycled'))).toBe(true);
    // folded into ONE stats row: the first block carries the figure cells _v0.._v3
    expect(byId(g, '_b0_v0')?.content?.value).toBe('8M');
    expect(byId(g, '_b0_v3')?.content?.value).toBe('100K');
  });

  it('corrects a SWAPPED label/value stat so the figure is the big number (g_energy)', () => {
    const g = exp({ id: 'en', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'Renewables',
      blocks: [{ type: 'stats', items: [
        { label: '30%', value: 'Share of global electricity from renewables (2023)' },
        { label: '1.0 TW', value: 'Solar PV capacity' },
        { label: '$500B', value: 'Investment 2023' },
      ] }] });
    expect(byId(g, '_b0_v0')?.content?.value).toBe('30%');       // figure in the big slot
    expect(byId(g, '_b0_v1')?.content?.value).toBe('1.0 TW');
    expect(String(byId(g, '_b0_l0')?.content?.value ?? '')).toContain('Share of global'); // prose → caption
  });

  it('does NOT swap a well-formed stat (figure already in value)', () => {
    const g = exp({ id: 'ok', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'X',
      blocks: [{ type: 'stats', items: [{ value: '70%', label: 'enterprises using AI' }] }] });
    expect(byId(g, '_b0_v0')?.content?.value).toBe('70%');
    expect(String(byId(g, '_b0_l0')?.content?.value ?? '')).toContain('enterprises');
  });

  it('renders a heading_text block as subhead + body (sub_theme / text aliases)', () => {
    const g = exp({ id: 'ht', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'X',
      blocks: [{ type: 'heading_text', sub_theme: 'Cost Reductions', text: 'Solar PV LCOE fell 90% since 2010.' }] });
    const all = texts(g);
    expect(all).toContain('Cost Reductions');
    expect(all.some(t => t.includes('LCOE fell 90%'))).toBe(true);
  });

  it('flattens DOUBLE-NESTED blocks [[{block}],[{block}]] so they are not empty (g_arch)', () => {
    const g = exp({ id: 'dn', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'Architecture',
      blocks: [
        [{ type: 'stats', items: [{ value: '1,200+', label: 'super-tall towers' }] }],
        [{ type: 'heading_text', sub_theme: 'Sustainability', text: 'Passive design and net-zero targets.' }],
        [{ type: 'callout', label: 'Key Takeaway', text: 'Form meets sustainability.' }],
      ] });
    const all = texts(g);
    expect(all).toContain('1,200+');                              // the nested stat rendered
    expect(all).toContain('Sustainability');
    expect(all.some(t => t.includes('net-zero'))).toBe(true);
    expect(all.some(t => t.includes('Form meets'))).toBe(true);
  });

  it('a stats block with NO figures renders the captions, not empty big-number slots (g_color)', () => {
    const g = exp({ id: 'cl', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'Color',
      blocks: [{ type: 'stats', items: [
        { value: '', label: 'Consumers who say color influences purchase' },
        { value: '', label: 'Ad recall lift with vibrant colors' },
      ] }] });
    const all = texts(g);
    expect(byId(g, '_b0_v0')).toBeUndefined();                   // no empty figure cell
    expect(all.some(t => t.includes('influences purchase'))).toBe(true); // caption copy survives
    expect(all.some(t => t.includes('Ad recall'))).toBe(true);
  });

  it('drops only the figure-less cells when a stats block is mixed', () => {
    const g = exp({ id: 'mx', type: 'sections', z: 0, pos: [0, 0, 1080, 1920], title: 'X',
      blocks: [{ type: 'stats', items: [
        { value: '70%', label: 'with figure' },
        { value: '', label: 'no figure' },
      ] }] });
    expect(byId(g, '_b0_v0')?.content?.value).toBe('70%');
    expect(byId(g, '_b0_v1')).toBeUndefined();                   // the empty cell dropped
  });
});

describe('list preset sizes to content (no clip on dense, no dead band on sparse — g_habits)', () => {
  type Node = { id: string; y: number; height: number };
  const list = (n: number) => expandShorthand({ id: 'hb', type: 'list', z: 0, pos: [0, 0, 1080, 1350],
    title: 'Habits of Deep Work', marker: 'number', footer: 'source',
    items: Array.from({ length: n }, (_, i) => ({ title: `Habit ${i + 1} with a reasonably long name`,
      desc: 'A sentence of supporting detail that takes a line or two to explain the habit fully.' })),
  } as unknown as ShorthandLayer) as unknown as { height: number; layers: Node[] };

  it('GROWS the group past a short 1350 canvas for 7 dense items (was clipped)', () => {
    const g = list(7);
    expect(g.height).toBeGreaterThan(1350);
    const last = g.layers.find(l => l.id === 'hb_t6')!;
    expect(last.y + last.height).toBeLessThanOrEqual(g.height);  // last item fits inside the group
    const foot = g.layers.find(l => l.id === 'hb_footer')!;
    expect(foot.y).toBeGreaterThan(last.y);                      // footer below the last item, no collision
  });

  it('SHRINKS below 1350 for a sparse 3-item list (no dead band)', () => {
    expect(list(3).height).toBeLessThan(1350);
  });
});

describe('fillFlowPresetsToPage — a carousel list slide fills the page (no dead strip)', () => {
  it('marks a boxless list-family preset and skips one that already has a box', () => {
    const layers = [{ type: 'list', title: 'X' }, { type: 'steps', pos: [0, 0, 500, 500] }] as unknown as ShorthandLayer[];
    expect(fillFlowPresetsToPage(layers, 1080, 1080)).toBe(1);
    const a = layers[0] as unknown as Record<string, unknown>;
    expect(a['__fillPage']).toBe(true);
    expect(a['pos']).toEqual([0, 0, 1080, 1080]);
    expect((layers[1] as unknown as Record<string, unknown>)['__fillPage']).toBeUndefined();
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
