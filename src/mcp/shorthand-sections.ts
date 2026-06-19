// Folio shorthand parser — section-block renderer. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer } from '../schema/types';

import { shStr, readableOn, mixHex, estTextHeight, txt, SecCtx } from './shorthand-helpers';

export function figureLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 14) return false;
  return /^[+\-]?[$€£¥]?\d[\d.,:]*\s?(?:%|[KMBT]|[kKMG]?Wh?|TW|GW|MW|x|×|s|hrs?|bn|m|k|°[CF]?)?\+?$/.test(t);
}

export function renderSectionBlock(b: Record<string, unknown>, idp: string, z0: number, x: number, y: number, w: number, ctx: SecCtx): { layers: Layer[]; height: number } {
  const { accent, text, muted, bg, W } = ctx;
  const kind = shStr(b['kind'] ?? b['type'], 'text');
  const layers: Layer[] = [];
  let z = z0;
  // The item array is the #1 alias gap: a model names it items / rows / data /
  // values / stats / bars interchangeably. Reading only b['items'] silently
  // drops the whole block (caught a "By the numbers" slide rendering blank).
  const arrField = (...keys: string[]): Record<string, unknown>[] => {
    for (const k of keys) if (Array.isArray(b[k])) return b[k] as Record<string, unknown>[];
    return [];
  };

  if (kind === 'heading' || kind === 'subhead' || kind === 'section') {
    const t = shStr(b['text'] ?? b['title'] ?? b['heading'] ?? b['content']);
    const size = Math.round(W * (kind === 'subhead' ? 0.032 : 0.044));
    layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    const th = estTextHeight(t, size, w, 1.1);
    layers.push(txt(`${idp}_h`, z++, x, y + 20, w, th, t, { font_size: size, font_weight: 800, color: text, line_height: 1.1, letter_spacing: -0.5 }));
    return { layers, height: 20 + th };
  }
  // A subhead PLUS its body, the common "heading_text" block weak models emit
  // (heading in `sub_theme`/`heading`, body in `text`/`subtitles`). Without this
  // it fell to the generic fallback → the body rendered as a bare floating line
  // with no hierarchy (the g_energy "Cost Reductions / Job Creation" case).
  if (kind === 'heading_text' || kind === 'titled_text' || kind === 'section_block' || kind === 'subsection') {
    let head = shStr(b['heading'] ?? b['sub_theme'] ?? b['subhead'] ?? b['title'] ?? b['name']);
    const subs = Array.isArray(b['subtitles']) ? (b['subtitles'] as unknown[]).map(s => shStr(s)).filter(Boolean).join(' ') : '';
    let body = subs || shStr(b['body'] ?? b['subtitle'] ?? b['desc'] ?? b['text'] ?? b['content']);
    if (!head) { head = body; body = ''; }   // only one string given → it's the heading
    // A model that wants a single-stat poster often writes the FIGURE as the
    // heading_text heading ("$1.7 trillion" / "$250B") + a caption, instead of a
    // stats block — and the figure then renders at a timid ~35px. When the heading
    // IS a figure (a compact token, or a number + a scale word) and a caption
    // follows, render it as a HERO number (accent, fit-to-width), matching the
    // single-stat stats-block treatment. Recurring student-debt / creator-economy.
    const ht = head.trim(), hw = ht.split(/\s+/);
    const heroFig = !!body && ht.length <= 20 && (figureLike(ht)
      || (hw.length === 2 && /^[$€£¥]?[+\-]?[\d.,]+$/.test(hw[0])
        && /^(trillion|billion|million|thousand|percent|hours?|hrs?|days?|years?|weeks?|months?|minutes?|seconds?)$/i.test(hw[1])));
    if (heroFig) {
      const maxTok = Math.max(1, ...hw.map(t => t.length));
      const vSize = Math.max(40, Math.round(Math.min(W * 0.13, (w * 0.92) / (maxTok * 0.58))));
      const vh = estTextHeight(head, vSize, w, 1.04);
      layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_hh`, z++, x, y + 22, w, vh, head, { font_size: vSize, font_weight: 800, color: accent, line_height: 1.04, letter_spacing: -1 }));
      let total = 22 + vh;
      const bSize = Math.round(W * 0.026), bh = estTextHeight(body, bSize, w, 1.45);
      layers.push(txt(`${idp}_hb`, z++, x, y + total + 16, w, bh, body, { font_size: bSize, font_weight: 400, color: text, line_height: 1.45 }));
      total += 16 + bh;
      return { layers, height: total };
    }
    const hSize = Math.round(W * 0.032);
    layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    const hh = estTextHeight(head, hSize, w, 1.15);
    layers.push(txt(`${idp}_hh`, z++, x, y + 20, w, hh, head, { font_size: hSize, font_weight: 800, color: text, line_height: 1.15, letter_spacing: -0.4 }));
    let total = 20 + hh;
    if (body) {
      const bSize = Math.round(W * 0.0225);
      const bh = estTextHeight(body, bSize, w, 1.5);
      layers.push(txt(`${idp}_hb`, z++, x, y + total + 10, w, bh, body, { font_size: bSize, font_weight: 400, color: muted, line_height: 1.5 }));
      total += 10 + bh;
    }
    return { layers, height: total };
  }
  if (kind === 'text' || kind === 'paragraph' || kind === 'body' || kind === 'intro') {
    const t = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content']);
    const size = Math.round(W * (kind === 'intro' ? 0.026 : 0.0225));
    const th = estTextHeight(t, size, w, 1.5);
    layers.push(txt(`${idp}_t`, z++, x, y, w, th, t, { font_size: size, font_weight: 400, color: kind === 'intro' ? text : muted, line_height: 1.5 }));
    return { layers, height: th };
  }
  if (kind === 'stats' || kind === 'stat_row' || kind === 'kpis' || kind === 'metrics') {
    const items = arrField('items', 'rows', 'stats', 'values', 'data', 'metrics', 'kpis').slice(0, 4);
    const lSize = Math.round(W * 0.016);
    // Resolve each figure FIRST — split a merged "58% hybrid" / "$250B market"
    // into value + label so the figure stays narrow.
    const resolved = items.map(it => {
      let val = shStr(it['value'] ?? it['stat'] ?? it['number'] ?? it['title']);
      let lab = shStr(it['label'] ?? it['desc'] ?? it['text']);
      const merged = (!lab && val) ? val : (!val && lab) ? lab : '';
      if (merged) {
        const m = merged.trim().match(/^([+\-]?[$€£¥]?[\d.,]+\s*(?:%|[KMBkmb×x])?)\s+(.+)$/);
        if (m) { val = m[1].trim(); lab = m[2].trim(); }
      }
      // A weak model often SWAPS the pair — figure into `label`, caption into
      // `value` (e.g. label:"30%", value:"Share of … renewables") — so the big
      // number renders the long prose and the caption shrinks to "30%". Correct
      // it: the short measure-like token is the figure; the prose is the label.
      if (val && lab && figureLike(lab) && !figureLike(val) && (val.length > 12 || /\s/.test(val.trim()))) {
        [val, lab] = [lab, val];
      }
      // A figure cell whose VALUE carries no digit (a weak model wrote the unit or a
      // word — "minutes", "fast" — where the number belongs) renders as a giant fake
      // number next to the real digits. Demote it into the label so the big-number
      // slot stays numeric; a digit-less, all-caption stats block is handled below.
      if (val && !/[\d∞]/.test(val) && val.trim().length <= 14) { lab = lab ? `${val} · ${lab}` : val; val = ''; }
      return { val, lab };
    });
    // A stats block with NO figures — the model gave captions but no numbers
    // (g_color) — must NOT render as empty big-number slots. Keep only cells that
    // HAVE a figure; if none do, render the (real) caption copy as one compact
    // line so the content still shows instead of vanishing.
    const shown = resolved.filter(rr => rr.val.trim() !== '');
    if (!shown.length) {
      const caps = resolved.map(rr => rr.lab.trim()).filter(Boolean);
      if (!caps.length) return { layers, height: 0 };
      const line = caps.join('   ·   ');
      const size = Math.round(W * 0.0205);
      const th = estTextHeight(line, size, w, 1.5);
      layers.push(txt(`${idp}_caps`, z++, x, y, w, th, line, { font_size: size, font_weight: 500, color: muted, line_height: 1.5 }));
      return { layers, height: th };
    }
    const n = shown.length;
    // 4-across row by default, or a 2-column grid when the layout variant asks
    // for it (ctx.statCols) AND there are >2 figures — a structurally different
    // stat block for the same data (the "all designs are the same" fix). The
    // 2-col grid gets wider columns (bigger numbers) and centered cells.
    const cols = (ctx.statCols === 2 && n > 2) ? 2 : n;
    const rows = Math.ceil(n / cols);
    const colGap = Math.round(W * 0.025), rowGap = Math.round(W * 0.03);
    const colW = Math.round((w - (cols - 1) * colGap) / cols);
    // Follow the composition's alignment. A 2-col grid used to force-center its
    // cells, which left the figures floating mid-column while the heading/text
    // blocks below sat left-anchored — a visible left-edge mismatch. Left-anchor
    // the cells too (col 0 starts at the content margin), so the whole body
    // shares one left edge; only an explicitly centered composition centers them.
    const cellCenter = ctx.align === 'center';
    const valAlign = cellCenter ? { align: 'center' } : {};
    // Size the figure to FIT its column: the longest UNBREAKABLE token of any
    // value must fit colW (a long single-token value like "$0.04/kWh" otherwise
    // overruns the column and collides with the next stat — and diagnose can't
    // see inside this group, so the layout must be collision-proof by construction).
    const maxTok = Math.max(1, ...shown.map(rr => Math.max(1, ...rr.val.split(/\s+/).map(t => t.length))));
    // A LONE figure is the poster's focal point, not a row cell — let it grow into a
    // hero number (a blind model that builds a single-stat poster as a 1-item stats
    // block otherwise gets a timid ~59px figure instead of a dominant one). A
    // multi-stat row keeps the compact cap so columns stay balanced. Still fit-to-
    // column so a long token never overruns.
    const figCap = n === 1 ? W * 0.14 : W * 0.055;
    const vSize = Math.max(22, Math.round(Math.min(figCap, (colW * 0.92) / (maxTok * 0.58))));
    // Measure every cell, then place row-by-row (each row as tall as its tallest
    // cell) so a wrapped label never overlaps the row beneath it.
    const cells = shown.map(({ val, lab }) => {
      const vh = estTextHeight(val, vSize, colW, 1.05);
      const lh = lab ? estTextHeight(lab, lSize, colW, 1.3, 0.66) : 0;
      return { val, lab, vh, lh, h: vh + (lab ? 10 + lh : 0) };
    });
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...cells.filter((_, i) => Math.floor(i / cols) === r).map(c => c.h)));
    cells.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const ix = x + col * (colW + colGap);
      const iy = y + rowH.slice(0, row).reduce((a, h) => a + h, 0) + row * rowGap;
      layers.push(txt(`${idp}_v${i}`, z++, ix, iy, colW, c.vh, c.val, { font_size: vSize, font_weight: 800, color: accent, line_height: 1.05, letter_spacing: -1, ...valAlign }));
      if (c.lab) layers.push(txt(`${idp}_l${i}`, z++, ix, iy + c.vh + 10, colW, c.lh, c.lab, { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 500, color: muted, letter_spacing: 0.5, text_transform: 'uppercase', ...valAlign }));
    });
    const totalH = rowH.reduce((a, h) => a + h, 0) + Math.max(0, rows - 1) * rowGap;
    return { layers, height: totalH };
  }
  // Connected PROCESS FLOW — numbered nodes on a left rail joined by arrows, with
  // measured (collision-free) title + desc to the right. A blind model asked for a
  // "flow" hand-places ellipses + boxes + text that OVERLAP (it can't see wrapping);
  // this engine-owned block lays steps out so they never collide and reads as a real
  // process diagram. Rasterizes (ellipse/rect/path/text — no foreignObject). `steps`
  // routes here (a step list IS a sequence) while plain `list` stays bullets.
  if (kind === 'flow' || kind === 'process' || kind === 'pipeline' || kind === 'workflow' || kind === 'journey' || kind === 'steps' || kind === 'step') {
    const items = arrField('items', 'steps', 'stages', 'nodes', 'phases', 'rows', 'list', 'points', 'data');
    if (!items.length) return { layers, height: 0 };
    const nodeR = Math.round(W * 0.026);
    const railX = x + nodeR;
    const gap = Math.round(W * 0.03);
    const textX = x + 2 * nodeR + Math.round(W * 0.03);
    const textW = w - (textX - x);
    const tSize = Math.round(W * 0.027), dSize = Math.round(W * 0.02);
    const numColor = readableOn(accent, bg);
    const rows = items.map(it => {
      const title = shStr(it['title'] ?? it['name'] ?? it['label'] ?? it['heading'] ?? it['step']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const tH = estTextHeight(title || ' ', tSize, textW, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, textW, 1.4) : 0;
      const rowH = Math.max(2 * nodeR, tH + (desc ? 6 + dH : 0));
      return { title, desc, tH, dH, rowH };
    });
    let yy = y;
    rows.forEach((row, i) => {
      const nodeTop = yy;
      const nodeCY = yy + nodeR;
      // rail + downward arrow to the next node (drawn first → sits behind the node)
      if (i < rows.length - 1) {
        const lineTop = nodeTop + 2 * nodeR;
        const nextTop = yy + row.rowH + gap;
        const lineH = Math.max(0, nextTop - lineTop);
        layers.push({ id: `${idp}_rail${i}`, type: 'rect', z: z++, x: railX - 2, y: lineTop, width: 4, height: lineH, opacity: 0.4, fill: { type: 'solid', color: accent } } as unknown as Layer);
        const my = lineTop + lineH / 2;
        const ah = Math.round(nodeR * 0.5);
        layers.push({ id: `${idp}_arw${i}`, type: 'path', z: z++, x: railX - ah, y: my - ah, width: 2 * ah, height: 2 * ah, d: `M ${railX - ah} ${Math.round(my - ah * 0.4)} L ${railX + ah} ${Math.round(my - ah * 0.4)} L ${railX} ${Math.round(my + ah * 0.75)} Z`, fill: { type: 'solid', color: accent } } as unknown as Layer);
      }
      // node circle + step number
      layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: railX - nodeR, y: nodeTop, width: 2 * nodeR, height: 2 * nodeR, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_nn${i}`, z++, railX - nodeR, Math.round(nodeCY - nodeR * 0.62), 2 * nodeR, Math.round(nodeR * 1.3), String(i + 1), { font_size: Math.round(nodeR * 0.92), font_weight: 800, color: numColor, align: 'center', line_height: 1.0 }));
      // title + desc, top-aligned to the node
      layers.push(txt(`${idp}_ft${i}`, z++, textX, nodeTop, textW, row.tH, row.title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (row.desc) layers.push(txt(`${idp}_fd${i}`, z++, textX, nodeTop + row.tH + 6, textW, row.dH, row.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += row.rowH + gap;
    });
    return { layers, height: Math.max(0, yy - y - gap) };
  }
  if (kind === 'list' || kind === 'bullets' || kind === 'checklist') {
    const items = arrField('items', 'rows', 'steps', 'list', 'points', 'data');
    const gutter = Math.round(W * 0.055), tSize = Math.round(W * 0.026), dSize = Math.round(W * 0.02);
    let yy = y;
    items.forEach((it, i) => {
      const title = shStr(it['title'] ?? it['name'] ?? it['label']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description']);
      const tH = estTextHeight(title, tSize, w - gutter, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, w - gutter, 1.4) : 0;
      layers.push(txt(`${idp}_n${i}`, z++, x, yy, gutter, tSize * 1.3, String(i + 1).padStart(2, '0'), { font_size: Math.round(tSize * 1.05), font_weight: 800, color: accent, line_height: 1.0 }));
      layers.push(txt(`${idp}_lt${i}`, z++, x + gutter, yy, w - gutter, tH, title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (desc) layers.push(txt(`${idp}_ld${i}`, z++, x + gutter, yy + tH + 6, w - gutter, dH, desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += tH + (desc ? 6 + dH : 0) + Math.round(W * 0.022);
    });
    return { layers, height: Math.max(0, yy - y - Math.round(W * 0.022)) };
  }
  // Feature/benefit CARDS nested as a sections block — a blind model naturally
  // writes {kind:"feature_grid", title, subtitle, items:[{icon,title,desc}]}
  // inside a sections layer (feature_grid is really a top-level preset, so this
  // kind used to hit the unknown-kind fallback that renders only the title and
  // SILENTLY DROPS every item — the Swell "Key Features" with zero features bug).
  // Render the items as a measured 2-column grid (title + desc per card, accent
  // tick), with the block's own title/subtitle as a sub-heading above.
  if (kind === 'feature_grid' || kind === 'features' || kind === 'feature' || kind === 'cards' || kind === 'grid' || kind === 'benefits') {
    const items = arrField('items', 'cards', 'features', 'rows', 'list', 'data', 'points');
    if (!items.length) return { layers, height: 0 };
    let yy = y;
    const hTitle = shStr(b['title'] ?? b['heading']);
    const hSub = shStr(b['subtitle'] ?? b['subhead'] ?? b['intro']);
    if (hTitle) {
      const hs = Math.round(W * 0.03), hh = estTextHeight(hTitle, hs, w, 1.1);
      layers.push(txt(`${idp}_h`, z++, x, yy, w, hh, hTitle, { font_size: hs, font_weight: 800, color: text, line_height: 1.1 }));
      yy += hh + Math.round(W * 0.012);
    }
    if (hSub) {
      const ss = Math.round(W * 0.022), sh = estTextHeight(hSub, ss, w, 1.35);
      layers.push(txt(`${idp}_sh`, z++, x, yy, w, sh, hSub, { font_size: ss, font_weight: 400, color: muted, line_height: 1.35 }));
      yy += sh + Math.round(W * 0.022);
    }
    const cols = items.length >= 2 ? 2 : 1;
    const colGap = Math.round(W * 0.035), colW = Math.round((w - colGap * (cols - 1)) / cols);
    const tSize = Math.round(W * 0.025), dSize = Math.round(W * 0.0195), tickH = Math.max(3, Math.round(W * 0.006));
    const rowGap = Math.round(W * 0.03);
    let rowTop = yy, rowMax = 0, col = 0;
    items.forEach((it, i) => {
      const cTitle = shStr(it['title'] ?? it['name'] ?? it['label'] ?? it['heading']);
      const cDesc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const cx = x + col * (colW + colGap);
      const tH = estTextHeight(cTitle || ' ', tSize, colW, 1.15);
      const dH = cDesc ? estTextHeight(cDesc, dSize, colW, 1.4) : 0;
      const cellH = tickH + 10 + tH + (cDesc ? 6 + dH : 0);
      layers.push({ id: `${idp}_tk${i}`, type: 'rect', z: z++, x: cx, y: rowTop, width: Math.round(W * 0.045), height: tickH, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_ct${i}`, z++, cx, rowTop + tickH + 10, colW, tH, cTitle, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (cDesc) layers.push(txt(`${idp}_cd${i}`, z++, cx, rowTop + tickH + 10 + tH + 6, colW, dH, cDesc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      rowMax = Math.max(rowMax, cellH);
      col++;
      if (col >= cols || i === items.length - 1) { rowTop += rowMax + rowGap; rowMax = 0; col = 0; }
    });
    return { layers, height: Math.max(0, rowTop - y - rowGap) };
  }
  if (kind === 'callout' || kind === 'highlight' || kind === 'takeaway') {
    const t = shStr(b['text'] ?? b['body'] ?? b['value']);
    const label = shStr(b['label'] ?? b['title']);
    const pad = Math.round(W * 0.035), innerW = w - 2 * pad - 6;
    const lSize = Math.round(W * 0.016), tSize = Math.round(W * 0.026);
    const labH = label ? lSize + 12 : 0;
    const tH = estTextHeight(t, tSize, innerW, 1.45);
    const boxH = pad * 2 + labH + tH;
    layers.push({ id: `${idp}_box`, type: 'rect', z: z++, x, y, width: w, height: boxH, opacity: 0.12, fill: { type: 'solid', color: accent }, radius: 10 } as unknown as Layer);
    layers.push({ id: `${idp}_bar`, type: 'rect', z: z++, x, y, width: 6, height: boxH, fill: { type: 'solid', color: accent } } as unknown as Layer);
    if (label) layers.push(txt(`${idp}_cl`, z++, x + pad, y + pad, innerW, lSize + 6, label, { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 700, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    layers.push(txt(`${idp}_ct`, z++, x + pad, y + pad + labH, innerW, tH, t, { font_size: tSize, font_weight: 600, color: text, line_height: 1.45 }));
    return { layers, height: boxH };
  }
  if (kind === 'quote' || kind === 'pullquote') {
    const t = shStr(b['text'] ?? b['quote'] ?? b['content']).replace(/^["“”'']+|["“”'']+$/g, '');
    const cite = shStr(b['cite'] ?? b['author'] ?? b['source']);
    const qSize = Math.round(W * 0.036);
    const qH = estTextHeight(t, qSize, w, 1.3);
    layers.push(txt(`${idp}_q`, z++, x, y, w, qH, `“${t}”`, { font_size: qSize, font_weight: 500, font_style: 'italic', color: text, line_height: 1.3 }));
    let hh = qH;
    if (cite) { layers.push(txt(`${idp}_qc`, z++, x, y + qH + 12, w, 34, cite, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: accent, letter_spacing: 1, text_transform: 'uppercase' })); hh += 12 + 34; }
    return { layers, height: hh };
  }
  if (kind === 'bars' || kind === 'bar_chart' || kind === 'chart' || kind === 'ranking') {
    // Native rect bar chart — rasterizes in PNG (unlike foreignObject charts).
    const items = arrField('items', 'data', 'bars', 'values', 'rows', 'series').slice(0, 8);
    const num = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const vals = items.map(num);
    const max = Math.max(1, ...vals.map(Math.abs));
    const rowH = Math.round(W * 0.05), rowGap = Math.round(W * 0.02);
    const labelW = Math.round(w * 0.3), barTrack = w - labelW - Math.round(W * 0.1);
    const barH = Math.round(rowH * 0.62);
    items.forEach((it, i) => {
      const yy = y + i * (rowH + rowGap);
      const label = shStr(it['label'] ?? it['title'] ?? it['name'] ?? it['x']);
      const valDisp = shStr(it['value'] ?? it['y'] ?? it['count']);
      const bw = Math.max(4, Math.round(barTrack * (Math.abs(vals[i]) / max)));
      layers.push(txt(`${idp}_bl${i}`, z++, x, yy + Math.round((rowH - barH) / 2) - 2, labelW - 12, barH + 6, label, { font_size: Math.round(W * 0.019), font_weight: 600, color: text, line_height: 1.1 }));
      layers.push({ id: `${idp}_bt${i}`, type: 'rect', z: z++, x: x + labelW, y: yy, width: barTrack, height: barH, opacity: 0.14, fill: { type: 'solid', color: muted }, radius: 4 } as unknown as Layer);
      layers.push({ id: `${idp}_bb${i}`, type: 'rect', z: z++, x: x + labelW, y: yy, width: bw, height: barH, fill: { type: 'solid', color: accent }, radius: 4 } as unknown as Layer);
      if (valDisp) layers.push(txt(`${idp}_bv${i}`, z++, x + labelW + bw + 10, yy + Math.round((barH - Math.round(W * 0.02)) / 2), Math.round(W * 0.12), barH, valDisp, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.018), font_weight: 700, color: muted }));
    });
    return { layers, height: Math.max(0, items.length * (rowH + rowGap) - rowGap) };
  }
  // Native DONUT / PIE share-of-whole — arc paths + a legend with %. Rasterizes
  // (unlike a foreignObject vega chart, which exports BLANK). For a "breakdown /
  // split / composition / X% of the whole" — the share viz `bars` can't express.
  if (kind === 'donut' || kind === 'pie' || kind === 'ring_chart' || kind === 'breakdown' || kind === 'share' || kind === 'composition') {
    const items = arrField('items', 'rows', 'data', 'values', 'slices', 'segments', 'parts');
    if (!items.length) return { layers, height: 0 };
    const valOf = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'] ?? it['percent'] ?? it['share'] ?? it['pct'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const vals = items.map(valOf);
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    const R = Math.round(W * 0.15), rIn = kind === 'pie' ? 0 : Math.round(W * 0.15 * 0.58);
    const cx = x + R, cy = y + R;
    const ramp = (ctx.palette && ctx.palette.length >= 2) ? ctx.palette : [accent, mixHex(accent, text, 0.4), mixHex(accent, muted, 0.55)];
    const sliceColor = (i: number): string => {
      const base = ramp[i % ramp.length] ?? accent;
      const tier = Math.floor(i / ramp.length);
      return tier === 0 ? base : mixHex(base, bg, Math.min(0.5, 0.22 * tier));
    };
    let a0 = -Math.PI / 2;
    items.forEach((_it, i) => {
      const a1 = a0 + (Math.abs(vals[i]) / total) * 2 * Math.PI;
      const la = (a1 - a0) > Math.PI ? 1 : 0;
      const pt = (rad: number, ang: number): string => `${(cx + rad * Math.cos(ang)).toFixed(1)} ${(cy + rad * Math.sin(ang)).toFixed(1)}`;
      const d = rIn > 0
        ? `M ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} L ${pt(rIn, a1)} A ${rIn} ${rIn} 0 ${la} 0 ${pt(rIn, a0)} Z`
        : `M ${cx} ${cy} L ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} Z`;
      layers.push({ id: `${idp}_arc${i}`, type: 'path', z: z++, x: cx - R, y: cy - R, width: 2 * R, height: 2 * R, d, fill: { type: 'solid', color: sliceColor(i) } } as unknown as Layer);
      a0 = a1;
    });
    const legendX = x + 2 * R + Math.round(W * 0.05);
    const legendW = Math.max(Math.round(W * 0.2), w - (legendX - x));
    const lh = Math.round(W * 0.044), sw = Math.round(W * 0.022), pctW = Math.round(W * 0.07);
    items.forEach((it, i) => {
      const ly = y + i * lh;
      const label = shStr(it['label'] ?? it['name'] ?? it['title'] ?? it['x'] ?? it['category']);
      const pct = Math.round((Math.abs(vals[i]) / total) * 100);
      layers.push({ id: `${idp}_sw${i}`, type: 'rect', z: z++, x: legendX, y: ly + 4, width: sw, height: sw, fill: { type: 'solid', color: sliceColor(i) }, radius: 3 } as unknown as Layer);
      layers.push(txt(`${idp}_ll${i}`, z++, legendX + sw + 12, ly, legendW - sw - pctW - 24, lh, label, { font_size: Math.round(W * 0.02), font_weight: 600, color: text, line_height: 1.15 }));
      layers.push(txt(`${idp}_lp${i}`, z++, legendX + legendW - pctW, ly, pctW, lh, `${pct}%`, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.021), font_weight: 700, color: accent, align: 'right' }));
    });
    return { layers, height: Math.max(2 * R, items.length * lh) };
  }
  // Native LINE / TREND — a polyline over labeled x points + a faint area fill +
  // dots + x-axis labels. Rasterizes (no foreignObject). For "growth/trend over time".
  if (kind === 'line' || kind === 'trend' || kind === 'area' || kind === 'timeseries' || kind === 'line_chart') {
    const items = arrField('items', 'rows', 'data', 'values', 'points', 'series');
    const valOf = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'] ?? it['amount'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const pts = items.map(it => ({ x: shStr(it['label'] ?? it['x'] ?? it['name'] ?? it['year']), y: valOf(it) }));
    if (pts.length >= 2) {
      const ys = pts.map(p => p.y), ymin = Math.min(...ys), ymax = Math.max(...ys), span = (ymax - ymin) || 1;
      const chartH = Math.round(W * 0.26), axisH = Math.round(W * 0.05), plotBot = y + chartH;
      const px = (i: number): number => x + (i / (pts.length - 1)) * w;
      const py = (v: number): number => plotBot - ((v - ymin) / span) * chartH;
      const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
      layers.push({ id: `${idp}_area`, type: 'path', z: z++, x, y, width: w, height: chartH, d: `${lineD} L ${px(pts.length - 1).toFixed(1)} ${plotBot} L ${px(0).toFixed(1)} ${plotBot} Z`, fill: { type: 'solid', color: accent }, opacity: 0.12 } as unknown as Layer);
      layers.push({ id: `${idp}_line`, type: 'path', z: z++, x, y, width: w, height: chartH, d: lineD, stroke: { color: accent, width: Math.max(3, Math.round(W * 0.005)) } } as unknown as Layer);
      const dotR = Math.round(W * 0.009), labW = Math.round(W * 0.12);
      pts.forEach((p, i) => {
        layers.push({ id: `${idp}_dot${i}`, type: 'ellipse', z: z++, x: px(i) - dotR, y: py(p.y) - dotR, width: 2 * dotR, height: 2 * dotR, fill: { type: 'solid', color: accent } } as unknown as Layer);
        if (p.x) { const lx = Math.max(x, Math.min(px(i) - labW / 2, x + w - labW)); layers.push(txt(`${idp}_lx${i}`, z++, lx, plotBot + 8, labW, axisH, p.x, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 600, color: muted, align: 'center', line_height: 1.1 })); }
      });
      return { layers, height: chartH + axisH + 8 };
    }
  }
  // Side-by-side COMPARISON — two option headers + attribute rows (label, A value,
  // B value) split by a center divider, each row measured so nothing overprints.
  // A blind model asked for an "X vs Y" hand-places a colliding table; this owns it.
  if (kind === 'versus' || kind === 'comparison' || kind === 'compare' || kind === 'vs' || kind === 'head_to_head') {
    const rows = arrField('rows', 'items', 'attributes', 'features', 'criteria', 'dimensions', 'aspects');
    if (!rows.length) return { layers, height: 0 };
    const opts = Array.isArray(b['options']) ? (b['options'] as unknown[]).map(o => shStr(o)) : [];
    const aName = shStr(b['a_label'] ?? b['left_label'] ?? b['option_a'] ?? b['title_a'] ?? b['a']) || opts[0] || 'Option A';
    const bName = shStr(b['b_label'] ?? b['right_label'] ?? b['option_b'] ?? b['title_b'] ?? b['b']) || opts[1] || 'Option B';
    const gap = Math.round(W * 0.03), colW = Math.round((w - gap) / 2);
    const leftX = x, rightX = x + colW + gap, midX = x + Math.round(w / 2);
    const aOf = (rw: Record<string, unknown>): string => shStr(rw['a'] ?? rw['left'] ?? rw['option_a'] ?? rw['a_value'] ?? rw['value_a'] ?? rw['first']);
    const bOf = (rw: Record<string, unknown>): string => shStr(rw['b'] ?? rw['right'] ?? rw['option_b'] ?? rw['b_value'] ?? rw['value_b'] ?? rw['second']);
    const labelOf = (rw: Record<string, unknown>): string => shStr(rw['label'] ?? rw['attribute'] ?? rw['feature'] ?? rw['criterion'] ?? rw['aspect'] ?? rw['name'] ?? rw['title']);
    let yy = y;
    const hSize = Math.round(W * 0.03);
    const headH = Math.max(estTextHeight(aName, hSize, colW, 1.1), estTextHeight(bName, hSize, colW, 1.1));
    layers.push(txt(`${idp}_ha`, z++, leftX, yy, colW, headH, aName, { font_size: hSize, font_weight: 800, color: accent, align: 'center', line_height: 1.1 }));
    layers.push(txt(`${idp}_hb`, z++, rightX, yy, colW, headH, bName, { font_size: hSize, font_weight: 800, color: text, align: 'center', line_height: 1.1 }));
    yy += headH + Math.round(W * 0.022);
    const rowsTop = yy;
    const lSize = Math.round(W * 0.017), vSize = Math.round(W * 0.022);
    rows.forEach((rw, i) => {
      const label = labelOf(rw), av = aOf(rw), bv = bOf(rw);
      const lH = label ? estTextHeight(label, lSize, w, 1.1) : 0;
      const vH = Math.max(estTextHeight(av || ' ', vSize, colW - 24, 1.3), estTextHeight(bv || ' ', vSize, colW - 24, 1.3));
      if (i > 0) layers.push({ id: `${idp}_sep${i}`, type: 'rect', z: z++, x, y: yy - Math.round(W * 0.013), width: w, height: 1, opacity: 0.22, fill: { type: 'solid', color: muted } } as unknown as Layer);
      if (label) layers.push(txt(`${idp}_rl${i}`, z++, x, yy, w, lH, label.toUpperCase(), { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 700, color: muted, letter_spacing: 1, align: 'center', line_height: 1.1 }));
      const vy = yy + (label ? lH + 6 : 0);
      layers.push(txt(`${idp}_ra${i}`, z++, leftX, vy, colW, vH, av, { font_size: vSize, font_weight: 600, color: text, align: 'center', line_height: 1.3 }));
      layers.push(txt(`${idp}_rb${i}`, z++, rightX, vy, colW, vH, bv, { font_size: vSize, font_weight: 600, color: text, align: 'center', line_height: 1.3 }));
      yy += lH + (label ? 6 : 0) + vH + Math.round(W * 0.026);
    });
    layers.push({ id: `${idp}_div`, type: 'rect', z: z0, x: midX - 1, y: rowsTop, width: 2, height: Math.max(0, yy - rowsTop - Math.round(W * 0.026)), opacity: 0.3, fill: { type: 'solid', color: accent } } as unknown as Layer);
    return { layers, height: Math.max(0, yy - y - Math.round(W * 0.026)) };
  }
  // TIMELINE / milestones — a left date column + a rail of node dots + event
  // title/desc to the right, each row measured. Rasterizes. For history / roadmap /
  // "the journey of X". Like flow but date-anchored (the date is the emphasis).
  if (kind === 'timeline' || kind === 'milestones' || kind === 'history' || kind === 'roadmap' || kind === 'chronology') {
    const items = arrField('items', 'milestones', 'events', 'entries', 'rows', 'points', 'stages', 'phases');
    if (!items.length) return { layers, height: 0 };
    const dateColW = Math.round(W * 0.15);
    const railX = x + dateColW + Math.round(W * 0.025);
    const nodeR = Math.round(W * 0.013);
    const textX = railX + Math.round(W * 0.04);
    const textW = w - (textX - x);
    const tSize = Math.round(W * 0.027), dSize = Math.round(W * 0.02), dateSize = Math.round(W * 0.024);
    const gap = Math.round(W * 0.032);
    const rows = items.map(it => {
      const date = shStr(it['date'] ?? it['year'] ?? it['time'] ?? it['when'] ?? it['label'] ?? it['phase']);
      const title = shStr(it['title'] ?? it['event'] ?? it['name'] ?? it['heading'] ?? it['milestone']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const tH = estTextHeight(title || ' ', tSize, textW, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, textW, 1.4) : 0;
      const rowH = Math.max(2 * nodeR, tH + (desc ? 6 + dH : 0));
      return { date, title, desc, tH, dH, rowH };
    });
    let yy = y;
    rows.forEach((row, i) => {
      const nodeCY = yy + Math.round(tSize * 0.55);
      if (i < rows.length - 1) {
        const nextCY = yy + row.rowH + gap + Math.round(tSize * 0.55);
        layers.push({ id: `${idp}_rail${i}`, type: 'rect', z: z++, x: railX - 2, y: nodeCY, width: 4, height: Math.max(0, nextCY - nodeCY), opacity: 0.32, fill: { type: 'solid', color: accent } } as unknown as Layer);
      }
      if (row.date) layers.push(txt(`${idp}_dt${i}`, z++, x, nodeCY - Math.round(dateSize * 0.62), dateColW, Math.round(dateSize * 1.4), row.date, { font_family: 'IBM Plex Mono', font_size: dateSize, font_weight: 800, color: accent, align: 'right', line_height: 1.0 }));
      layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: railX - nodeR, y: nodeCY - nodeR, width: 2 * nodeR, height: 2 * nodeR, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_tt${i}`, z++, textX, yy, textW, row.tH, row.title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (row.desc) layers.push(txt(`${idp}_td${i}`, z++, textX, yy + row.tH + 6, textW, row.dH, row.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += row.rowH + gap;
    });
    return { layers, height: Math.max(0, yy - y - gap) };
  }
  // PRICING / plans — N tier columns (name + big price + feature list), one tier
  // optionally highlighted (accent fill + POPULAR chip), all cards the same height.
  // Rasterizes. A blind model asked for pricing hand-places colliding columns; this
  // owns the grid. Features live on each tier item.
  if (kind === 'pricing' || kind === 'plans' || kind === 'tiers' || kind === 'price_table') {
    const tiersRaw = arrField('items', 'tiers', 'plans', 'options', 'rows', 'data', 'cards');
    if (!tiersRaw.length) return { layers, height: 0 };
    const list = tiersRaw.slice(0, 4);
    const n = list.length;
    const gap = Math.round(W * 0.025), colW = Math.round((w - (n - 1) * gap) / n), pad = Math.round(W * 0.022);
    const innerW = colW - 2 * pad;
    const nameSize = Math.round(W * 0.017), priceSize = Math.round(W * 0.046), perSize = Math.round(W * 0.016), featSize = Math.round(W * 0.0175);
    const td = list.map(t => {
      const name = shStr(t['name'] ?? t['title'] ?? t['tier'] ?? t['plan'] ?? t['label']);
      const price = shStr(t['price'] ?? t['cost'] ?? t['amount'] ?? t['value']);
      const period = shStr(t['period'] ?? t['unit'] ?? t['per'] ?? t['interval'] ?? t['cadence']);
      const fRaw = (Array.isArray(t['features']) ? t['features'] : Array.isArray(t['items']) ? t['items'] : Array.isArray(t['perks']) ? t['perks'] : Array.isArray(t['includes']) ? t['includes'] : []) as unknown[];
      const feats = fRaw.map(f => shStr(typeof f === 'object' && f ? ((f as Record<string, unknown>)['text'] ?? (f as Record<string, unknown>)['label'] ?? (f as Record<string, unknown>)['name']) : f)).filter(Boolean);
      const highlight = !!(t['highlight'] ?? t['featured'] ?? t['popular'] ?? t['recommended'] ?? t['best']);
      const featHs = feats.map(f => estTextHeight(f, featSize, innerW - 18, 1.3));
      const contentH = pad + (name ? nameSize + 14 : 0) + priceSize * 1.15 + (period ? perSize + 6 : 0) + 18 + featHs.reduce((a, b) => a + b + 11, 0) + pad;
      return { name, price, period, feats, featHs, highlight, contentH };
    });
    const cardH = Math.max(...td.map(t => t.contentH));
    list.forEach((_t, i) => {
      const t = td[i], cx = x + i * (colW + gap), hl = t.highlight;
      const cardText = hl ? readableOn(accent, bg) : text, cardMuted = hl ? readableOn(accent, bg) : muted;
      layers.push({ id: `${idp}_card${i}`, type: 'rect', z: z++, x: cx, y, width: colW, height: cardH, radius: 14, fill: { type: 'solid', color: hl ? accent : mixHex(bg, text, 0.06) }, ...(hl ? {} : { stroke: { color: mixHex(bg, text, 0.16), width: 1.5 } }) } as unknown as Layer);
      let cy = y + pad;
      if (t.name) { layers.push(txt(`${idp}_pn${i}`, z++, cx + pad, cy, innerW, nameSize + 6, t.name.toUpperCase(), { font_family: 'IBM Plex Mono', font_size: nameSize, font_weight: 700, color: hl ? cardText : accent, letter_spacing: 1.5 })); cy += nameSize + 14; }
      layers.push(txt(`${idp}_pp${i}`, z++, cx + pad, cy, innerW, priceSize * 1.15, t.price, { font_size: priceSize, font_weight: 800, color: cardText, line_height: 1.1 })); cy += priceSize * 1.15;
      if (t.period) { layers.push(txt(`${idp}_pper${i}`, z++, cx + pad, cy, innerW, perSize + 6, t.period, { font_size: perSize, font_weight: 500, color: cardMuted })); cy += perSize + 6; }
      cy += 18;
      t.feats.forEach((f, j) => {
        layers.push({ id: `${idp}_pdot${i}_${j}`, type: 'ellipse', z: z++, x: cx + pad, y: cy + 5, width: 7, height: 7, fill: { type: 'solid', color: hl ? cardText : accent } } as unknown as Layer);
        layers.push(txt(`${idp}_pf${i}_${j}`, z++, cx + pad + 16, cy, innerW - 18, t.featHs[j], f, { font_size: featSize, font_weight: 500, color: cardMuted, line_height: 1.3 }));
        cy += t.featHs[j] + 11;
      });
    });
    return { layers, height: cardH };
  }
  if (kind === 'caption' || kind === 'source' || kind === 'note' || kind === 'footnote' || kind === 'label') {
    // Small mono source/caption line (blind models pass the footer source as a
    // block like {kind:source}; render its text — never silently drop it).
    const t = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content'] ?? b['source'] ?? b['label']);
    if (!t) return { layers, height: 0 };
    const size = Math.round(W * 0.016);
    const th = estTextHeight(t, size, w, 1.3);
    layers.push(txt(`${idp}_cap`, z++, x, y, w, th, t, { font_family: 'IBM Plex Mono', font_size: size, font_weight: 500, color: muted, letter_spacing: 0.5 }));
    return { layers, height: th };
  }
  if (kind === 'divider' || kind === 'rule' || kind === 'hr' || kind === 'separator') {
    layers.push({ id: `${idp}_div`, type: 'rect', z: z++, x, y: y + Math.round(W * 0.01), width: w, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    return { layers, height: Math.round(W * 0.02) };
  }
  // Unknown kind that still carries text → render as body text rather than
  // dropping it to a blank rule (a blind model can't see the text vanish).
  const fallText = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content'] ?? b['title'] ?? b['heading']);
  if (fallText) {
    const size = Math.round(W * 0.0225);
    const th = estTextHeight(fallText, size, w, 1.5);
    layers.push(txt(`${idp}_t`, z++, x, y, w, th, fallText, { font_size: size, font_weight: 400, color: muted, line_height: 1.5 }));
    return { layers, height: th };
  }
  // Truly empty block → a thin rule.
  layers.push({ id: `${idp}_div`, type: 'rect', z: z++, x, y: y + Math.round(W * 0.01), width: w, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
  return { layers, height: Math.round(W * 0.02) };
}

// Weak models often emit ONE singular `{type:"stat", value, label}` block per
// figure instead of a single `{type:"stats", items:[…]}` row — the singular
// blocks then hit the unknown-kind fallback, which renders the value but DROPS
// the label (the g_oceans "8M / 91% / 30%" with no captions case). Fold any run
// of consecutive singular stat blocks into stats rows of up to 4 so they render
// as a proper figure row WITH labels. A no-op when no singular stats appear, so
// well-formed designs are untouched (same mood seed, same layout).
