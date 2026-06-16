import { describe, it, expect } from 'vitest';
import { expandShorthand, expandShorthandLayers, coerceShorthandLayers, recoverStringifiedPreset, diagnoseLayers, type ShorthandLayer } from './shorthand-parser';
import type { Layer } from '../schema/types';

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
  const fgCard = (n: number, titleLen: number, descLen: number, id = 'fg', w = 1080, h = 1080) => {
    const items = Array.from({ length: n }, (_, i) => ({ icon: 'zap', title: 'T'.repeat(titleLen) + i, desc: 'd '.repeat(descLen) }));
    return expandShorthand({ id, type: 'feature_grid', z: 0, pos: [0, 0, w, h], bg: '#0A0A0A', title: 'X', items } as unknown as ShorthandLayer) as unknown as { layers: Array<Record<string, unknown>> };
  };
  const findDeep = (ls: Array<Record<string, unknown>>, pred: (l: Record<string, unknown>) => boolean): Record<string, unknown> | undefined => {
    for (const l of ls) { if (pred(l)) return l; const k = l['layers']; if (Array.isArray(k)) { const f = findDeep(k as Array<Record<string, unknown>>, pred); if (f) return f; } }
    return undefined;
  };
  const cardKid = (g: { layers: Array<Record<string, unknown>> }, suffix: string) => {
    const card = findDeep(g.layers, c => String(c.id).endsWith('_card1')) as { layers?: Array<Record<string, unknown>> };
    return card.layers!.find(k => String(k.id).includes(suffix))!;
  };

  it('a longer description gets a taller measured box (not a fixed height)', () => {
    const short = cardKid(fgCard(3, 4, 2, 'a'), '_desc');
    const long = cardKid(fgCard(3, 4, 20, 'b'), '_desc');
    expect(Number(long.height)).toBeGreaterThan(Number(short.height));
  });

  it('narrower cards (more of them) use a smaller title font', () => {
    // Wide canvas → all cards stay in one row, so more cards = genuinely narrower.
    const few = cardKid(fgCard(2, 10, 4, 'c', 1600, 600), '_title') as { style?: { font_size?: number } };
    const many = cardKid(fgCard(6, 10, 4, 'd', 1600, 600), '_title') as { style?: { font_size?: number } };
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
