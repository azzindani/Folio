// Sequence preset family — timeline / steps / roadmap / journey. Renders a
// NUMBERED, COLORED spine with content blocks in two silhouettes:
//   zigzag — centered spine, blocks alternate left/right (the canonical A4 / IG
//            "project timeline" look from the reference set)
//   rail   — left spine, every block to its right (compact, list-like)
// plus a reversed HEADER BAND. The model supplies only content + colors; every
// coordinate, the per-node color ramp, and the canvas fit are the engine's job.
import type { Layer } from '../schema/types';
import { hexToRgb, luminance } from './engine/reference';
import {
  shStr, mixHex, readableOn, readablePair, seededDefaults, ShorthandLayer,
  defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt, footerLayer,
} from './shorthand-helpers';
import { composeBackground } from './shorthand-background';

export interface SeqItem { date: string; title: string; desc: string }
export function readSeqItems(v: unknown): SeqItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return {
      date: shStr(o['date'] ?? o['year'] ?? o['label'] ?? o['time'] ?? o['when'] ?? o['step']),
      title: shStr(o['title'] ?? o['event'] ?? o['name'] ?? o['heading'] ?? (typeof it === 'string' ? it : '')),
      desc: shStr(o['desc'] ?? o['description'] ?? o['text'] ?? o['body'] ?? o['detail']),
    };
  }).filter((i) => i.date || i.title || i.desc);
}

export const lum = (h: string): number => { const r = hexToRgb(h); return r ? luminance(r) : 0.5; };

// A ramp of distinct node colors. The model's palette wins (cycled); otherwise a
// curated 8-hue wheel rotated by `seed` so two timelines never share a sequence.
// Each color is nudged to stay legible against the background.
export const NODE_WHEEL = ['#3B5BA5', '#6D3B9E', '#B5374A', '#C75B2A', '#D99A1C', '#3F9A4E', '#1F8E84', '#7A4E2D'];
export function nodeColors(accent: string, palette: string[], n: number, bg: string, seed: number): string[] {
  const base = palette.length >= 3 ? palette : [accent, ...NODE_WHEEL];
  const bgL = lum(bg);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let c = base[(i + seed) % base.length];
    if (Math.abs(lum(c) - bgL) < 0.22) c = mixHex(c, bgL > 0.5 ? '#15110D' : '#FFFFFF', 0.45);
    out.push(c);
  }
  return out;
}

function seqLayout(sh: Record<string, unknown>, seed: number): 'zigzag' | 'rail' {
  const v = shStr(sh['layout'] ?? sh['variant'] ?? sh['style']).toLowerCase();
  if (/rail|left|list|compact/.test(v)) return 'rail';
  if (/zig|alt|center|split/.test(v)) return 'zigzag';
  return seed % 3 === 0 ? 'rail' : 'zigzag'; // zigzag is the richer default
}

// ── timeline / steps / roadmap / journey ────────────────────
export function buildTimeline(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline']);
  const subtitle = shStr(r['subtitle'] ?? r['deck'] ?? r['intro']);
  const footer = shStr(r['footer']);
  const items = readSeqItems(r['items'] ?? r['events'] ?? r['milestones'] ?? r['steps'] ?? r['phases'] ?? r['stages']);
  const m = seededDefaults(r, [title, subtitle, kicker, items.map(i => i.title).join(' ')]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;

  const seed = Math.abs([...(title + items.map(i => i.title).join())].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  const layout = seqLayout(r, seed);
  // Number the steps when the model gave no explicit date/label per item.
  const numbered = items.length > 0 && items.every(it => !it.date);
  const colors = nodeColors(accent, palette, items.length, bg, seed % 8);

  const M = Math.round(W * 0.07);
  const cX = X + M, cW = W - 2 * M;
  const layers: Layer[] = [];
  let k = 1, cy = Y;

  // Header BAND — a full-width accent strip with the title reversed out of it.
  // Gives the sequence the masthead the references all carry.
  const bandH = title ? Math.round(H * 0.085) + Math.round(W * 0.02) : 0;
  // Darken a light accent so the title reverses out white (the references all use
  // a deep band — dark green / black — not a pale strip).
  const bandFill = lum(accent) > 0.45 ? mixHex(accent, '#0E0E10', 0.34) : accent;
  if (title) {
    layers.push({ id: `${id}_band`, type: 'rect', z: 1, x: X, y: Y, width: W, height: bandH, fill: { type: 'solid', color: bandFill } } as unknown as Layer);
    const onBand = readableOn(bandFill, '#FFFFFF');
    const bts = fitTitleSize(title, Math.round(W * 0.06), W - 2 * M, titleFont, false);
    layers.push(txt(`${id}_title`, k++, cX, Y + Math.round((bandH - bts) / 2) - Math.round(bts * 0.08), W - 2 * M, Math.round(bts * 1.2), title, { font_size: bts, font_weight: 800, color: onBand, line_height: 1.0, letter_spacing: -0.5, font_family: titleFont }));
    cy = Y + bandH + Math.round(W * 0.05);
  } else { cy = Y + Math.round(W * 0.06); }
  if (kicker) {
    layers.push(txt(`${id}_kick`, k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.018), font_weight: 600, color: accent, letter_spacing: 2, text_transform: 'uppercase' }));
    cy += Math.round(W * 0.04);
  }
  if (subtitle) {
    const ss = Math.round(W * 0.026), sh2 = estTextHeight(subtitle, ss, cW, 1.4);
    layers.push(txt(`${id}_sub`, k++, cX, cy, cW, sh2, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += sh2 + Math.round(W * 0.035);
  }

  // Spine geometry. zigzag → centered; rail → left gutter.
  const R = Math.max(18, Math.round(W * (layout === 'zigzag' ? 0.034 : 0.026)));
  const spineX = layout === 'zigzag' ? X + Math.round(W / 2) : cX + R;
  const gap = Math.round(W * 0.03);
  const sideW = layout === 'zigzag' ? (spineX - X - R - gap - M) : (X + W - M - (spineX + R + gap));
  const htSize = Math.round(W * 0.03), dSize = Math.round(W * 0.02), labSize = Math.round(W * 0.026);
  const itemGap = Math.round(W * 0.03);
  const nodeYs: number[] = [];
  const spineTop = cy;
  const bodyStart = layers.length; // header layers precede this; everything after is the timeline body

  items.forEach((it, i) => {
    const right = layout === 'rail' ? true : i % 2 === 0;
    const bx = right ? spineX + R + gap : (layout === 'zigzag' ? X + M : cX); // block x
    const align = right ? 'left' as const : 'right' as const;
    // measure block
    const labH = it.date ? estTextHeight(it.date, labSize, sideW, 1.1) : 0;
    const ttH = it.title ? estTextHeight(it.title, htSize, sideW, 1.15) : 0;
    const ddH = it.desc ? estTextHeight(it.desc, dSize, sideW, 1.4) : 0;
    const blockH = Math.max(R * 2, labH + ttH + ddH + (it.date ? 6 : 0) + 6);
    const nodeY = cy + Math.round(blockH / 2);
    nodeYs.push(nodeY);
    // connector stub from the node to the block
    const stubX1 = right ? spineX + R : bx + sideW;
    const stubX2 = right ? bx : spineX - R;
    layers.push({ id: `${id}_stub${i}`, type: 'rect', z: 10, x: Math.min(stubX1, stubX2), y: nodeY - 1, width: Math.max(2, Math.abs(stubX2 - stubX1)), height: 3, fill: { type: 'solid', color: mixHex(colors[i], bg, 0.35) } } as unknown as Layer);
    // text block (top-anchored within blockH, vertically centered on node)
    let by = nodeY - Math.round(blockH / 2);
    if (it.date) { layers.push(txt(`${id}_lb${i}`, k++, bx, by, sideW, labH, it.date, { font_size: labSize, font_weight: 800, color: colors[i], line_height: 1.1, align, font_family: titleFont })); by += labH + 6; }
    if (it.title) { layers.push(txt(`${id}_tt${i}`, k++, bx, by, sideW, ttH, it.title, { font_size: htSize, font_weight: 700, color: text, line_height: 1.15, align })); by += ttH + 6; }
    if (it.desc) { layers.push(txt(`${id}_td${i}`, k++, bx, by, sideW, ddH, it.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4, align })); }
    cy += blockH + itemGap;
  });
  if (items.length) cy -= itemGap;

  // Spine line behind the nodes, then a filled colored node per item with the
  // step number reversed in it (numbered) — drawn last so it sits on top.
  if (nodeYs.length) {
    layers.push({ id: `${id}_spine`, type: 'rect', z: 5, x: spineX - 2, y: spineTop, width: 4, height: Math.max(4, nodeYs[nodeYs.length - 1] - spineTop), fill: { type: 'solid', color: mixHex(accent, bg, 0.5) } } as unknown as Layer);
    nodeYs.forEach((ny, i) => {
      layers.push({ id: `${id}_node${i}`, type: 'ellipse', z: 20, x: spineX - R, y: ny - R, width: R * 2, height: R * 2, fill: { type: 'solid', color: colors[i] } } as unknown as Layer);
      if (labelTxtFor(items[i], numbered, i)) {
        const nsz = Math.round(R * 1.05);
        // z 30 keeps the number ABOVE its node circle (z 20); without it the
        // number paints behind the fill and the node renders empty.
        layers.push(txt(`${id}_nn${i}`, 30, spineX - R, ny - Math.round(nsz * 0.66), R * 2, Math.round(nsz * 1.2), String(i + 1), { font_size: nsz, font_weight: 800, color: readableOn(colors[i], '#FFFFFF'), align: 'center', line_height: 1.0 }));
      }
    });
  }

  if (footer) {
    cy += Math.round(W * 0.04);
    layers.push(footerLayer(`${id}_footer`, k++, cX, Math.round(cy), cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1, align: 'center' }, r));
    cy += 30;
  }

  const naturalH = Math.min(Math.round(W * 3.6), Math.max(Math.round(W * 0.6), Math.round(cy + W * 0.06 - Y)));
  // When the model asked for a taller canvas than the content needs (a fixed A4 /
  // story ratio), keep that canvas and CENTER the timeline body in the slack below
  // the header band — so the spine fills the page instead of floating up top.
  const finalH = H > naturalH ? H : naturalH;
  if (finalH > naturalH) {
    const shift = Math.round((finalH - naturalH) * 0.5);
    for (let i = bodyStart; i < layers.length; i++) { const o = layers[i] as unknown as { y: number }; if (typeof o.y === 'number') o.y += shift; }
  }
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers: [...bgLayers, ...layers] } as unknown as Layer;
}

// Number a step only when it has no explicit date label (else the date is the marker).
function labelTxtFor(it: SeqItem, numbered: boolean, _i: number): boolean {
  return numbered && !it.date;
}
