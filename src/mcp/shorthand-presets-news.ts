// Newsletter preset — a bordered A4 community newsletter: masthead (title +
// subtitle + byline/date), a full-width LEAD panel, a 2-column MASONRY of soft
// section boxes (each a pill-tag heading + body/bullets), and a full-width footer.
// The engine measures every box and greedily balances the two columns; the model
// supplies the copy. Matches the "Back-to-School" / "Springtime" references.
import type { Layer } from '../schema/types';
import {
  shStr, mixHex, readableOn, readablePair, seededDefaults, ShorthandLayer,
  defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt, headlineFont,
} from './shorthand-helpers';
import { composeBackground } from './shorthand-background';
import { nodeColors, lum } from './shorthand-presets-seq';

interface NewsItem { title: string; body: string; wide: boolean }
function readNewsItems(v: unknown): NewsItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const bl = o['bullets'] ?? o['points'] ?? o['list'];
    const bullets = Array.isArray(bl) ? bl.map(b => shStr(b)).filter(Boolean) : [];
    const desc = shStr(o['desc'] ?? o['description'] ?? o['text'] ?? o['body']);
    const body = bullets.length ? (desc ? desc + '\n' : '') + bullets.map(b => `•  ${b}`).join('\n') : desc;
    return {
      title: shStr(o['title'] ?? o['heading'] ?? o['name'] ?? (typeof it === 'string' ? it : '')),
      body,
      wide: o['wide'] === true || o['span'] === 2 || o['full'] === true,
    };
  }).filter((i) => i.title || i.body);
}

interface NewsCtx { bg: string; text: string; muted: string; colors: string[]; W: number; titleFont?: string }

// Measure a section box height for a given content width.
function panelH(it: NewsItem, w: number, c: NewsCtx): number {
  const padX = Math.round(c.W * 0.02), padY = Math.round(c.W * 0.018);
  const tagFont = Math.max(13, Math.round(c.W * 0.0205));
  const bodyFont = Math.max(12, Math.round(c.W * 0.0175));
  const tagH = it.title ? Math.round(tagFont * 1.9) : 0;
  const bodyH = it.body ? estTextHeight(it.body, bodyFont, w - 2 * padX, 1.42) : 0;
  return padY + tagH + (it.body ? Math.round(c.W * 0.012) + bodyH : 0) + padY;
}

// Draw a section box: soft tinted card + a pill-tag heading + body. Returns height.
function panel(layers: Layer[], id: string, idx: number, x: number, y: number, w: number, it: NewsItem, color: string, c: NewsCtx, z: number): number {
  const padX = Math.round(c.W * 0.02), padY = Math.round(c.W * 0.018);
  const tagFont = Math.max(13, Math.round(c.W * 0.0205));
  const bodyFont = Math.max(12, Math.round(c.W * 0.0175));
  const h = panelH(it, w, c);
  const surface = lum(c.bg) > 0.5 ? mixHex(color, '#FFFFFF', 0.78) : mixHex(color, c.bg, 0.6);
  layers.push({ id: `${id}_box${idx}`, type: 'rect', z, x, y, width: w, height: h, radius: 12,
    fill: { type: 'solid', color: surface }, stroke: mixHex(color, c.text, 0.1), stroke_width: 1.5 } as unknown as Layer);
  let ty = y + padY;
  if (it.title) {
    // pill-tag heading: a rounded outline chip centered, heading reversed/coloured
    const tagH = Math.round(tagFont * 1.5);
    const tw = Math.min(w - 2 * padX, Math.round(it.title.length * tagFont * 0.66) + padX * 2);
    const tx = x + (w - tw) / 2;
    layers.push({ id: `${id}_tag${idx}`, type: 'rect', z: z + 1, x: tx, y: ty, width: tw, height: tagH, radius: Math.round(tagH / 2),
      fill: { type: 'solid', color: mixHex(color, '#FFFFFF', 0.35) }, stroke: mixHex(color, c.text, 0.15), stroke_width: 1.5 } as unknown as Layer);
    layers.push(txt(`${id}_tt${idx}`, z + 2, tx, ty + Math.round((tagH - tagFont) / 2) - 1, tw, tagFont + 4, it.title,
      { font_size: tagFont, font_weight: 700, color: readableOn(mixHex(color, '#FFFFFF', 0.35), c.text), align: 'center', line_height: 1.0, font_family: c.titleFont, letter_spacing: 0.3 }));
    ty += Math.round(tagFont * 1.9);
  }
  if (it.body) {
    const bh = estTextHeight(it.body, bodyFont, w - 2 * padX, 1.42);
    const align = it.body.includes('•') ? 'left' as const : 'center' as const;
    layers.push(txt(`${id}_bd${idx}`, z + 1, x + padX, ty + Math.round(c.W * 0.012), w - 2 * padX, bh, it.body,
      { font_size: bodyFont, font_weight: 400, color: c.text, line_height: 1.42, align }));
  }
  return h;
}

export function buildNewsletter(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const title = shStr(r['title'] ?? r['headline'] ?? r['masthead']);
  const subtitle = shStr(r['subtitle'] ?? r['tagline'] ?? r['deck']);
  const byline = shStr(r['byline'] ?? r['author'] ?? r['by']);
  const date = shStr(r['date'] ?? r['issue'] ?? r['month']);
  const handle = shStr(r['handle'] ?? r['site'] ?? r['contact']);
  const intro = shStr(r['intro'] ?? r['lead'] ?? r['note']);
  const introTitle = shStr(r['intro_title'] ?? r['lead_title'], 'A Note From Our Community');
  const items = readNewsItems(r['items'] ?? r['sections'] ?? r['stories']);
  const footer = shStr(r['footer'] ?? r['cta']);
  const m = seededDefaults(r, [title, subtitle, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FBF7F0');
  const accent = shStr(r['accent'], m?.accent ?? '#5B6ED6');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family']) || headlineFont(m?.font, String(r['title'] ?? r['headline'] ?? '') + id);
  const seed = Math.abs([...(title + items.map(i => i.title).join())].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 13));
  const colors = nodeColors(accent, palette, Math.max(items.length, 1), bg, seed % 8);
  const ctx: NewsCtx = { bg, text, muted, colors, W, titleFont };

  const layers: Layer[] = [];
  const inset = Math.round(W * 0.03), M = Math.round(W * 0.06);
  const cX = X + M, cW = W - 2 * M;
  let cy = Y + Math.round(W * 0.07);

  // Masthead
  if (title) {
    const ts = fitTitleSize(title, Math.round(W * 0.062), cW, titleFont, title === title.toUpperCase());
    const th = estTextHeight(title, ts, cW, 1.04, 0.6);
    layers.push(txt(`${id}_title`, 10, cX, cy, cW, th + 4, title, { font_size: ts, font_weight: 800, color: accent, align: 'center', line_height: 1.04, letter_spacing: -0.5, font_family: titleFont }));
    cy += th + Math.round(W * 0.012);
  }
  if (subtitle) { layers.push(txt(`${id}_sub`, 10, cX, cy, cW, Math.round(W * 0.04), subtitle, { font_size: Math.round(W * 0.026), font_weight: 400, color: text, align: 'center', line_height: 1.2 })); cy += Math.round(W * 0.045); }
  if (byline) { layers.push(txt(`${id}_by`, 10, cX, cy, cW, Math.round(W * 0.03), byline, { font_size: Math.round(W * 0.021), font_weight: 500, color: muted, align: 'center', font_style: 'italic' })); cy += Math.round(W * 0.038); }
  if (date || handle) {
    if (date) layers.push(txt(`${id}_date`, 10, cX, cy, cW * 0.5, Math.round(W * 0.03), date, { font_size: Math.round(W * 0.019), font_weight: 500, color: muted, align: 'left' }));
    if (handle) layers.push(txt(`${id}_hand`, 10, cX + cW * 0.5, cy, cW * 0.5, Math.round(W * 0.03), handle, { font_size: Math.round(W * 0.019), font_weight: 500, color: muted, align: 'right' }));
    cy += Math.round(W * 0.04);
  }

  // Greedily place lead + masonry + footer into a positions list (measure only),
  // for a given vertical rhythm. Returned bottom drives the slack distribution so a
  // light newsletter still fills its A4 instead of stranding a dead lower half.
  const colGap = Math.round(W * 0.035), colW = Math.round((cW - colGap) / 2);
  const colX = [cX, cX + colW + colGap];
  type Slot = { idx: number; x: number; y: number; w: number; it: NewsItem; color: string; z: number };
  const plan = (gap: number, leadGap: number): { slots: Slot[]; bottom: number } => {
    const slots: Slot[] = [];
    let y0 = cy;
    if (intro) { const it = { title: introTitle, body: intro, wide: true }; slots.push({ idx: 0, x: cX, y: y0, w: cW, it, color: accent, z: 20 }); y0 += panelH(it, cW, ctx) + leadGap; }
    const cys = [y0, y0];
    items.forEach((it, i) => {
      if (it.wide) { const y = Math.max(cys[0], cys[1]); slots.push({ idx: i + 1, x: cX, y, w: cW, it, color: colors[i], z: 22 + i * 4 }); cys[0] = cys[1] = y + panelH(it, cW, ctx) + gap; }
      else { const col = cys[0] <= cys[1] ? 0 : 1; slots.push({ idx: i + 1, x: colX[col], y: cys[col], w: colW, it, color: colors[i], z: 22 + i * 4 }); cys[col] += panelH(it, colW, ctx) + gap; }
    });
    let bottom = Math.max(cys[0], cys[1]);
    if (footer) { slots.push({ idx: items.length + 1, x: cX, y: bottom, w: cW, it: { title: '', body: footer, wide: true }, color: mixHex(accent, bg, 0.3), z: 40 }); bottom += panelH({ title: '', body: footer, wide: true }, cW, ctx); }
    return { slots, bottom };
  };
  const baseGap = Math.round(W * 0.03);
  const probe = plan(baseGap, Math.round(W * 0.03));
  // Spread the slack across the vertical seams (one per box row + lead + footer).
  const seams = Math.max(1, plan(0, 0).slots.length);
  const slack = Math.max(0, H - Math.round(probe.bottom + W * 0.06 - Y));
  const grow = Math.min(Math.round(W * 0.06), Math.round(slack / seams));
  const { slots, bottom } = plan(baseGap + grow, Math.round(W * 0.03) + grow);
  slots.forEach(s => panel(layers, id, s.idx, s.x, s.y, s.w, s.it, s.color, ctx, s.z));
  cy = bottom;

  const naturalH = Math.round(cy + W * 0.06 - Y);
  const finalH = Math.max(H, naturalH);
  // Border frame on top of everything.
  layers.push({ id: `${id}_frame`, type: 'rect', z: 90, x: X + inset, y: Y + inset, width: W - 2 * inset, height: finalH - 2 * inset, radius: 14, stroke: { color: mixHex(accent, text, 0.1), width: 2.5 } } as unknown as Layer);

  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo']) }, 0);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}
