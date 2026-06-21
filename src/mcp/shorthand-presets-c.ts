// Folio shorthand parser — STRUCTURAL preset builders that render an intent true
// to its own shape instead of collapsing onto the generic card grid:
//   timeline — a connected chronological SPINE (line + nodes), not dot-topped cards
//   pricing  — tier COLUMNS with a featured tier + price hierarchy + feature checks
//   versus   — a true two-column SPLIT with a VS divider + per-attribute rows
// Each owns every coordinate (a vision-less model supplies only content + colors),
// composes a real background, and content-sizes the canvas like the other presets.
import type { Layer } from '../schema/types';

import { hexToRgb, luminance } from './engine/reference';
import {
  shStr, asHex, mixHex, readableOn, readablePair, seededDefaults, ShorthandLayer,
  defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt, footerLayer,
} from './shorthand-helpers';
import { composeBackground } from './shorthand-background';

// ── Shared content readers ──────────────────────────────────
interface Plan { name: string; price: string; period: string; features: string[]; featured: boolean; cta: string }
function readPlans(v: unknown): Plan[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const feats = o['features'] ?? o['perks'] ?? o['includes'] ?? o['items'] ?? o['lines'];
    return {
      name: shStr(o['name'] ?? o['title'] ?? o['tier'] ?? o['label'] ?? o['plan']),
      price: shStr(o['price'] ?? o['cost'] ?? o['amount'] ?? o['value']),
      period: shStr(o['period'] ?? o['per'] ?? o['interval'] ?? o['cycle']),
      features: (Array.isArray(feats) ? feats : []).map((f) => {
        if (typeof f === 'string') return f;
        const fo = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
        return shStr(fo['text'] ?? fo['title'] ?? fo['label'] ?? fo['name']);
      }).filter(Boolean),
      featured: o['featured'] === true || o['popular'] === true || o['highlight'] === true || o['recommended'] === true,
      cta: shStr(o['cta'] ?? o['button'] ?? o['action']),
    };
  }).filter((p) => p.name || p.price);
}

// Vertically center a content-sized composition when the model's box is TALLER
// than the measured content — so a short timeline/pricing/versus fills the canvas
// instead of floating at the top over a dead lower half. Shifts every layer's y
// in place and returns the height to compose the background at.
function fitTall(layers: Layer[], naturalH: number, boxH: number, W: number): number {
  if (!(boxH > naturalH + Math.round(W * 0.05))) return naturalH;
  const topPad = Math.round((boxH - naturalH) * 0.42);
  for (const l of layers) { const o = l as unknown as { y: number }; if (typeof o.y === 'number') o.y += topPad; }
  return boxH;
}

// ── pricing ─────────────────────────────────────────────────
// Tier COLUMNS side by side, each with a name, a heroed price, a period and a
// checked feature list — and ONE featured tier lifted taller with an accent fill
// + "MOST POPULAR" ribbon. The price hierarchy + featured emphasis + checklists
// are the silhouette a pricing table has and a generic centered card grid loses.
export function buildPricing(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline']);
  const subtitle = shStr(r['subtitle'] ?? r['deck'] ?? r['intro']);
  const footer = shStr(r['footer']);
  const plans = readPlans(r['plans'] ?? r['tiers'] ?? r['items'] ?? r['cards'] ?? r['options']).slice(0, 4);
  const m = seededDefaults(r, [title, subtitle, kicker, plans.map(p => p.name).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const N = Math.max(1, plans.length);
  // No plan flagged featured → hero the middle one (the conventional emphasis).
  if (plans.length && !plans.some(p => p.featured)) { const mid = plans[Math.floor((N - 1) / 2)]; if (mid) mid.featured = true; }

  const bgDark = ((): boolean => { const rgb = hexToRgb(asHex(bg) ?? '#FAF5EC'); return rgb ? luminance(rgb) < 0.5 : true; })();
  const cardSurface = mixHex(bg, bgDark ? '#FFFFFF' : '#101012', bgDark ? 0.09 : 0.04);
  const cardBorder = mixHex(bg, text, 0.16);
  const onAccent = readableOn(accent, bg);

  const M = Math.round(W * 0.065), cX = X + M, cW = W - 2 * M;
  // Center the header — a pricing masthead reads centered above the columns.
  const layers: Layer[] = [];
  let k = 1, cy = Y + Math.round(W * 0.075);
  if (kicker) { layers.push(txt(`${id}_kick`, k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 2, text_transform: 'uppercase', align: 'center' })); cy += Math.round(W * 0.042); }
  if (title) { const ts = fitTitleSize(title, Math.round(W * 0.062), cW, titleFont), th = estTextHeight(title, ts, cW, 1.06, 0.56); layers.push(txt(`${id}_title`, k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: text, line_height: 1.06, letter_spacing: -1, align: 'center', font_family: titleFont })); cy += th + Math.round(W * 0.015); }
  if (subtitle) { const ss = Math.round(W * 0.026), s2 = estTextHeight(subtitle, ss, cW, 1.4); layers.push(txt(`${id}_sub`, k++, cX, cy, cW, s2, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.4, align: 'center' })); cy += s2; }
  const headerBottom = cy + Math.round(W * 0.05);

  const gap = Math.round(W * 0.026);
  const colW = Math.round((cW - (N - 1) * gap) / N);
  const pad = Math.round(colW * 0.085);
  const innerW = colW - 2 * pad;
  const nameSize = Math.round(W * 0.026), priceSize = Math.min(Math.round(W * 0.058), Math.round(colW * 0.3)), perSize = Math.round(W * 0.017), featSize = Math.max(13, Math.round(W * 0.0185));
  const checkSz = Math.round(featSize * 1.15), featGap = Math.round(W * 0.018), featTextW = innerW - checkSz - Math.round(W * 0.012);
  // Tallest column drives a shared card height (price block + every feature row).
  const colContentH = (p: Plan): number => {
    let h = pad + estTextHeight(p.name, nameSize, innerW, 1.1) + Math.round(W * 0.02) + priceSize + Math.round(W * 0.03) + Math.round(W * 0.024);
    for (const f of p.features) h += Math.max(checkSz, estTextHeight(f, featSize, featTextW, 1.3)) + featGap;
    return h + pad;
  };
  const baseH = Math.max(Math.round(W * 0.4), ...plans.map(colContentH));
  const lift = Math.round(W * 0.022);

  plans.forEach((p, i) => {
    const colX = cX + i * (colW + gap);
    const feat = p.featured;
    const cardTop = headerBottom - (feat ? lift : 0);
    const cardH = baseH + (feat ? 2 * lift : 0);
    const cardFill = feat ? accent : cardSurface;
    const tCol = feat ? onAccent : text;
    const mCol = feat ? mixHex(accent, onAccent, 0.7) : muted;
    const checkCol = feat ? onAccent : accent;
    layers.push({ id: `${id}_c${i}`, type: 'rect', z: z + k++, x: colX, y: cardTop, width: colW, height: cardH, radius: Math.round(W * 0.018), fill: { type: 'solid', color: cardFill }, ...(feat ? {} : { stroke: { color: cardBorder, width: 1.5 } }) } as unknown as Layer);
    let yy = cardTop + pad;
    if (feat) { layers.push(txt(`${id}_pop${i}`, z + k++, colX + pad, yy, innerW, 24, 'MOST POPULAR', { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.015), font_weight: 700, color: onAccent, letter_spacing: 2, text_transform: 'uppercase' })); yy += Math.round(W * 0.03); }
    const nameH = estTextHeight(p.name, nameSize, innerW, 1.1);
    layers.push(txt(`${id}_nm${i}`, z + k++, colX + pad, yy, innerW, nameH, p.name, { font_size: nameSize, font_weight: 700, color: tCol, line_height: 1.1 })); yy += nameH + Math.round(W * 0.02);
    if (p.price) { layers.push(txt(`${id}_pr${i}`, z + k++, colX + pad, yy, innerW, priceSize * 1.1, p.price, { font_size: priceSize, font_weight: 800, color: feat ? onAccent : accent, line_height: 1.0, letter_spacing: -1, font_family: titleFont })); yy += priceSize + Math.round(W * 0.008); }
    if (p.period) { layers.push(txt(`${id}_pe${i}`, z + k++, colX + pad, yy, innerW, perSize * 1.4, p.period, { font_size: perSize, font_weight: 500, color: mCol, line_height: 1.2 })); yy += Math.round(perSize * 1.4); }
    yy += Math.round(W * 0.018);
    layers.push({ id: `${id}_dv${i}`, type: 'rect', z: z + k++, x: colX + pad, y: yy, width: innerW, height: 1.5, fill: { type: 'solid', color: feat ? mixHex(accent, onAccent, 0.4) : cardBorder } } as unknown as Layer); yy += Math.round(W * 0.024);
    p.features.forEach((f, fi) => {
      const fh = Math.max(checkSz, estTextHeight(f, featSize, featTextW, 1.3));
      layers.push({ id: `${id}_ck${i}_${fi}`, type: 'icon', z: z + k++, x: colX + pad, y: yy + Math.round((fh - checkSz) / 2), width: checkSz, height: checkSz, name: 'check', size: checkSz, color: checkCol } as unknown as Layer);
      layers.push(txt(`${id}_ft${i}_${fi}`, z + k++, colX + pad + checkSz + Math.round(W * 0.012), yy, featTextW, fh, f, { font_size: featSize, font_weight: 400, color: tCol, line_height: 1.3 }));
      yy += fh + featGap;
    });
  });

  const contentBottom = headerBottom + baseH + lift;
  let footH = 0;
  if (footer) { layers.push(footerLayer(`${id}_footer`, z + k++, cX, contentBottom + Math.round(W * 0.045), cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1, align: 'center' }, r)); footH = Math.round(W * 0.07); }
  const naturalH = Math.max(Math.round(W * 0.9), Math.round(contentBottom + footH + W * 0.05 - Y));
  const finalH = fitTall(layers, naturalH, H, W);
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  layers.forEach((l) => { const lz = l as unknown as { z: number }; lz.z = lz.z + bgLayers.length; });
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}

// ── versus ──────────────────────────────────────────────────
// A true two-column SPLIT: A and B headers either side of a center divider with
// a "VS" medallion, then per-attribute rows (aspect label centered, A value in
// the left column, B value in the right). A comparison rendered as a comparison
// — the left/right opposition a card grid flattens away.
interface Side { label: string; points: string[] }
function readSide(v: unknown, d: string): Side {
  if (typeof v === 'string') return { label: v, points: [] };
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pts = o['points'] ?? o['items'] ?? o['features'] ?? o['pros'] ?? o['list'];
  return {
    label: shStr(o['label'] ?? o['name'] ?? o['title'] ?? o['heading'], d),
    points: (Array.isArray(pts) ? pts : []).map(p => (typeof p === 'string' ? p : shStr((p as Record<string, unknown>)['text'] ?? (p as Record<string, unknown>)['title']))).filter(Boolean),
  };
}
interface VRow { label: string; a: string; b: string }
function readVRows(v: unknown): VRow[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return { label: shStr(o['label'] ?? o['aspect'] ?? o['title'] ?? o['name'] ?? o['criterion']), a: shStr(o['a'] ?? o['left'] ?? o['first']), b: shStr(o['b'] ?? o['right'] ?? o['second']) };
  }).filter((r) => r.label || r.a || r.b);
}

export function buildVersus(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline']);
  const footer = shStr(r['footer']);
  const A = readSide(r['a'] ?? r['left'] ?? r['option_a'] ?? r['first'], 'A');
  const B = readSide(r['b'] ?? r['right'] ?? r['option_b'] ?? r['second'], 'B');
  const rows = readVRows(r['rows'] ?? r['aspects'] ?? r['comparison'] ?? r['criteria']);
  const m = seededDefaults(r, [title, kicker, A.label, B.label, rows.map(x => x.label).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const colorA = accent;
  const colorB = palette.find(c => c !== accent && asHex(c) && contrastOK(c, bg)) ?? mixHex(text, bg, 0.05);

  const M = Math.round(W * 0.06), cX = X + M, cW = W - 2 * M, midX = X + Math.round(W / 2);
  const colInset = Math.round(W * 0.045);
  const aX = cX, aW = midX - cX - colInset;            // left column box
  const bX = midX + colInset, bW = X + W - M - bX;     // right column box
  const layers: Layer[] = [];
  let k = 1, cy = Y + Math.round(W * 0.08);
  if (kicker) { layers.push(txt(`${id}_kick`, k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 2, text_transform: 'uppercase', align: 'center' })); cy += Math.round(W * 0.04); }
  if (title) { const ts = fitTitleSize(title, Math.round(W * 0.058), cW, titleFont), th = estTextHeight(title, ts, cW, 1.06, 0.56); layers.push(txt(`${id}_title`, k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: text, line_height: 1.06, letter_spacing: -1, align: 'center', font_family: titleFont })); cy += th + Math.round(W * 0.035); }

  // A / B headers either side, big and colored.
  const lblSize = Math.min(Math.round(W * 0.062), Math.round(aW * 0.42));
  const aLblH = estTextHeight(A.label, lblSize, aW, 1.05, 0.56), bLblH = estTextHeight(B.label, lblSize, bW, 1.05, 0.56);
  const lblH = Math.max(aLblH, bLblH);
  layers.push(txt(`${id}_al`, k++, aX, cy, aW, lblH, A.label, { font_size: lblSize, font_weight: 800, color: colorA, line_height: 1.05, align: 'center', font_family: titleFont }));
  layers.push(txt(`${id}_bl`, k++, bX, cy, bW, lblH, B.label, { font_size: lblSize, font_weight: 800, color: colorB, line_height: 1.05, align: 'center', font_family: titleFont }));
  // VS medallion centered on the divide, vertically at the label row.
  const badge = Math.round(W * 0.085), badgeY = cy + Math.round(lblH / 2) - Math.round(badge / 2);
  const rowsTop = cy + lblH + Math.round(W * 0.04);
  cy = rowsTop;

  // Per-attribute rows: aspect label centered, A value left, B value right, divider between.
  const aspSize = Math.round(W * 0.018), valSize = Math.round(W * 0.023);
  if (rows.length) {
    rows.forEach((row, i) => {
      const aH = estTextHeight(row.a, valSize, aW, 1.3), bH = estTextHeight(row.b, valSize, bW, 1.3);
      const labH = row.label ? estTextHeight(row.label, aspSize, cW, 1.2) + Math.round(W * 0.01) : 0;
      const rowH = labH + Math.max(aH, bH);
      if (row.label) layers.push(txt(`${id}_rl${i}`, k++, cX, cy, cW, labH, row.label, { font_family: 'IBM Plex Mono', font_size: aspSize, font_weight: 600, color: muted, letter_spacing: 1.5, text_transform: 'uppercase', align: 'center' }));
      if (row.a) layers.push(txt(`${id}_ra${i}`, k++, aX, cy + labH, aW, aH, row.a, { font_size: valSize, font_weight: 500, color: text, line_height: 1.3, align: 'center' }));
      if (row.b) layers.push(txt(`${id}_rb${i}`, k++, bX, cy + labH, bW, bH, row.b, { font_size: valSize, font_weight: 500, color: text, line_height: 1.3, align: 'center' }));
      cy += rowH + Math.round(W * 0.028);
      if (i < rows.length - 1) layers.push({ id: `${id}_rd${i}`, type: 'rect', z: k++, x: cX, y: Math.round(cy - W * 0.014), width: cW, height: 1.5, fill: { type: 'solid', color: mixHex(bg, text, 0.14) } } as unknown as Layer);
    });
  } else {
    // No structured rows → two bulleted point columns under the headers.
    const bulletCol = (pts: string[], bxX: number, bxW: number, col: string, tag: string): void => {
      let yy = rowsTop;
      pts.forEach((p, i) => {
        const ph = estTextHeight(p, valSize, bxW - Math.round(W * 0.03), 1.35);
        layers.push({ id: `${id}_${tag}d${i}`, type: 'ellipse', z: k++, x: bxX, y: yy + Math.round(valSize * 0.4), width: Math.round(W * 0.014), height: Math.round(W * 0.014), fill: { type: 'solid', color: col } } as unknown as Layer);
        layers.push(txt(`${id}_${tag}t${i}`, k++, bxX + Math.round(W * 0.03), yy, bxW - Math.round(W * 0.03), ph, p, { font_size: valSize, font_weight: 400, color: text, line_height: 1.35 }));
        yy += ph + Math.round(W * 0.022);
      });
      cy = Math.max(cy, yy);
    };
    bulletCol(A.points, aX, aW, colorA, 'a');
    bulletCol(B.points, bX, bW, colorB, 'b');
  }
  const rowsBottom = cy;
  // Center divider behind the rows + the VS medallion on top.
  layers.unshift({ id: `${id}_divider`, type: 'rect', z: 0, x: midX - 1, y: rowsTop, width: 2, height: Math.max(4, rowsBottom - rowsTop - Math.round(W * 0.02)), fill: { type: 'solid', color: mixHex(bg, text, 0.18) } } as unknown as Layer);
  layers.push({ id: `${id}_badge`, type: 'ellipse', z: k++, x: midX - Math.round(badge / 2), y: badgeY, width: badge, height: badge, fill: { type: 'solid', color: accent } } as unknown as Layer);
  layers.push(txt(`${id}_vs`, k++, midX - Math.round(badge / 2), badgeY + Math.round(badge * 0.27), badge, Math.round(badge * 0.5), 'VS', { font_size: Math.round(badge * 0.38), font_weight: 800, color: readableOn(accent, bg), align: 'center', letter_spacing: 1 }));

  if (footer) { cy += Math.round(W * 0.05); layers.push(footerLayer(`${id}_footer`, k++, cX, cy, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1, align: 'center' }, r)); cy += 30; }
  const naturalH = Math.max(Math.round(W * 0.8), Math.round(cy + W * 0.06 - Y));
  const finalH = fitTall(layers, naturalH, H, W);
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  layers.forEach((l) => { const lz = l as unknown as { z: number }; lz.z = lz.z + bgLayers.length; });
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}

// Two colors must be distinguishable AND legible on the canvas for the A/B sides.
function contrastOK(c: string, bg: string): boolean {
  const rc = hexToRgb(asHex(c) ?? ''), rb = hexToRgb(asHex(bg) ?? '#FAF5EC');
  if (!rc || !rb) return false;
  const lc = luminance(rc), lb = luminance(rb);
  return (Math.max(lc, lb) + 0.05) / (Math.min(lc, lb) + 0.05) >= 2.2;
}
