// Folio shorthand parser — preset builders: chart/feature-grid/decor/editorial/split. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer, Fill } from '../schema/types';

import { hexToRgb, luminance } from './engine/reference';

import { shStr, asHex, contrastRatio, readableOn, readablePair, seededDefaults, ShorthandLayer, expandFill, defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt, footerLayer, mixHex } from './shorthand-helpers';
import { pickGridLayout } from './engine/mood-bank';

import { composeBackground } from './shorthand-background';

// FNV-1a over the content — seeds a STRUCTURAL variant for the editorial preset
// (stable per content, varied across topics) so two essays don't share a shape.
function edHashEditorial(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  const t = s && s.trim() ? s : 'editorial';
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function buildChartSpec(sh: ShorthandLayer): Record<string, unknown> {
  const raw = (sh as Record<string, unknown>)['spec'];
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  const kind = typeof sh.chart === 'string' ? sh.chart.toLowerCase() : 'bar';
  const rows = Array.isArray((sh as Record<string, unknown>)['data'])
    ? ((sh as Record<string, unknown>)['data'] as Record<string, unknown>[]) : [];
  const values = (rows.length ? rows : [{ x: 'A', y: 1 }]).map(r => {
    const x = r['x'] ?? r['label'] ?? r['name'] ?? r['category'] ?? r['key'] ?? '';
    const yr = r['y'] ?? r['value'] ?? r['count'] ?? r['amount'] ?? r['v'] ?? 0;
    return { x, y: typeof yr === 'number' ? yr : Number(yr) || 0 };
  });
  if (kind === 'pie' || kind === 'donut') {
    return {
      mark: { type: 'arc', innerRadius: kind === 'donut' ? 60 : 0 },
      encoding: { theta: { field: 'y', type: 'quantitative' }, color: { field: 'x', type: 'nominal' } },
      data: { values },
    };
  }
  return {
    mark: kind === 'line' ? 'line' : kind === 'area' ? 'area' : 'bar',
    encoding: { x: { field: 'x', type: 'nominal' }, y: { field: 'y', type: 'quantitative' } },
    data: { values },
  };
}

// Compile a `feature_grid` preset into a fully-positioned layer tree. The model
// supplies ONLY content (title, subtitle, items[{icon,title,desc}]) + optional
// colors; the engine owns every coordinate, size and z — so a model that can't
// reliably place a row of cards by hand still gets a correct layout. Sizes are
// derived from the box, defaulting to a 1080² canvas.

export function buildFeatureGrid(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  // Structural archetype — the tiled rounded-card grid (default) OR full-width
  // editorial ROWS (marker left, copy right, hairline dividers, no card fill).
  // Overridable via layout/variant; else seeded from the content so two feature
  // posters don't share the one tiled-card silhouette (the "same-y" complaint).
  const layoutField = shStr(r['layout'] ?? r['variant'] ?? r['archetype']).toLowerCase();
  const arch = (layoutField === 'rows' || layoutField === 'list' || layoutField === 'editorial' || layoutField === 'stack') ? 'rows'
    : (layoutField === 'cards' || layoutField === 'grid' || layoutField === 'tiles') ? 'cards'
    : pickGridLayout(`${shStr(r['title'])} ${shStr(r['subtitle'])}`).archetype;
  if (arch === 'rows') return buildFeatureRows(sh, id, z);
  const X = sh.pos?.[0] ?? (typeof sh.x === 'number' ? sh.x : 0);
  const Y = sh.pos?.[1] ?? (typeof sh.y === 'number' ? sh.y : 0);
  const W = sh.pos?.[2] ?? (typeof sh.width === 'number' ? sh.width : 1080);
  const H = sh.pos?.[3] ?? (typeof sh.height === 'number' ? sh.height : 1080);
  // Accept a string, or {text}/{value} (models sometimes wrap a field).
  const str = (v: unknown, d = ''): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o['text'] === 'string') return o['text']; if (typeof o['value'] === 'string') return o['value']; }
    return d;
  };
  // bg from `bg`, or a `bg_gradient` color list / {colors:[…]} the model sends.
  let bgFill: string | Fill | undefined = r['bg'] as string | Fill | undefined;
  if (bgFill === undefined && r['bg_gradient'] !== undefined) {
    const g = r['bg_gradient'];
    const colors = Array.isArray(g) ? g : (g && typeof g === 'object' && Array.isArray((g as Record<string, unknown>)['colors']) ? (g as Record<string, unknown>)['colors'] as unknown[] : []);
    const hex = colors.filter(c => typeof c === 'string') as string[];
    if (hex.length >= 2) bgFill = `linear-gradient(135deg, ${hex.join(', ')})`;
  }
  // No bg from the model → seed a topic-apt mood from the card content so two
  // different feature posters don't both fall to the same default canvas.
  const m = seededDefaults(r, [str(r['title']), str(r['subtitle']), r['items'] ?? r['cards'] ?? r['features']]);
  if (bgFill === undefined && m) bgFill = m.bg;
  const cardFill  = str(r['card_fill'], '$surface');
  const accent    = str(r['accent'], m?.accent ?? '$primary');
  const textColor = str(r['text_color'] ?? r['color'], m?.text_color ?? '$text');
  const muted     = str(r['muted'], textColor);
  const bgStyle   = str(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette   = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  // Card text MUST contrast the CARD fill, not the global canvas. A blind model
  // that picks a dark canvas + light text would otherwise drop that light text
  // onto a light ($surface) card → invisible (the #1 feature_grid failure).
  // Resolve a concrete card surface and pick readable on-card colors.
  // Detect a dark canvas whether bg is a HEX, a gradient STRING, or a Fill OBJECT.
  // A gradient (e.g. '#14100A'→'#805a05') used to read as non-dark — asHex of a
  // gradient/object is null — so the cards skipped the light-card/dark-text branch
  // and dropped the global LIGHT text onto a light surface → invisible (suite-079).
  const collectHexes = (f: string | Fill | undefined): string[] => {
    if (!f) return [];
    if (typeof f === 'string') {
      const m2 = f.match(/#[0-9a-fA-F]{6}/g);
      if (m2 && m2.length) return m2;
      const h = asHex(f); return h ? [h] : [];
    }
    const o = f as unknown as Record<string, unknown>;
    const out: string[] = [];
    if (typeof o['color'] === 'string') { const h = asHex(o['color']); if (h) out.push(h); }
    const stops = o['stops'];
    if (Array.isArray(stops)) for (const s of stops) {
      const sc = (s as Record<string, unknown>)?.['color'];
      if (typeof sc === 'string') { const h = asHex(sc); if (h) out.push(h); }
    }
    return out;
  };
  const bgHexes = collectHexes(bgFill);
  const bgDark = bgHexes.length
    ? (bgHexes.reduce((sum, h) => { const rgb = hexToRgb(h); return sum + (rgb ? luminance(rgb) : 1); }, 0) / bgHexes.length) < 0.42
    : false;
  const explicitCard = asHex(r['card_fill']);
  let cardFillResolved: string | Fill = cardFill;
  let cardText = textColor, cardMuted = muted, cardIcon = accent;
  if (explicitCard) {
    cardFillResolved = explicitCard;
    cardText = readableOn(explicitCard, textColor);
    cardMuted = readableOn(explicitCard, muted);
    cardIcon = contrastRatio(accent, explicitCard) >= 2 ? accent : readableOn(explicitCard, accent);
  } else if (bgDark) {
    // Light cards on a dark canvas + dark text — striking AND legible.
    cardFillResolved = '#F4F1EA';
    cardText = '#1A1A1A'; cardMuted = '#5A5650';
    cardIcon = contrastRatio(accent, '#F4F1EA') >= 2 ? accent : '#1A1A1A';
  }
  const rawItems = Array.isArray(r['items']) ? r['items'] : Array.isArray(r['cards']) ? r['cards'] : Array.isArray(r['features']) ? r['features'] : [];
  const items = (rawItems as Record<string, unknown>[]).slice(0, 5).map(it => ({
    icon: str(it['icon'] ?? it['symbol']),
    title: str(it['title'] ?? it['label'] ?? it['name']),
    desc: str(it['desc'] ?? it['description'] ?? it['text'] ?? it['body'] ?? it['benefit']),
  }));
  const N = Math.max(1, items.length);
  const M = Math.round(W * 0.07);
  const gap = Math.round(M * 0.4);
  // Column count: a single row of N cards reads as a thin strip on a square /
  // portrait canvas, wasting most of the height. Wrap to a balanced grid unless
  // the canvas is wide. 1-3 stay one row; 4 → 2×2; 5-6 → 3 across. A wide canvas
  // (e.g. a banner) keeps the single row.
  const wide = W > H * 1.25;
  const cols = wide || N <= 3 ? N : (N === 4 ? 2 : 3);
  const rowsN = Math.ceil(N / cols);
  const cardW = Math.round((W - 2 * M - (cols - 1) * gap) / cols);
  const layers: Layer[] = [];
  // Always engine-compose the background. Use the canvas base color (or a dark
  // default — feature_grid reads best on a deep canvas) as the wash base, and
  // when no bg_style was given fall back to a tasteful designed default (glow/
  // sweep + grain) rather than a flat fill — flat reads as a template.
  const base = (typeof bgFill === 'string' ? bgFill : asHex(r['bg'])) ?? (bgHexes[0] ?? '#0A0A0A');
  composeBackground(bgStyle || defaultBgStyle(base), id, X, Y, W, H, { bg: base, accent, text: textColor, palette, image: str(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0).forEach(l => layers.push(l));
  // The heading sits on the CANVAS wash, not on a card — so its colors must
  // contrast `base`, not the theme. A blind model that set a dark bg but left
  // text as the theme's dark $text would otherwise render an INVISIBLE title.
  // And MEASURE the wrapped title so a 2–3 line headline shrinks instead of
  // overflowing its fixed box into the subtitle / cards (the bug the vision
  // loop caught on the Hormuz poster).
  // Structural variant: centred dashboard (default) vs a fully left-anchored
  // editorial grid — seeded from the title so two card posters aren't identical.
  const gAlign = (shStr(r['align'] ?? r['text_align']) as 'left' | 'center') || pickGridLayout(`${str(r['title'])} ${str(r['subtitle'])}`).align;
  const headAlign = gAlign === 'left' ? 'left' : 'center';
  const cardItemsAlign = gAlign === 'left' ? 'flex-start' : 'center';
  const headColor = readableOn(base, textColor);
  const headW = W - 2 * M;
  const headLimit = Y + Math.round(H * 0.39); // cap the header zone (top ~39%)
  let cursorY = Y + Math.round(H * 0.09);
  const title = str(r['title']);
  if (title) {
    let tSizeH = Math.round(W * 0.08);
    let tH = estTextHeight(title, tSizeH, headW, 1.1);
    const maxTH = Math.round(H * 0.22);
    if (tH > maxTH) { tSizeH = Math.max(Math.round(W * 0.045), Math.floor(tSizeH * maxTH / tH)); tH = estTextHeight(title, tSizeH, headW, 1.1); }
    layers.push({ id: `${id}_title`, type: 'text', z: 30, x: X + M, y: cursorY, width: headW, height: tH,
      content: { type: 'plain', value: title }, style: { font_size: tSizeH, font_weight: 800, color: headColor, align: headAlign, line_height: 1.1, font_family: str(r['font'] ?? r['font_family'], m?.font ?? '') || undefined } } as unknown as Layer);
    cursorY += tH + Math.round(H * 0.012);
  }
  const subtitle = str(r['subtitle']);
  if (subtitle && cursorY < headLimit) {
    const sSize = Math.round(W * 0.03);
    const sH = Math.min(estTextHeight(subtitle, sSize, headW, 1.25), Math.max(sSize, headLimit - cursorY));
    layers.push({ id: `${id}_subtitle`, type: 'text', z: 30, opacity: 0.8, x: X + M, y: cursorY, width: headW, height: sH,
      content: { type: 'plain', value: subtitle }, style: { font_size: sSize, color: headColor, align: headAlign, line_height: 1.25 } } as unknown as Layer);
    cursorY += sH;
  }
  // Bottom of the actual header — the cards row is placed BELOW this, sized to its
  // own content and centered in the leftover space, instead of being pinned to a
  // fixed 42% line (which left a dead band under a short header + over-tall cards).
  const headerBottom = cursorY + Math.round(H * 0.04);
  // Scale type + MEASURE wrapped heights so long titles/descs never overflow the
  // card or collide (narrow cards → smaller type). Fixed heights overflowed before.
  const pad = 28, innerW = Math.max(40, cardW - 2 * pad);
  const iconSz = Math.max(40, Math.min(60, Math.round(cardW * 0.3)));
  // Also fit the longest UNBREAKABLE token (wrap only breaks on spaces, so a long
  // word like "Zero-Downtime" can't split) — without this a many-card / narrow
  // layout lets long titles bleed past the card edges (diagnose can't see it).
  const longTok = (key: 'title' | 'desc'): number => Math.max(1, ...items.map(it => Math.max(1, ...String(it[key] ?? '').split(/\s+/).map(t => t.length))));
  const tSize = Math.max(14, Math.floor(Math.min(30, cardW * 0.145, (innerW * 0.98) / (longTok('title') * 0.55))));
  const dSize = Math.max(12, Math.floor(Math.min(21, cardW * 0.1, (innerW * 0.98) / (longTok('desc') * 0.52))));
  // Size the cards to the TALLEST card's content (icon + title + desc + padding +
  // gaps), then center the row in the space below the header — not a fixed 58% of
  // the canvas, which floated the content and left a dead band.
  const cardKidGap = 16;
  // A multi-row grid wants taller (more square) tiles so the dashboard fills the
  // canvas instead of stacking thin strips.
  const minCardH = Math.round(H * (rowsN > 1 ? 0.2 : 0.16));
  const cardContentH = Math.max(minCardH, ...items.map(it => {
    let h = 2 * pad;
    if (it.icon) h += iconSz + cardKidGap;
    if (it.title) h += estTextHeight(it.title, tSize, innerW, 1.15);
    if (it.desc) h += cardKidGap + estTextHeight(it.desc, dSize, innerW, 1.4);
    return h;
  }));
  const availBelow = (Y + H - M) - headerBottom;
  // Fit ALL rows (not just one) in the space below the header.
  const cardH = Math.min(cardContentH, Math.max(minCardH, Math.floor((availBelow - (rowsN - 1) * gap) / rowsN)));
  const gridH = rowsN * cardH + (rowsN - 1) * gap;
  // The grid sits just below the header; the WHOLE composition (header + grid) is
  // then centered vertically as a unit (the shift below), so it never floats mid-
  // canvas with a gap above AND below.
  const rowTop = headerBottom + Math.round(H * 0.02);
  const cards: Layer[] = items.map((it, i) => {
    const kids: Layer[] = [];
    if (it.icon) kids.push({ id: `${id}_c${i}_icon`, type: 'icon', z: 0, x: 0, y: 0, width: iconSz, height: iconSz, name: it.icon, size: iconSz, color: cardIcon } as unknown as Layer);
    if (it.title) kids.push({ id: `${id}_c${i}_title`, type: 'text', z: 1, x: 0, y: 0, width: innerW, height: estTextHeight(it.title, tSize, innerW, 1.15),
      content: { type: 'plain', value: it.title }, style: { font_size: tSize, font_weight: 700, color: cardText, align: headAlign, line_height: 1.15 } } as unknown as Layer);
    if (it.desc) kids.push({ id: `${id}_c${i}_desc`, type: 'text', z: 2, x: 0, y: 0, width: innerW, height: estTextHeight(it.desc, dSize, innerW, 1.4),
      content: { type: 'plain', value: it.desc }, style: { font_size: dSize, color: cardMuted, align: headAlign, line_height: 1.4 } } as unknown as Layer);
    return { id: `${id}_card${i}`, type: 'auto_layout', z: i, x: 0, y: 0, width: cardW, height: cardH, direction: 'column',
      gap: cardKidGap, padding: pad, align_items: cardItemsAlign, justify_content: 'center', radius: 18,
      fill: expandFill(cardFillResolved), layers: kids } as unknown as Layer;
  });
  // Chunk cards into rows of `cols` and stack them in a column container. For a
  // 4-up (2×2) grid this fills a square canvas instead of stringing the cards out
  // as one thin strip. A partial last row centers so it doesn't spread lopsided.
  const rowGroups: Layer[] = [];
  for (let rI = 0; rI < rowsN; rI++) {
    const slice = cards.slice(rI * cols, rI * cols + cols);
    rowGroups.push({ id: `${id}_r${rI}`, type: 'auto_layout', z: rI, x: 0, y: 0, width: W - 2 * M, height: cardH,
      direction: 'row', gap, justify_content: slice.length < cols ? 'center' : 'space-between', align_items: 'stretch', layers: slice } as unknown as Layer);
  }
  layers.push({ id: `${id}_row`, type: 'auto_layout', z: 35, x: X + M, y: rowTop, width: W - 2 * M, height: gridH,
    direction: 'column', gap, align_items: 'stretch', layers: rowGroups } as unknown as Layer);
  // Center the whole composition (header text + card grid) vertically as ONE block —
  // the header was laid from a fixed top, so without this the grid floats in the
  // lower-middle with a gap above and below. Shift the header + grid together.
  const compTop = Y + Math.round(H * 0.09), compBot = rowTop + gridH;
  const shift = Math.round((H - (compBot - compTop)) / 2) - Math.round(H * 0.09);
  if (shift > 0) {
    for (const l of layers) {
      const o = l as unknown as Record<string, unknown>;
      const lid = String(o['id'] ?? '');
      if ((lid === `${id}_title` || lid === `${id}_subtitle` || lid === `${id}_row`) && typeof o['y'] === 'number') {
        o['y'] = (o['y'] as number) + shift;
      }
    }
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// feature_grid's ROWS archetype — full-width editorial rows instead of tiled
// cards. Each feature is a row: a marker (icon, or a numbered badge) in the left
// gutter, the title + description stacked to its right, with a hairline rule
// between rows. A wholly different silhouette from the card grid; the canvas
// sizes to the content. ONE call in, every coordinate owned by the engine.
function buildFeatureRows(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh, 1080, 1080);
  const title = shStr(r['title']);
  const subtitle = shStr(r['subtitle']);
  const rawItems = Array.isArray(r['items']) ? r['items'] : Array.isArray(r['cards']) ? r['cards'] : Array.isArray(r['features']) ? r['features'] : [];
  const items = (rawItems as Record<string, unknown>[]).slice(0, 6).map(it => ({
    icon: shStr(it['icon'] ?? it['symbol']),
    title: shStr(it['title'] ?? it['label'] ?? it['name']),
    desc: shStr(it['desc'] ?? it['description'] ?? it['text'] ?? it['body'] ?? it['benefit']),
  }));
  const m = seededDefaults(r, [title, subtitle, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accentC = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;

  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const content: Layer[] = [];
  let k = 1, cy = Y + Math.round(W * 0.085);
  if (title) {
    const ts = fitTitleSize(title, Math.round(W * 0.07), cW, titleFont), th = estTextHeight(title, ts, cW, 1.05);
    content.push(txt(`${id}_title`, k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: text, line_height: 1.05, letter_spacing: -1, font_family: titleFont }));
    cy += th + Math.round(W * 0.018);
    content.push({ id: `${id}_rule`, type: 'rect', z: k++, x: cX, y: Math.round(cy), width: cW, height: 3, fill: { type: 'solid', color: text } } as unknown as Layer);
    content.push({ id: `${id}_tick`, type: 'rect', z: k++, x: cX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accentC } } as unknown as Layer);
    cy += Math.round(W * 0.03);
  }
  if (subtitle) {
    const ss = Math.round(W * 0.028), s2 = estTextHeight(subtitle, ss, cW, 1.4);
    content.push(txt(`${id}_sub`, k++, cX, cy, cW, s2, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += s2 + Math.round(W * 0.03);
  }
  const gutter = Math.round(W * 0.11), tX = cX + gutter, tW = cW - gutter;
  const iconSz = Math.round(W * 0.058), itSize = Math.round(W * 0.032), dSize = Math.round(W * 0.0215);
  const rowGap = Math.round(W * 0.034);
  items.forEach((it, i) => {
    if (i > 0) { content.push({ id: `${id}_rd${i}`, type: 'rect', z: k++, x: cX, y: Math.round(cy - rowGap * 0.5), width: cW, height: 1.5, fill: { type: 'solid', color: mixHex(bg, text, 0.14) } } as unknown as Layer); }
    const rowTop = cy;
    const tH = estTextHeight(it.title, itSize, tW, 1.15);
    const dH = it.desc ? estTextHeight(it.desc, dSize, tW, 1.4) : 0;
    if (it.icon) content.push({ id: `${id}_ic${i}`, type: 'icon', z: k++, x: cX, y: rowTop, width: iconSz, height: iconSz, name: it.icon, size: iconSz, color: accentC } as unknown as Layer);
    else content.push(txt(`${id}_n${i}`, k++, cX, rowTop - Math.round(itSize * 0.05), gutter, itSize * 1.4, String(i + 1).padStart(2, '0'), { font_size: Math.round(W * 0.04), font_weight: 800, color: accentC, line_height: 1.0, letter_spacing: -1, font_family: titleFont }));
    if (it.title) content.push(txt(`${id}_t${i}`, k++, tX, cy, tW, tH, it.title, { font_size: itSize, font_weight: 700, color: text, line_height: 1.15 }));
    if (it.desc) content.push(txt(`${id}_b${i}`, k++, tX, cy + tH + Math.round(itSize * 0.25), tW, dH, it.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += Math.max(iconSz, tH + (it.desc ? Math.round(itSize * 0.25) + dH : 0)) + rowGap;
  });
  if (items.length) cy -= rowGap;
  const naturalH = Math.min(Math.round(W * 3.4), Math.max(Math.round(W * 0.6), Math.round(cy + W * 0.08 - Y)));
  // Center the rows when the model's box is taller than the content (else short
  // feature lists float at the top over a dead lower half).
  const finalH = H > naturalH + Math.round(W * 0.05) ? H : naturalH;
  const topPad = finalH > naturalH ? Math.round((finalH - naturalH) * 0.42) : 0;
  if (topPad) for (const l of content) { const o = l as unknown as { y: number }; if (typeof o.y === 'number') o.y += topPad; }
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent: accentC, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  content.forEach((l, i) => { (l as unknown as { z: number }).z = 30 + i; });
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...content] } as unknown as Layer;
}

// ── Marble backdrop preset ──────────────────────────────────
// ONE shorthand layer → a full decorative background: soft radial-gradient
// "marble" blobs clustered in the chosen corners (each fades to the canvas
// color at its rim, so text on top stays readable), plus optional veins, rings
// and dots. Collapses the ~15-25 hand-placed shapes models reliably get wrong
// (off-canvas, dropped fills, killed contrast) into a single, balanced intent.

export function buildDecor(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const X = sh.pos?.[0] ?? num(sh.x, 0);
  const Y = sh.pos?.[1] ?? num(sh.y, 0);
  const W = sh.pos?.[2] ?? num(sh.width, 1080);
  const H = sh.pos?.[3] ?? num(sh.height, 1350);
  const bg     = typeof r['bg'] === 'string' ? (r['bg'] as string) : '#F3EEF6';
  const accent = typeof r['accent'] === 'string' ? (r['accent'] as string) : '#6231C9';
  const palRaw = (Array.isArray(r['palette']) ? r['palette'] : []).filter(c => typeof c === 'string') as string[];
  const pal    = palRaw.length ? palRaw : ['#B9C4F0', '#C9B6EC', '#A6DAE8', '#F6CBA6'];
  const corners = (Array.isArray(r['corners']) ? r['corners'] : ['tr', 'bl'])
    .filter(c => ['tl', 'tr', 'bl', 'br'].includes(c as string)) as string[];
  const intensity = Math.max(0.2, Math.min(1, num(r['intensity'], 0.7)));
  const veins = r['veins'] !== false;
  const rings = Math.max(0, Math.round(num(r['rings'], 1)));
  const dots  = Math.max(0, Math.round(num(r['dots'], 1)));
  const style = typeof r['style'] === 'string' ? (r['style'] as string) : 'marble';

  const solid  = (color: string): Fill => ({ type: 'solid', color } as unknown as Fill);
  const radial = (color: string): Fill => ({ type: 'radial', stops: [{ color, position: 0 }, { color: bg, position: 100 }] } as unknown as Fill);
  const layers: Layer[] = [
    { id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: solid(bg) } as unknown as Layer,
  ];

  if (style === 'mesh') {
    // gradient-mesh wash: a few big soft radial gradients spread near the edges
    // (no veins/rings) — a calmer, more abstract backdrop than marble.
    const spots: [number, number][] = [[0.16, 0.12], [0.86, 0.22], [0.26, 0.82], [0.80, 0.84]];
    spots.forEach(([fx, fy], i) => {
      const s = Math.round(W * 0.62);
      layers.push({ id: `${id}_m${i}`, type: 'ellipse', z: i + 1, x: Math.round(X + fx * W - s / 2), y: Math.round(Y + fy * H - s / 2),
        width: s, height: s, fill: radial(pal[i % pal.length]), opacity: +(intensity * 0.5).toFixed(2) } as unknown as Layer);
    });
    return { id, type: 'group', z, x: 0, y: 0, width: W, height: H, layers } as unknown as Layer;
  }

  // style "marble" (default): organic corner clusters + veins/rings/dots.
  // [cornerX, cornerY, inwardX, inwardY] per corner key
  const ANCHOR: Record<string, [number, number, number, number]> = {
    tl: [X, Y, 1, 1], tr: [X + W, Y, -1, 1], bl: [X, Y + H, 1, -1], br: [X + W, Y + H, -1, -1],
  };
  let zc = 1;
  for (const cn of corners) {
    const [ax, ay, dx, dy] = ANCHOR[cn];
    const inset = Math.round(W * 0.05), step = Math.round(W * 0.10), base = Math.round(W * 0.42);
    for (let i = 0; i < 4; i++) {                          // 4 overlapping blobs marching inward
      const s = base - i * Math.round(W * 0.055);
      const cx = ax + dx * (inset + i * step), cy = ay + dy * (inset + i * step);
      layers.push({ id: `${id}_${cn}b${i}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, fill: radial(pal[i % pal.length]), opacity: +(intensity * (0.95 - i * 0.13)).toFixed(2) } as unknown as Layer);
    }
    if (veins) for (let v = 0; v < 2; v++) {               // diagonal veins across the cluster
      layers.push({ id: `${id}_${cn}v${v}`, type: 'line', z: zc++,
        x1: Math.round(ax + dx * Math.round(W * 0.03)), y1: Math.round(ay + dy * Math.round(W * (0.10 + v * 0.16))),
        x2: Math.round(ax + dx * Math.round(W * (0.30 + v * 0.10))), y2: Math.round(ay + dy * Math.round(W * 0.02)),
        stroke: { color: accent, width: 2 }, opacity: +(intensity * 0.3).toFixed(2) } as unknown as Layer);
    }
    for (let k = 0; k < rings; k++) {                      // outline rings
      const s = Math.round(W * (0.36 - k * 0.30)), cx = ax + dx * (inset + Math.round(W * 0.02)), cy = ay + dy * (inset + Math.round(W * 0.02));
      layers.push({ id: `${id}_${cn}r${k}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, stroke: { color: accent, width: 3 }, opacity: +(intensity * 0.5).toFixed(2) } as unknown as Layer);
    }
    for (let d = 0; d < dots; d++) {                       // accent dots (kept inside the corner triangle, off any footer text)
      const s = 18 + d * 14, cx = ax + dx * Math.round(W * (0.13 + d * 0.06)), cy = ay + dy * Math.round(W * (0.13 + d * 0.05));
      layers.push({ id: `${id}_${cn}d${d}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, fill: solid(d % 2 ? pal[0] : accent), opacity: 0.85 } as unknown as Layer);
    }
  }
  return { id, type: 'group', z, x: 0, y: 0, width: W, height: H, layers } as unknown as Layer;
}

// ── Rich background composition ─────────────────────────────
// A blind model can't safely stack a separate decorative layer UNDER a content
// preset (off-canvas, wrong z, killed contrast). So every flow preset takes a
// `bg_style` string and the ENGINE composes a layered, collision-proof
// background BEHIND the content: a base wash (solid/gradient/mesh/marble) +
// optional corner "curved-gradient" sweeps / glow / edge bands + a faint pattern
// texture overlay. Tokens combine with "+": "gradient + dots + curve", "mesh +
// halftone", "marble", "gradient:vert + band". Lives inside the preset group, so
// diagnose (top-level only) can't false-flag the intentionally-soft decor.

export function buildEditorial(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck']);
  const body = shStr(r['body'] ?? r['desc']);
  const footer = shStr(r['footer']);
  // Seed the mood from the essay's own words when the model gave no bg.
  const m = seededDefaults(r, [title, subtitle, body, kicker]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const M = Math.round(W * 0.08);
  const cW = W - 2 * M, cX = X + M;
  // Structural variant (decorrelated from colour) so two editorials don't share
  // the identical kicker+full-rule+left-title silhouette:
  //   'rule'   — full-width hairline under the kicker, left-anchored (the classic)
  //   'tick'   — a short accent TICK (no full line) + a bigger headline, left
  //   'center' — a centered cover masthead (short accent rule, centered type) —
  //              only when the body is short enough to centre-read
  // An explicit align: overrides. All three still emit an `id_rule` layer.
  const explicitAlign = shStr(r['align'] ?? r['text_align']);
  const longBody = body.length > 150;
  const hv = edHashEditorial(`${title} ${kicker} ${subtitle}`);
  let style: 'rule' | 'tick' | 'center';
  if (explicitAlign === 'center') style = longBody ? 'rule' : 'center';
  else if (explicitAlign === 'left') style = hv % 2 ? 'tick' : 'rule';
  else { const p = hv % 20; style = p < 9 ? 'rule' : p < 15 ? 'tick' : (longBody ? 'rule' : 'center'); }
  const center = style === 'center';
  const halign = center ? { align: 'center' as const } : {};
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  let cy = Y + Math.round(H * (center ? 0.16 : 0.13)), k = layers.length;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase', ...halign }));
    cy += Math.round(H * 0.035);
  }
  if (style === 'rule') {
    layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: cW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
    cy += Math.round(H * 0.025);
  } else if (style === 'tick') {
    layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: Math.round(W * 0.12), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    cy += Math.round(H * 0.02);
  } else {
    const rw = Math.round(W * 0.16);
    layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX + Math.round((cW - rw) / 2), y: Math.round(cy), width: rw, height: 5, fill: { type: 'solid', color: accent } } as unknown as Layer);
    cy += Math.round(H * 0.028);
  }
  if (title) {
    const edFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
    const titleScale = style === 'rule' ? 0.085 : 0.097;
    const ts = fitTitleSize(title, Math.round(W * titleScale), cW, edFont), th = estTextHeight(title, ts, cW, 1.04);
    layers.push(txt(`${id}_title`, z + k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04, font_family: edFont, ...halign }));
    cy += th + Math.round(H * 0.025);
  }
  if (subtitle) {
    const ss = Math.round(W * 0.032), sh2 = estTextHeight(subtitle, ss, cW, 1.35);
    layers.push(txt(`${id}_sub`, z + k++, cX, cy, cW, sh2, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.35, ...halign }));
    cy += sh2 + Math.round(H * 0.025);
  }
  if (body) {
    const bs = Math.round(W * 0.022), bh = estTextHeight(body, bs, cW, 1.55);
    layers.push(txt(`${id}_body`, z + k++, cX, cy, cW, bh, body, { font_size: bs, font_weight: 400, color: textColor, line_height: 1.55, ...halign }));
  }
  if (footer) {
    const fy = Y + H - Math.round(H * 0.09);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: cW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(footerLayer(`${id}_footer`, z + k++, cX, fy + 16, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }, r));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Two-panel editorial split — a color/pattern block on one side, kicker + big
// headline + deck vertically centered on the other. ratio = panel fraction
// (number, or "golden" = 0.382). The engine owns every coordinate.

export function buildSplit(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh, 1080, 1080);
  const side = shStr(r['side'], 'left') === 'right' ? 'right' : 'left';
  let ratio = typeof r['ratio'] === 'number' ? r['ratio'] : (r['ratio'] === 'golden' ? 0.382 : 0.5);
  ratio = Math.max(0.25, Math.min(0.7, ratio));
  const bg = shStr(r['bg'], '#FAF5EC');
  const accent = shStr(r['accent'], '#B8543C');
  const panelFill = r['panel'] ?? r['panel_fill'] ?? accent;
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'], r['muted']);
  const panelText = shStr(r['panel_text'], '#FAF5EC');
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck'] ?? r['body']);
  const panelLabel = shStr(r['panel_label'] ?? r['big']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment']);
  const palette = (Array.isArray(r['palette']) ? r['palette'] : []).filter((c): c is string => typeof c === 'string');

  const PW = Math.round(W * ratio);
  const panelX = side === 'left' ? X : X + W - PW;
  const contentX = side === 'left' ? X + PW : X;
  const Mcol = Math.round((W - PW) * 0.1);
  const cW = (W - PW) - 2 * Mcol, cX = contentX + Mcol;

  // Full-canvas background (rich engine-composed when bg_style is set), then the
  // opaque panel covers its side and the content reads over the other side.
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  const panelZ = layers.length;
  layers.push({ id: `${id}_panel`, type: 'rect', z: panelZ, x: panelX, y: Y, width: PW, height: H, fill: expandFill(panelFill as string | Fill) } as unknown as Layer);
  let k = panelZ + 1;
  if (panelLabel) {
    layers.push(txt(`${id}_plabel`, k++, panelX, Y + H / 2 - Math.round(PW * 0.18), PW, Math.round(PW * 0.4), panelLabel, { font_size: Math.round(PW * 0.28), font_weight: 800, color: panelText, align: 'center', line_height: 1.0 }));
  }
  // Measure the content block, then vertically center it.
  const ts = Math.round(cW * 0.16), ss = Math.round(cW * 0.058);
  const titleH = title ? estTextHeight(title, ts, cW, 1.05) : 0;
  const subH = subtitle ? estTextHeight(subtitle, ss, cW, 1.4) : 0;
  const kickH = kicker ? Math.round(H * 0.05) : 0;
  const total = kickH + (title ? titleH + Math.round(H * 0.02) : 0) + subH;
  let cy = Y + Math.max(Math.round(H * 0.12), (H - total) / 2);
  if (kicker) {
    layers.push(txt(`${id}_kick`, k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(cW * 0.04), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += kickH;
  }
  if (title) {
    layers.push(txt(`${id}_title`, k++, cX, cy, cW, titleH, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.05 }));
    cy += titleH + Math.round(H * 0.02);
  }
  if (subtitle) {
    layers.push(txt(`${id}_sub`, k++, cX, cy, cW, subH, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.4 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Numbered / stepped LIST — the most common poster structure ("5 tips", "3
// steps", "7 reasons") and the one with no other preset. Engine MEASURES every
// item's wrapped title + description and stacks them with a distributed rhythm
// (slack spread between items, never a dead bottom), an accent marker in the
// left gutter, a held margin, and an auto-sized headline. Removes the hand-
// placed-list failure mode (overflow + collision) entirely. ONE layer in.
