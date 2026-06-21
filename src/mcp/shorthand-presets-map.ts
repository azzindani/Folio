// Mind-map / brainstorm preset. Two silhouettes from the reference set:
//   chain  — a staggered column of title-pill CARDS, each linked to the next by a
//            dashed curved arrow (the "Blue/White" + "Pink/Brown" mind maps)
//   spokes — a center HUB with cards flanking it above + below, each joined to the
//            hub by a curved connector (the radial "Yellow Colorful" brainstorm)
// The model supplies topic + nodes + colors; the engine measures every card, places
// the connectors, and fits the canvas. §0.4 — math is ours, look is the model's.
import type { Layer } from '../schema/types';
import {
  shStr, mixHex, readableOn, readablePair, seededDefaults, ShorthandLayer,
  defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt,
} from './shorthand-helpers';
import { composeBackground } from './shorthand-background';
import { readSeqItems, nodeColors, lum, type SeqItem } from './shorthand-presets-seq';
import { scatterLayers, type KeepOut } from './shorthand-doodles';

interface MapCtx {
  bg: string; surface: string; text: string; muted: string;
  colors: string[]; titleFont?: string; W: number;
}

// Measured geometry of a card, shared by the placer and the layout planner so a
// card's height is known before it is positioned (lets the planner distribute slack).
interface CardGeom { padX: number; padY: number; inner: number; pillFont: number; bodyFont: number; headH: number; titleH: number; bodyH: number; h: number }
function measureCard(it: SeqItem, w: number, c: MapCtx): CardGeom {
  const padX = Math.round(c.W * 0.022), padY = Math.round(c.W * 0.02);
  const inner = w - 2 * padX;
  const pillFont = Math.max(15, Math.round(c.W * 0.026));
  const bodyFont = Math.max(12, Math.round(c.W * 0.0185));
  const pillH = Math.round(pillFont * 1.55);
  const titleH = it.title ? estTextHeight(it.title, pillFont, inner - padX, 1.05) : 0;
  const headH = it.title ? Math.max(pillH, titleH + Math.round(pillFont * 0.5)) : 0;
  const bodyH = it.desc ? estTextHeight(it.desc, bodyFont, inner, 1.4) : 0;
  const h = padY + headH + (it.desc ? Math.round(c.W * 0.012) + bodyH : 0) + padY;
  return { padX, padY, inner, pillFont, bodyFont, headH, titleH, bodyH, h };
}

// A title-pill card: soft drop-shadow, rounded surface, a colored title band, body
// copy below. Returns the measured card height so the caller can flow / stack it.
function card(layers: Layer[], id: string, i: number, x: number, y: number, w: number,
  it: SeqItem, c: MapCtx, zBase: number): number {
  const { padX, padY, inner, pillFont, bodyFont, headH, titleH, bodyH, h } = measureCard(it, w, c);
  // A pale palette colour can match the light card surface → the pill vanishes.
  // Deepen it until the band reads against the card.
  let node = c.colors[i % c.colors.length];
  if (Math.abs(lum(node) - lum(c.surface)) < 0.2) node = mixHex(node, lum(c.surface) > 0.5 ? '#15110D' : '#FFFFFF', 0.42);

  layers.push({ id: `${id}_sh${i}`, type: 'rect', z: zBase, x: x + 5, y: y + 7, width: w, height: h,
    radius: 16, fill: { type: 'solid', color: mixHex(c.bg, '#000000', 0.16) } } as unknown as Layer);
  layers.push({ id: `${id}_cd${i}`, type: 'rect', z: zBase + 1, x, y, width: w, height: h,
    radius: 16, fill: { type: 'solid', color: c.surface }, stroke: mixHex(node, c.surface, 0.35), stroke_width: 2 } as unknown as Layer);

  if (it.title) {
    const pillW = Math.min(inner, Math.round(it.title.length * pillFont * 0.62) + padX * 2);
    layers.push({ id: `${id}_pl${i}`, type: 'rect', z: zBase + 2, x: x + padX, y: y + padY, width: pillW, height: headH,
      radius: 9, fill: { type: 'solid', color: node } } as unknown as Layer);
    layers.push(txt(`${id}_tt${i}`, zBase + 3, x + padX + Math.round(padX * 0.6), y + padY + Math.round((headH - titleH) / 2),
      pillW - padX, titleH + 4, it.title, { font_size: pillFont, font_weight: 800, color: readableOn(node, '#FFFFFF'),
        line_height: 1.05, font_family: c.titleFont }));
  }
  if (it.desc) {
    layers.push(txt(`${id}_bd${i}`, zBase + 2, x + padX, y + padY + headH + Math.round(c.W * 0.012), inner, bodyH,
      it.desc, { font_size: bodyFont, font_weight: 400, color: c.text, line_height: 1.4 }));
  }
  return h;
}

// Dashed curved arrow between two points (uses the connector primitive).
function link(layers: Layer[], id: string, i: number, from: [number, number], to: [number, number], color: string, curve: 'arc' | 's'): void {
  layers.push({ id: `${id}_ln${i}`, type: 'connector', z: 12, from, to, curve,
    bend: 0.28, arrow: 'end', dashed: true, stroke: color, stroke_width: 3, arrow_size: 16 } as unknown as Layer);
}

function mapLayout(sh: Record<string, unknown>, n: number, seed: number): 'chain' | 'spokes' {
  const v = shStr(sh['layout'] ?? sh['variant'] ?? sh['style']).toLowerCase();
  if (/spoke|radial|hub|center|web|star/.test(v)) return 'spokes';
  if (/chain|stagger|zig|column|list|flow/.test(v)) return 'chain';
  // radial reads best at 4–6 evenly-splittable nodes; else the robust chain
  return n >= 4 && n <= 6 ? (seed % 2 === 0 ? 'spokes' : 'chain') : 'chain';
}

export function buildMindmap(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const title = shStr(r['title'] ?? r['topic'] ?? r['headline'] ?? r['center']);
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['subtitle']);
  const items = readSeqItems(r['items'] ?? r['nodes'] ?? r['branches'] ?? r['ideas'] ?? r['cards'] ?? r['topics']);
  const m = seededDefaults(r, [title, kicker, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const seed = Math.abs([...(title + items.map(i => i.title).join())].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 11));
  const layout = mapLayout(r, items.length, seed);
  const colors = nodeColors(accent, palette, Math.max(items.length, 1), bg, seed % 8);
  // Card surface: a near-white tint of the bg so cards read as paper on the canvas.
  const surface = lum(bg) > 0.5 ? mixHex(bg, '#FFFFFF', 0.55) : mixHex(bg, '#FFFFFF', 0.92);
  // Body copy sits ON the card surface, NOT the canvas — colour it for the surface
  // (a dark canvas with light cards needs dark body text, not the bg-readable light).
  const cardText = readableOn(surface, '#1A1A1A') === '#FFFFFF' ? mixHex(surface, '#FFFFFF', 0.85) : mixHex(surface, '#15110D', 0.82);
  const ctx: MapCtx = { bg, surface, text: cardText, muted, colors, titleFont, W };

  const layers: Layer[] = [];
  const finalH = layout === 'spokes'
    ? buildSpokes(layers, id, { X, Y, W, H }, title, kicker, accent, text, muted, ctx, items)
    : buildChain(layers, id, { X, Y, W, H }, title, kicker, accent, text, muted, ctx, items);

  // Margin doodles — the reference mind maps all carry seeded confetti in the empty
  // gutters. On by default (set doodles:false to drop them); kept clear of every
  // card / hub / title via keep-out, behind the content, and seed-varied per design.
  const wantDoodles = r['doodles'] !== false && r['doodle'] !== false && shStr(r['doodles']) !== 'off';
  if (wantDoodles) {
    const keepOut: KeepOut[] = [];
    for (const l of layers) {
      const o = l as unknown as { id: string; type: string; x?: number; y?: number; width?: number; height?: number };
      if ((o.type === 'rect' || o.type === 'text') && /_(cd|hub|hubt|pl|title|kick|bd|tt)\d*$/.test(o.id)
        && typeof o.x === 'number' && typeof o.width === 'number') {
        keepOut.push({ x: o.x, y: o.y ?? 0, w: o.width, h: typeof o.height === 'number' ? o.height : 0 });
      }
    }
    const dColors = colors.map(c => mixHex(c, bg, 0.05));
    layers.unshift(...scatterLayers({ X, Y, W, H: finalH }, {
      count: layout === 'spokes' ? 9 : 13, colors: dColors, idp: `${id}_doo`, z0: 4, seed: seed * 7 + 3,
      sizeMin: Math.round(W * 0.022), sizeMax: Math.round(W * 0.05), sw: Math.max(2, Math.round(W * 0.006)),
      keepOut, opacity: 0.9,
    }));
  }

  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH,
    { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo']) }, 0);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}

interface Box { X: number; Y: number; W: number; H: number }

// A bold display headline, optionally over a small kicker. Returns its bottom Y.
function header(layers: Layer[], id: string, b: Box, title: string, kicker: string,
  accent: string, muted: string, ctx: MapCtx, center: boolean): number {
  const M = Math.round(b.W * 0.06);
  let cy = b.Y + Math.round(b.W * 0.05);
  const titleColor = Math.abs(lum(accent) - lum(ctx.bg)) < 0.25
    ? mixHex(accent, lum(ctx.bg) > 0.5 ? '#111111' : '#FFFFFF', 0.4) : accent;
  if (kicker) {
    layers.push(txt(`${id}_kick`, 8, b.X + M, cy, b.W - 2 * M, 32, kicker, { font_family: 'IBM Plex Mono',
      font_size: Math.round(b.W * 0.02), font_weight: 600, color: muted, letter_spacing: 2, text_transform: 'uppercase',
      align: center ? 'center' : 'left' }));
    cy += Math.round(b.W * 0.045);
  }
  if (title) {
    const isCaps = title.length > 2 && title === title.toUpperCase() && /[A-Z]/.test(title);
    const ts = fitTitleSize(title, Math.round(b.W * 0.085), b.W - 2 * M, ctx.titleFont, isCaps);
    const th = estTextHeight(title, ts, b.W - 2 * M, 1.04, isCaps ? 0.6 : 0.54);
    layers.push(txt(`${id}_title`, 9, b.X + M, cy, b.W - 2 * M, th + 6, title, { font_size: ts, font_weight: 800,
      color: titleColor, line_height: 1.02, letter_spacing: -0.5, font_family: ctx.titleFont, align: center ? 'center' : 'left' }));
    cy += th + Math.round(b.W * 0.03);
  }
  return cy;
}

function buildChain(layers: Layer[], id: string, b: Box, title: string, kicker: string,
  accent: string, text: string, muted: string, ctx: MapCtx, items: SeqItem[]): number {
  void text; void muted;
  const M = Math.round(b.W * 0.06);
  const top = header(layers, id, b, title, kicker, accent, muted, ctx, false);
  const cardW = Math.round((b.W - 2 * M) * 0.64);
  const vGap = Math.round(b.W * 0.05);

  // Plan: measure every card, then distribute any canvas slack into the gaps so the
  // chain fills a tall A4 instead of bunching at the top.
  const geoms = items.map(it => measureCard(it, cardW, ctx));
  const natural = geoms.reduce((a, g) => a + g.h, 0) + vGap * Math.max(0, items.length - 1);
  const slack = Math.max(0, b.H - (top - b.Y) - natural - Math.round(b.W * 0.06));
  const extra = items.length > 1 ? slack / (items.length - 1) : 0;

  const boxes: { x: number; y: number; w: number; h: number; left: boolean }[] = [];
  let cy = top;
  items.forEach((it, i) => {
    const left = i % 2 === 0;
    const x = left ? b.X + M : b.X + b.W - M - cardW;
    card(layers, id, i, x, cy, cardW, it, ctx, 20 + i * 5);
    boxes.push({ x, y: cy, w: cardW, h: geoms[i].h, left });
    cy += geoms[i].h + vGap + extra;
  });

  // Dashed curved arrows linking each card to the next, kept in the central gutter.
  for (let i = 0; i < boxes.length - 1; i++) {
    const A = boxes[i], B = boxes[i + 1];
    const ax = A.left ? A.x + A.w * 0.72 : A.x + A.w * 0.28;
    const bx = B.left ? B.x + B.w * 0.72 : B.x + B.w * 0.28;
    link(layers, id, i, [ax, A.y + A.h], [bx, B.y], mixHex(ctx.colors[i % ctx.colors.length], ctx.text, 0.15), 'arc');
  }
  return Math.max(b.H, cy - vGap - extra + Math.round(b.W * 0.06) - b.Y);
}
// Lay a horizontal ROW of cards across [x0,x0+rowW]; bottom-align (grow up) or
// top-align (grow down). Returns each card's center-x + the row's near-hub edge Y.
function placeRow(layers: Layer[], id: string, tag: string, items: SeqItem[], idxBase: number,
  x0: number, rowW: number, edgeY: number, growUp: boolean, ctx: MapCtx): { cx: number; edge: number }[] {
  const n = items.length;
  if (!n) return [];
  const gap = Math.round(ctx.W * 0.03);
  const cardW = Math.round((rowW - (n - 1) * gap) / n);
  const out: { cx: number; edge: number }[] = [];
  items.forEach((it, j) => {
    const x = x0 + j * (cardW + gap);
    const h = measureCard(it, cardW, ctx).h;
    const y = growUp ? edgeY - h : edgeY;
    card(layers, `${id}_${tag}`, idxBase + j, x, y, cardW, it, ctx, 20 + (idxBase + j) * 5);
    out.push({ cx: x + cardW / 2, edge: growUp ? y : y + h });
  });
  return out;
}

function buildSpokes(layers: Layer[], id: string, b: Box, title: string, kicker: string,
  accent: string, text: string, muted: string, ctx: MapCtx, items: SeqItem[]): number {
  void text;
  const M = Math.round(b.W * 0.05);
  const cW = b.W - 2 * M;
  let topY = b.Y + Math.round(b.W * 0.04);
  if (kicker) {
    layers.push(txt(`${id}_kick`, 8, b.X + M, topY, cW, 32, kicker, { font_family: 'IBM Plex Mono',
      font_size: Math.round(b.W * 0.02), font_weight: 600, color: muted, letter_spacing: 2, text_transform: 'uppercase', align: 'center' }));
    topY += Math.round(b.W * 0.05);
  }
  const botY = b.Y + b.H - Math.round(b.W * 0.04);

  // Hub: a pill at the vertical center carrying the topic.
  const hubH = Math.round(b.W * 0.15), hubW = Math.round(cW * 0.52);
  const hubCY = Math.round((topY + botY) / 2), hubCX = b.X + b.W / 2;
  const hubX = hubCX - hubW / 2, hubY = hubCY - hubH / 2;
  const gapV = Math.round(b.W * 0.05);

  // Top row hangs from near the canvas top (grows down); bottom row sits on the
  // bottom margin (grows up) — so the cluster fills the page instead of hugging
  // the hub. Each row reports its HUB-FACING edge for the connector to land on.
  void gapV;
  const half = Math.ceil(items.length / 2);
  const topItems = items.slice(0, half), botItems = items.slice(half);
  const topEdges = placeRow(layers, id, 't', topItems, 0, b.X + M, cW, topY + Math.round(b.W * 0.02), false, ctx);
  const botEdges = placeRow(layers, id, 'b', botItems, half, b.X + M, cW, botY, true, ctx);

  // Connectors hub → each card (drawn before the hub so the hub sits on top).
  topEdges.forEach((e, j) => link(layers, id, j, [hubCX + (e.cx - hubCX) * 0.25, hubY], [e.cx, e.edge],
    mixHex(ctx.colors[j % ctx.colors.length], ctx.text, 0.15), 'arc'));
  botEdges.forEach((e, j) => link(layers, id, half + j, [hubCX + (e.cx - hubCX) * 0.25, hubY + hubH], [e.cx, e.edge],
    mixHex(ctx.colors[(half + j) % ctx.colors.length], ctx.text, 0.15), 'arc'));

  layers.push({ id: `${id}_hubsh`, type: 'rect', z: 40, x: hubX + 6, y: hubY + 8, width: hubW, height: hubH,
    radius: Math.round(hubH / 2), fill: { type: 'solid', color: mixHex(ctx.bg, '#000000', 0.18) } } as unknown as Layer);
  layers.push({ id: `${id}_hub`, type: 'rect', z: 41, x: hubX, y: hubY, width: hubW, height: hubH,
    radius: Math.round(hubH / 2), fill: { type: 'solid', color: accent } } as unknown as Layer);
  const hts = fitTitleSize(title, Math.round(hubH * 0.46), hubW - Math.round(b.W * 0.06), ctx.titleFont, false);
  const hth = estTextHeight(title, hts, hubW - Math.round(b.W * 0.06), 1.02);
  layers.push(txt(`${id}_hubt`, 42, hubX + Math.round(b.W * 0.03), hubCY - Math.round(hth / 2), hubW - Math.round(b.W * 0.06), hth + 4,
    title, { font_size: hts, font_weight: 800, color: readableOn(accent, '#FFFFFF'), align: 'center', line_height: 1.02, font_family: ctx.titleFont }));
  return b.H;
}
