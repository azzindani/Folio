// Card-flyer presets from the reference set:
//   ribbon_cards — a grid of cards, each with a folded RIBBON banner heading, bullet
//                  body, and a dark corner number badge (the "Social Media Tips" look)
//   value_list   — a masthead over rows carrying a big ROTATED word/number in the left
//                  margin, heading + bullets, dashed dividers (the "Brand Values" look)
// Engine measures every card / row and fits the grid; the model brings the content.
import type { Layer } from '../schema/types';
import {
  shStr, mixHex, readableOn, readablePair, seededDefaults, ShorthandLayer,
  defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt,
} from './shorthand-helpers';
import { composeBackground } from './shorthand-background';
import { nodeColors, lum } from './shorthand-presets-seq';

interface CardItem { title: string; lines: string[]; desc: string; icon: string }
function readCardItems(v: unknown): CardItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const bl = o['bullets'] ?? o['points'] ?? o['list'] ?? o['items'];
    const lines = Array.isArray(bl) ? bl.map(b => shStr(b)).filter(Boolean) : [];
    return {
      title: shStr(o['title'] ?? o['name'] ?? o['heading'] ?? o['label'] ?? (typeof it === 'string' ? it : '')),
      desc: shStr(o['desc'] ?? o['description'] ?? o['text'] ?? o['body']),
      lines,
      icon: shStr(o['icon']),
    };
  }).filter((i) => i.title || i.desc || i.lines.length);
}

// Body text of a card: bullet lines if given, else the paragraph.
function cardBody(it: CardItem): string {
  if (it.lines.length) return it.lines.map(l => `•  ${l}`).join('\n');
  return it.desc;
}

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// ── ribbon_cards ────────────────────────────────────────────
export function buildRibbonCards(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const title = shStr(r['title'] ?? r['headline']);
  const items = readCardItems(r['items'] ?? r['cards'] ?? r['tips']);
  const m = seededDefaults(r, [title, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#F4F1EA');
  const accent = shStr(r['accent'], m?.accent ?? '#F2C14E');
  const { muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const seed = Math.abs([...(title + items.map(i => i.title).join())].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 9));
  // Per-card pastel bodies; the ribbon is one constant accent across the grid.
  const vivid = nodeColors(accent, palette, Math.max(items.length, 1), bg, seed % 8);
  const pastels = vivid.map(c => mixHex(c, '#FFFFFF', 0.6));
  const ribbon = lum(accent) < 0.4 ? mixHex(accent, '#FFFFFF', 0.4) : accent;

  const layers: Layer[] = [];
  const M = Math.round(W * 0.05);
  // Masthead band — charcoal strip, title reversed (the reference's dark header).
  const bandH = title ? Math.round(H * 0.085) + Math.round(W * 0.02) : 0;
  const bandFill = mixHex(bg, '#101010', 0.86);
  if (title) {
    layers.push({ id: `${id}_band`, type: 'rect', z: 60, x: X, y: Y, width: W, height: bandH, fill: { type: 'solid', color: bandFill } } as unknown as Layer);
    const ts = fitTitleSize(title, Math.round(W * 0.05), W - 2 * M, titleFont, title === title.toUpperCase());
    const th = estTextHeight(title, ts, W - 2 * M, 1.05, 0.6);
    layers.push(txt(`${id}_title`, 61, X + M, Y + Math.round((bandH - th) / 2), W - 2 * M, th + 4, title,
      { font_size: ts, font_weight: 800, color: '#FFFFFF', align: 'center', line_height: 1.05, letter_spacing: -0.5, font_family: titleFont }));
  }

  const cols = items.length <= 1 ? 1 : 2;
  const gap = Math.round(W * 0.04);
  const cardW = Math.round((W - 2 * M - (cols - 1) * gap) / cols);
  const rows = Math.ceil(items.length / cols);
  const gridTop = Y + bandH + Math.round(W * 0.045);
  const padX = Math.round(W * 0.026);
  const bodyFont = Math.max(13, Math.round(W * 0.0185));
  const headFont = Math.max(15, Math.round(W * 0.0225));
  const rowGap = Math.round(W * 0.04);

  // Ribbon spans most of the card so headings wrap to few lines; the banner GROWS to
  // fit the (uniform) tallest heading, and the body always starts below it.
  const bw = Math.round(cardW * 0.84), notch = Math.round(W * 0.026);
  const headW = bw - notch - 2 * padX;
  let ribbonH = Math.round(W * 0.05), maxBodyH = 0;
  items.forEach(it => {
    ribbonH = Math.max(ribbonH, estTextHeight(it.title, headFont, headW, 1.12, 0.6) + Math.round(W * 0.02));
    maxBodyH = Math.max(maxBodyH, estTextHeight(cardBody(it), bodyFont, cardW - 2 * padX, 1.45));
  });
  const bodyGap = Math.round(W * 0.022), bottomPad = Math.round(W * 0.05);
  let cardH = ribbonH + bodyGap + maxBodyH + bottomPad;
  // Grow cards to fill a taller-than-content canvas (the reference cards are tall).
  const gridNat = gridTop + rows * cardH + (rows - 1) * rowGap + Math.round(W * 0.05) - Y;
  if (H > gridNat) cardH += Math.round((H - gridNat) / rows);

  items.forEach((it, i) => {
    const c = i % cols, rr = Math.floor(i / cols);
    const x = X + M + c * (cardW + gap);
    const y = gridTop + rr * (cardH + rowGap);
    // card body — its top tucks just under the ribbon's lower edge
    layers.push({ id: `${id}_cd${i}`, type: 'rect', z: 20 + i * 6, x, y: y + Math.round(ribbonH * 0.45), width: cardW, height: cardH - Math.round(ribbonH * 0.45),
      radius: 10, fill: { type: 'solid', color: pastels[i] } } as unknown as Layer);
    // ribbon banner (notched right tail) + fold tab behind the left edge
    const bx = Math.round(x + padX * 0.5);
    layers.push({ id: `${id}_fold${i}`, type: 'path', z: 20 + i * 6 + 1, x: bx, y, width: bw, height: ribbonH,
      d: `M${bx - Math.round(padX * 0.5)} ${y + ribbonH} L${bx} ${y + ribbonH * 0.55} L${bx} ${y + ribbonH} Z`, fill: { type: 'solid', color: mixHex(ribbon, '#000000', 0.32) } } as unknown as Layer);
    layers.push({ id: `${id}_rb${i}`, type: 'path', z: 20 + i * 6 + 2, x: bx, y, width: bw, height: ribbonH,
      d: `M${bx} ${y} L${bx + bw} ${y} L${bx + bw - notch} ${y + ribbonH / 2} L${bx + bw} ${y + ribbonH} L${bx} ${y + ribbonH} Z`, fill: { type: 'solid', color: ribbon } } as unknown as Layer);
    const hH = estTextHeight(it.title, headFont, headW, 1.12, 0.6);
    layers.push(txt(`${id}_rt${i}`, 20 + i * 6 + 3, bx + padX, y + Math.round((ribbonH - hH) / 2), headW, hH + 4,
      it.title, { font_size: headFont, font_weight: 800, color: readableOn(ribbon, '#1A1A1A'), line_height: 1.12, font_family: titleFont, text_transform: 'uppercase', letter_spacing: 0.3 }));
    // body — starts below the full ribbon, leaves the badge corner clear
    const body = cardBody(it);
    if (body) layers.push(txt(`${id}_bd${i}`, 20 + i * 6 + 3, x + padX, y + ribbonH + bodyGap, cardW - 2 * padX, maxBodyH,
      body, { font_size: bodyFont, font_weight: 400, color: mixHex(readableOn(pastels[i], '#1A1A1A'), pastels[i], 0.12), line_height: 1.45 }));
    // dark corner number badge
    const br = Math.round(W * 0.032);
    const bxn = x + cardW - br * 2 - padX * 0.6, byn = y + cardH - br * 2 - Math.round(W * 0.018);
    layers.push({ id: `${id}_bg${i}`, type: 'ellipse', z: 20 + i * 6 + 4, x: bxn, y: byn, width: br * 2, height: br * 2, fill: { type: 'solid', color: mixHex(bg, '#101010', 0.85) } } as unknown as Layer);
    layers.push(txt(`${id}_bn${i}`, 20 + i * 6 + 5, bxn, byn + Math.round(br * 0.62), br * 2, br * 1.4, String(i + 1).padStart(2, '0') + '.',
      { font_size: Math.round(br * 0.92), font_weight: 800, color: '#FFFFFF', align: 'center', line_height: 1.0 }));
  });

  const naturalH = gridTop + rows * cardH + (rows - 1) * rowGap + Math.round(W * 0.05) - Y;
  const finalH = Math.max(H, naturalH);
  void muted;
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text: '#1A1A1A', palette, image: shStr(r['bg_image'] ?? r['photo']) }, 0);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}

// ── value_list — big rotated margin numbers + dashed dividers ─
export function buildValueList(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow'], 'these are our');
  const title = shStr(r['title'] ?? r['headline']);
  const brand = shStr(r['brand'] ?? r['tag'] ?? r['org'] ?? r['footer']);
  const items = readCardItems(r['items'] ?? r['values'] ?? r['list']);
  const m = seededDefaults(r, [title, kicker, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#F3EBE2');
  const accent = shStr(r['accent'], m?.accent ?? '#6E3B2E');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const useWords = shStr(r['numbering']).toLowerCase() !== 'digits';

  const layers: Layer[] = [];
  const M = Math.round(W * 0.07), cX = X + M, contentW = W - 2 * M;
  let cy = Y + Math.round(W * 0.07);
  const kFont = Math.round(W * 0.019);
  if (kicker) layers.push(txt(`${id}_kick`, 30, cX, cy, contentW * 0.7, kFont * 1.6, kicker, { font_family: 'IBM Plex Mono', font_size: kFont, font_weight: 600, color: muted, letter_spacing: 3, text_transform: 'uppercase' }));
  if (brand) layers.push(txt(`${id}_brand`, 30, cX + contentW * 0.5, cy, contentW * 0.5, kFont * 1.6, brand, { font_family: 'IBM Plex Mono', font_size: kFont, font_weight: 600, color: mixHex(accent, bg, 0.35), letter_spacing: 2, text_transform: 'uppercase', align: 'right' }));
  if (kicker || brand) cy += Math.round(W * 0.04);
  if (title) {
    const ts = fitTitleSize(title, Math.round(W * 0.085), contentW, titleFont, title === title.toUpperCase());
    const th = estTextHeight(title, ts, contentW, 1.02, 0.6);
    layers.push(txt(`${id}_title`, 31, cX, cy, contentW, th + 4, title, { font_size: ts, font_weight: 800, color: accent, line_height: 1.02, letter_spacing: -0.5, font_family: titleFont }));
    cy += th + Math.round(W * 0.045);
  }

  const numW = Math.round(W * 0.13);
  const tX = cX + numW, tW = contentW - numW;
  const headFont = Math.max(15, Math.round(W * 0.026)), bodyFont = Math.max(13, Math.round(W * 0.019));
  const numFont = Math.round(W * 0.05);
  // Reserve gaps so the rows breathe down the page: measure rows, then fold any
  // canvas slack evenly into the inter-row rhythm (keeps the list from bunching up
  // top with a dead lower band on a fixed A4).
  const baseGap = Math.round(W * 0.03);
  const rowHs = items.map(it => {
    const headH = it.title ? estTextHeight(it.title, headFont, tW, 1.15) : 0;
    const bodyH = it.desc || it.lines.length ? estTextHeight(cardBody(it), bodyFont, tW, 1.45) : 0;
    return Math.max(numFont * 1.2, headH + (bodyH ? Math.round(W * 0.01) + bodyH : 0)) + Math.round(W * 0.025);
  });
  const rowsNat = (cy - Y) + rowHs.reduce((a, b) => a + b, 0) + baseGap * (items.length - 1) + Math.round(W * 0.06);
  const extraGap = H > rowsNat && items.length > 1 ? Math.round((H - rowsNat) / (items.length - 1)) : 0;
  const rowGapV = baseGap + extraGap;
  items.forEach((it, i) => {
    const head = it.title, body = cardBody(it);
    const headH = head ? estTextHeight(head, headFont, tW, 1.15) : 0;
    const bodyH = body ? estTextHeight(body, bodyFont, tW, 1.45) : 0;
    const rowH = rowHs[i];
    const rowCY = cy + rowH / 2;
    // big rotated word/number in the left margin
    const label = useWords ? (WORDS[i] ?? String(i + 1)) : String(i + 1).padStart(2, '0');
    const lw = Math.max(160, rowH);
    const nl = txt(`${id}_num${i}`, 32 + i, cX + numW / 2 - lw / 2, rowCY - numFont * 0.7, lw, numFont * 1.4, label,
      { font_size: numFont, font_weight: 800, color: accent, align: 'center', line_height: 1.0, letter_spacing: -1, font_family: titleFont, text_transform: useWords ? 'lowercase' : 'none' });
    (nl as unknown as { rotation: number }).rotation = -90;
    layers.push(nl);
    let ty = cy;
    if (it.icon) { layers.push({ id: `${id}_ic${i}`, type: 'icon', z: 32 + i, x: tX, y: ty, width: Math.round(W * 0.05), height: Math.round(W * 0.05), icon: it.icon, color: accent } as unknown as Layer); ty += Math.round(W * 0.06); }
    if (head) { layers.push(txt(`${id}_h${i}`, 33 + i, tX, ty, tW, headH, head, { font_size: headFont, font_weight: 700, color: text, line_height: 1.15 })); ty += headH + Math.round(W * 0.01); }
    if (body) layers.push(txt(`${id}_b${i}`, 33 + i, tX, ty, tW, bodyH, body, { font_size: bodyFont, font_weight: 400, color: muted, line_height: 1.45 }));
    cy += rowH;
    if (i < items.length - 1) {
      layers.push({ id: `${id}_div${i}`, type: 'line', z: 32 + i, x1: cX, y1: Math.round(cy + rowGapV / 2), x2: cX + contentW, y2: Math.round(cy + rowGapV / 2), stroke: { color: mixHex(muted, bg, 0.3), width: 2, dash: [7, 6] } } as unknown as Layer);
      cy += rowGapV;
    }
  });

  const naturalH = Math.round(cy + W * 0.06 - Y);
  const finalH = Math.max(H, naturalH);
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo']) }, 0);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}
