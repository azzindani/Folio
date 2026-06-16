import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, compressDesignContext, diagnoseShorthandKeys, type ShorthandLayer } from './shorthand-parser';

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
    const result = expandShorthand(sh) as unknown as { type: string; width: number; height: number; meta?: { role?: string }; layers: Record<string, unknown>[] };
    expect(result.type).toBe('group');
    expect(result.meta?.role).toBe('motif');                         // tagged for collision-drop in ingest
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
    const findDeep = (ls: FGLayer[], id: string): FGLayer | undefined => { for (const l of ls) { if (l.id === id) return l; if (l.layers) { const f = findDeep(l.layers, id); if (f) return f; } } return undefined; };
    const card = findDeep(r.layers!, 'fg_card0')!;               // cards nest inside row-groups
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
