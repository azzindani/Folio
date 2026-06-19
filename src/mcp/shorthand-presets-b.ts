// Folio shorthand parser — preset builders: list/stat/event/sections. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer } from '../schema/types';

import { hexToRgb, luminance } from './engine/reference';
import { pickSecLayout, pickEventLayout } from './engine/mood-bank';
import { shStr, asHex, contrastRatio, readableOn, readablePair, seededDefaults, ShorthandLayer, mixHex, defaultBgStyle, estTextHeight, fitTitleSize, shBox, txt, footerLayer, ListItem, SecCtx } from './shorthand-helpers';

import { renderSectionBlock } from './shorthand-sections';
import { composeBackground } from './shorthand-background';

export function readListItems(v: unknown): ListItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return {
      title: shStr(o['title'] ?? o['name'] ?? o['label'] ?? o['heading'] ?? (typeof it === 'string' ? it : '')),
      desc: shStr(o['desc'] ?? o['description'] ?? o['text'] ?? o['subtitle'] ?? o['body']),
      icon: shStr(o['icon']),
    };
  }).filter((i) => i.title || i.desc);
}

export function buildList(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const footer = shStr(r['footer']);
  const marker = shStr(r['marker'], 'number'); // number | bullet | icon | none
  const items = readListItems(r['items']);
  // Seed the mood from the list's own items when the model gave no bg.
  const m = seededDefaults(r, [title, kicker, items]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);

  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  // Did the carousel page-fill hand this list the full page rect (private
  // __fillPage marker)? Then FILL that height and center the content — a
  // content-sized group on a fixed slide left an empty lower band (the dead
  // "black strip" a carousel list slide showed). A poster list (even one the
  // model gave an explicit pos) still sizes to content so the doc auto-fits.
  const boxed = r['__fillPage'] === true;
  const M = Math.round(W * 0.08), cX = X + M, contentW = W - 2 * M;
  // Content is laid out into its own array first so the final height is known
  // before the background is composed (composeBackground must span the whole
  // page, not just the measured content).
  const content: Layer[] = [];
  const layers: Layer[] = [];
  let k = 1, cy = Y + Math.round(W * 0.085);

  if (kicker) {
    content.push(txt(`${id}_kick`, z + k++, cX, cy, contentW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += Math.round(W * 0.05);
  }
  if (title) {
    const ts = Math.round(W * 0.07), th = estTextHeight(title, ts, contentW, 1.04);
    content.push(txt(`${id}_title`, z + k++, cX, cy, contentW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04 }));
    cy += th + Math.round(W * 0.02);
    content.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: contentW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
    content.push({ id: `${id}_tick`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    cy += Math.round(W * 0.05);
  }

  const gutter = marker === 'none' ? 0 : Math.round(W * 0.085);
  const tX = cX + gutter, tW = contentW - gutter;
  const its = Math.round(W * 0.032), ds = Math.round(W * 0.0205), gapTD = Math.round(its * 0.4);
  const itemGap = Math.round(W * 0.03);     // fixed inter-item rhythm — content sizes the page
  items.forEach((it, i) => {
    const tH = estTextHeight(it.title, its, tW, 1.12);
    const dH = it.desc ? estTextHeight(it.desc, ds, tW, 1.4) : 0;
    if (marker === 'number') {
      const ms = Math.round(W * 0.042);
      content.push(txt(`${id}_n${i}`, z + k++, cX, cy - Math.round(ms * 0.08), gutter, ms * 1.3, String(i + 1).padStart(2, '0'), { font_size: ms, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -1 }));
    } else if (marker === 'bullet') {
      content.push({ id: `${id}_d${i}`, type: 'ellipse', z: z + k++, x: cX, y: Math.round(cy + tH * 0.28), width: Math.round(W * 0.018), height: Math.round(W * 0.018), fill: { type: 'solid', color: accent } } as unknown as Layer);
    } else if (marker === 'icon' && it.icon) {
      content.push({ id: `${id}_i${i}`, type: 'icon', z: z + k++, x: cX, y: Math.round(cy), width: Math.round(W * 0.05), height: Math.round(W * 0.05), icon: it.icon, color: accent } as unknown as Layer);
    }
    content.push(txt(`${id}_t${i}`, z + k++, tX, cy, tW, tH, it.title, { font_size: its, font_weight: 700, color: textColor, line_height: 1.12 }));
    if (it.desc) content.push(txt(`${id}_b${i}`, z + k++, tX, cy + tH + gapTD, tW, dH, it.desc, { font_size: ds, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += tH + (it.desc ? gapTD + dH : 0) + itemGap;
  });
  if (items.length) cy -= itemGap;          // drop the trailing gap after the last item

  if (footer) {
    cy += Math.round(W * 0.05);
    content.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: contentW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    cy += 14;
    content.push(footerLayer(`${id}_footer`, z + k++, cX, Math.round(cy), contentW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }, r));
    cy += 30;
  }

  // Natural content height (clamped sane). A boxless POSTER list uses this so the
  // canvas fits the content; a BOXED carousel page list FILLS the given page
  // height and centers the content block (no empty lower band / dead strip).
  const naturalH = Math.min(Math.round(W * 3.6), Math.max(Math.round(W * 0.5), Math.round(cy + W * 0.07 - Y)));
  const finalH = boxed ? Math.max(naturalH, H) : naturalH;
  const yOff = finalH > naturalH ? Math.round((finalH - naturalH) / 2) : 0;
  if (yOff) for (const l of content) { const ly = l as unknown as { y: number }; ly.y = ly.y + yOff; }
  // Compose a real background sized to the FULL page (texture/depth, not a flat
  // fill — buildList was the one preset that skipped this), then lay content on top.
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  content.forEach((l, i) => { (l as unknown as { z: number }).z = 30 + i; });
  layers.push(...bgLayers, ...content);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers } as unknown as Layer;
}

// Single-statistic focal poster — a huge dominant number (the ONE accent
// moment), a small kicker above, a one-line caption below, optional footer.
// Engine sizes the number to dominate and measures the caption, so the focal
// hierarchy is guaranteed. Removes the hand-placed big-number flail (the model
// can't see that its giant number overflowed or collided with the caption).

export function buildStat(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['label'] ?? r['eyebrow']);
  const stat = shStr(r['stat'] ?? r['value'] ?? r['number'] ?? r['title'] ?? r['text'], '0');
  const caption = shStr(r['caption'] ?? r['subtitle'] ?? r['desc'] ?? r['body'] ?? r['context'] ?? r['note'] ?? r['summary'] ?? r['lead'] ?? r['blurb'] ?? r['detail']);
  const footer = shStr(r['footer'] ?? r['source'] ?? r['credit']);
  // Seed the mood from the stat's caption when the model gave no bg (else every
  // stat poster is the same near-black + vermillion default).
  const m = seededDefaults(r, [caption, kicker, stat]);
  const bg = shStr(r['bg'], m?.bg ?? '#0A0A0A');
  const accent = shStr(r['accent'], m?.accent ?? '#FF3D00');
  // Caption + kicker + footer sit ON the bg. readablePair flips text to a legible
  // tone for the actual canvas — a vision-less model cannot see text vanish.
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const capColor = textColor;
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);

  // Size the number to dominate: fit-to-width, capped, never tiny.
  const len = Math.max(2, stat.replace(/\s/g, '').length);
  const numSize = Math.max(Math.round(W * 0.12), Math.min(Math.round(W * 0.42), Math.round(cW / (len * 0.58))));
  const numH = estTextHeight(stat, numSize, cW, 1.0);
  const capSize = Math.round(W * 0.034);
  const capH = caption ? estTextHeight(caption, capSize, cW, 1.4) : 0;
  const kickH = kicker ? Math.round(H * 0.045) : 0;
  const gap = Math.round(H * 0.028);
  const total = kickH + numH + (caption ? gap + capH : 0);
  let cy = Y + Math.max(Math.round(H * 0.16), (H - total) / 2 - Math.round(H * 0.03));
  let k = layers.length;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: muted, letter_spacing: 2, text_transform: 'uppercase' }));
    cy += kickH;
  }
  layers.push(txt(`${id}_stat`, z + k++, cX, cy, cW, numH, stat, { font_size: numSize, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -2, font_family: shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined }));
  cy += numH + (caption ? gap : 0);
  if (caption) {
    layers.push({ id: `${id}_caprule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - Math.round(gap * 0.4), width: Math.round(W * 0.13), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    layers.push(txt(`${id}_cap`, z + k++, cX, cy + 14, cW, capH, caption, { font_size: capSize, font_weight: 400, color: capColor, line_height: 1.4 }));
  }
  if (footer) {
    const fy = Y + H - Math.round(H * 0.07);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: cW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(footerLayer(`${id}_footer`, z + k++, cX, fy + 14, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }, r));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Event / flyer poster — a BIG auto-sized title, a stack of detail lines
// (date / venue / time) below it, optional engine-placed accent bars in the
// margin, footer. The whole block is vertically centered so it fills the canvas.
// Removes the hand-placed bold-poster flail (title collides with the details;
// decor lands invisible or scattered) — the blind model can't see any of that.
// A short, date-like detail line ("Sat July 18 · 8 PM", "June 15-16, 2026",
// "07/18") — the one the event poster should hero as a big accent moment instead
// of burying in the uniform mono stack. A month name or a numeric date pattern in
// a short line qualifies; a long sentence or a time-only line ("9:00 AM") does not.

export const EVENT_MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

export const EVENT_NUMDATE_RE = /\b\d{1,4}[\/.-]\d{1,2}(?:[\/.-]\d{1,4})?\b/;

export function isDateLine(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 34) return false;
  return EVENT_MONTH_RE.test(t) || EVENT_NUMDATE_RE.test(t);
}

export function readDetailLines(r: Record<string, unknown>): string[] {
  const d = r['details'] ?? r['lines'] ?? r['info'];
  if (Array.isArray(d)) return d.filter((x): x is string => typeof x === 'string');
  const out: string[] = [];
  for (const key of ['date', 'venue', 'location', 'place', 'time', 'when', 'where']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) out.push(v);
  }
  return out;
}

export function buildEvent(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text'], 'EVENT');
  const footer = shStr(r['footer']);
  const details = readDetailLines(r);
  // Seed the mood from the event's title/details when the model gave no bg.
  const m = seededDefaults(r, [title, kicker, details]);
  const bg = shStr(r['bg'], m?.bg ?? '#0A0A0A');
  const accent = shStr(r['accent'], m?.accent ?? '#FF3D00');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');

  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const bgHex = asHex(bg);
  // ── Structural variant — one of 4 distinct event skeletons (left-rail caps /
  // centered caps / left serif / centered serif), seeded from the title so two
  // event posters never share a shape. An explicit align: still overrides.
  const lay = pickEventLayout(`${title} ${kicker}`);
  const alignField = shStr(r['align'] ?? r['text_align']);
  const centered = alignField === 'center' || (alignField !== 'left' && lay.align === 'center');
  const serif = lay.serif;
  const rail = lay.rail && !centered;        // a left rail only reads under left-anchored text
  const halign = centered ? { align: 'center' as const } : {};
  // Serif variant: a mixed-case display serif headline (Playfair) instead of the
  // all-caps sans — the single biggest break from the "every event is CAPS" look.
  const titleFontResolved = shStr(r['font'] ?? r['font_family'], (serif ? 'Playfair Display' : (m?.font ?? ''))) || undefined;
  const titleCaps = !serif;
  // Decor bar colors must contrast the canvas (don't repeat the invisible-decor bug).
  const palRaw = (Array.isArray(r['palette']) ? r['palette'] : []).filter((c): c is string => typeof c === 'string');
  let bars = (palRaw.length ? palRaw : [accent]).filter(c => !bgHex || contrastRatio(c, bgHex) >= 1.5);
  if (!bars.length) bars = [contrastRatio(accent, bgHex ?? '#000') >= 1.5 ? accent : textColor];

  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette: palRaw, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  let k = layers.length;
  // Measure the centered content block (kicker + title + details). The title is
  // ALL-CAPS sans and the details ALL-CAPS mono — both wrap WIDER than the 0.54
  // default, so measure with caps-aware factors (0.60 / 0.66) to match the
  // renderer. Without this a title that wraps to 3 caps lines under-budgets and
  // the details overlap its last line (diagnose can't see inside the preset).
  // Shrink the (often very large) title so its longest word fits the width.
  const capsFactor = titleCaps ? 0.60 : 0.54;
  const ts = fitTitleSize(title, Math.round(W * (serif ? 0.135 : 0.15)), cW, titleFontResolved, titleCaps), titleH = estTextHeight(title, ts, cW, serif ? 1.05 : 1.0, capsFactor);
  // Hero the date — pull the first date-like line out of the stack and render it
  // big in the accent (the prominent "JULY 18" an event poster wants), leaving the
  // venue/meta lines in the calm mono stack below it.
  let heroDate = ''; const restDetails: string[] = [];
  for (const line of details) { if (!heroDate && isDateLine(line)) heroDate = line.trim(); else restDetails.push(line); }
  const hs = heroDate ? fitTitleSize(heroDate, Math.round(W * 0.062), cW, titleFontResolved, titleCaps) : 0;
  const heroH = heroDate ? estTextHeight(heroDate, hs, cW, 1.0, capsFactor) : 0;
  const heroGap = heroDate ? Math.round(H * 0.022) : 0;
  const ds = Math.round(W * 0.026), lineGap = Math.round(H * 0.012);
  const detailH = restDetails.reduce((a, l) => a + estTextHeight(l, ds, cW, 1.25, 0.66) + lineGap, 0);
  const kickH = kicker ? Math.round(H * 0.05) : 0;
  const ruleH = !rail ? Math.round(H * 0.028) : 0; // a rule replaces the rail's accent moment
  const total = kickH + titleH + ruleH + Math.round(H * 0.03) + heroH + heroGap + detailH;
  const top = Y + Math.max(Math.round(H * 0.12), (H - total) / 2 - Math.round(H * 0.02));

  // Variant 0 ONLY: accent bars in the far-left margin (the "left rail" look).
  // The other three variants carry their accent in a rule under the title instead,
  // so two event posters never share the rail-and-caps silhouette.
  if (rail) bars.slice(0, 3).forEach((c, i) => {
    layers.push({ id: `${id}_bar${i}`, type: 'rect', z: z + k++, x: Math.round(X + W * 0.018 + i * W * 0.022), y: Math.round(top + i * H * 0.03), width: Math.round(W * 0.012), height: Math.round((titleH + heroH + detailH) * (0.95 - i * 0.12)), fill: { type: 'solid', color: c } } as unknown as Layer);
  });

  const titleTransform = titleCaps ? { text_transform: 'uppercase' as const } : {};
  let cy = top;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: accent, letter_spacing: 2, text_transform: 'uppercase', ...halign }));
    cy += kickH;
  }
  layers.push(txt(`${id}_title`, z + k++, cX, cy, cW, titleH, title, { font_size: ts, font_weight: serif ? 700 : 800, color: textColor, line_height: serif ? 1.05 : 1.0, letter_spacing: serif ? 0 : -1, ...titleTransform, font_family: titleFontResolved, ...halign }));
  cy += titleH;
  if (ruleH) {
    // Accent rule under the title — centered under a centered headline, else a
    // short left-anchored tick. Gives the rail-less variants their accent beat.
    const rw = centered ? Math.round(W * 0.14) : Math.round(W * 0.1);
    const rx = centered ? cX + Math.round((cW - rw) / 2) : cX;
    layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: rx, y: Math.round(cy + H * 0.006), width: rw, height: serif ? 3 : 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
  }
  cy += ruleH + Math.round(H * 0.03);
  if (heroDate) {
    layers.push(txt(`${id}_hero`, z + k++, cX, cy, cW, heroH, heroDate, { font_size: hs, font_weight: serif ? 700 : 800, color: accent, line_height: 1.0, letter_spacing: serif ? 0 : -1, ...titleTransform, font_family: titleFontResolved, ...halign }));
    cy += heroH + heroGap;
  }
  restDetails.forEach((line, i) => {
    const lh = estTextHeight(line, ds, cW, 1.25, 0.66);
    // With a hero date carrying the accent, the meta lines stay calm; without one,
    // the last line keeps the accent highlight (often the date/CTA).
    const accentLine = !heroDate && i === restDetails.length - 1;
    layers.push(txt(`${id}_d${i}`, z + k++, cX, cy, cW, lh, line, { font_family: 'IBM Plex Mono', font_size: ds, font_weight: 600, color: accentLine ? accent : textColor, letter_spacing: 1, text_transform: 'uppercase', ...halign }));
    cy += lh + lineGap;
  });
  if (footer) {
    // Anchor the footer to the bottom margin, OR just below the detail stack when
    // long (wrapped) detail lines overran past it — never on top of it. A fixed
    // bottom y collided the footer with the last detail line (blind-30B: a "hosted
    // by…" footer printed over the "Free · All ages…" meta line).
    const fy = Math.max(Y + H - Math.round(H * 0.07), Math.round(cy) + lineGap);
    layers.push(footerLayer(`${id}_footer`, z + k++, cX, fy, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1, ...halign }, r));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Rich multi-section "infographic / report" poster. The blind-model unlock for
// CONTENT-DENSE, professional layouts: the model supplies an ordered list of
// typed blocks (heading · text · stats row · list · callout · quote · divider)
// and the engine MEASURES each and flows them top-to-bottom with editorial
// rhythm, an accent system, held margins and a footer — so a dense, organized,
// human-designer-level composition is one call instead of dozens of colliding
// hand-placed layers.

export function coalesceStatBlocks(blocks: Record<string, unknown>[]): Record<string, unknown>[] {
  const SINGULAR = new Set(['stat', 'metric', 'big_number', 'figure', 'kpi', 'number']);
  const out: Record<string, unknown>[] = [];
  let run: Record<string, unknown>[] = [];
  const flush = (): void => {
    for (let i = 0; i < run.length; i += 4) {
      out.push({ type: 'stats', items: run.slice(i, i + 4).map(b => ({
        value: b['value'] ?? b['stat'] ?? b['number'] ?? b['figure'] ?? b['title'],
        label: b['label'] ?? b['desc'] ?? b['text'] ?? b['caption'] ?? b['name'],
      })) });
    }
    run = [];
  };
  for (const b of blocks) {
    const k = shStr(b['kind'] ?? b['type']).toLowerCase();
    if (SINGULAR.has(k) && !Array.isArray(b['items'])) run.push(b);
    else { flush(); out.push(b); }
  }
  flush();
  return out;
}

export function buildSections(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H: boxH } = shBox(sh, 1080, 1920);
  // On a fixed carousel slide the page-fill stamps `__fillPage` + the page box:
  // FILL that height (bg spans the whole page, no unpainted strip) and vertically
  // CENTER the content (no top-heavy dead band). A poster keeps content-sizing.
  const fillPage = r['__fillPage'] === true && boxH > 0;
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline']);
  const subtitle = shStr(r['subtitle'] ?? r['deck'] ?? r['intro']);
  const footer = shStr(r['footer']);
  // Weak models sometimes DOUBLE-NEST blocks — `blocks:[[{block}],[{block}]]`,
  // each wrapped in its own array — which the renderer reads as an array-typed
  // "block" with no kind → every block renders empty (a near-blank poster).
  // Flatten one level so a nested block is treated as a normal block.
  const rawBlocks = (Array.isArray(r['blocks']) ? r['blocks'] : Array.isArray(r['sections']) ? r['sections'] : []) as unknown[];
  const flatBlocks = rawBlocks.flatMap(b => (Array.isArray(b) ? b : [b])) as Record<string, unknown>[];
  const blocks = coalesceStatBlocks(flatBlocks);
  // No bg from the model → seed a topic-apt mood from the content (the blind-
  // model "same template" fix), else everything falls to one cream default.
  const m = seededDefaults(r, [title, subtitle, kicker, blocks]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const ctx: SecCtx = { accent, text, muted, bg, W, palette };

  const M = Math.round(W * 0.075), cX = X + M, cW = W - 2 * M;

  // ── Typographic treatment — the per-style TITLE personality on top of the
  // color/geometry/font: 'highlight' (knockout marker chip), 'underline' (accent
  // swipe), 'mega' (oversized uppercase), 'rotate' (vertical magazine-spine
  // kicker), 'rule' (accent rule). Seeded from the mood so a vision-less model
  // gets a distinct type voice for free; an explicit field still overrides.
  const headlineStyle = shStr(r['headline_style'] ?? r['type_treatment'] ?? r['headline'], m?.headline ?? 'rule');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const mega = headlineStyle === 'mega';
  const rotateKick = headlineStyle === 'rotate' && !!kicker;
  // STRUCTURAL variant (decorrelated from colour): a centered keynote header vs
  // the left editorial default, and a 4-across vs 2-col stat grid — so two decks
  // in the same colour mood don't share a SHAPE (the "all designs are the same"
  // fix). A left-spine rotate layout is inherently left, so it opts out of center.
  const lay = pickSecLayout([title, subtitle, kicker].filter(Boolean).join(' ') || 'folio');
  const alignField = shStr(r['align'] ?? r['text_align']);
  const explicitCenter = alignField === 'center';
  // The keynote layout variant centers the HEADER as a cover-style masthead, but
  // the BODY (stats + heading/text blocks) stays left-anchored: a centered
  // masthead over a left-aligned body is a clean editorial pattern, whereas
  // centering the stat figures while the paragraphs below sit left makes the
  // figures float ~⅓-canvas off the body's left edge and reads as "unaligned"
  // (a blind model can't see it). Only an EXPLICIT align:center centers the body.
  const centered = !rotateKick && (explicitCenter || (alignField !== 'left' && lay.align === 'center'));
  ctx.align = explicitCenter ? 'center' : 'left';
  ctx.statCols = lay.statCols;
  const halign = centered ? { align: 'center' } : {};
  // MASTHEAD BAND archetype — a full-bleed colour slab behind the header with
  // reversed-out type (a magazine/report-cover silhouette). The single biggest
  // "this isn't the same template" cue: it restyles the whole top third without
  // touching the palette. INK slab = strong contrast to the canvas; ACCENT slab =
  // the accent itself. Header colours flip so they stay legible on the slab; the
  // highlight/underline/rule moments are suppressed (the band IS the treatment).
  const bgIsDark = ((): boolean => { const r = hexToRgb(asHex(bg) ?? '#FAF5EC'); return r ? luminance(r) < 0.45 : false; })();
  // The masthead band needs a header to reverse out — a model that passed only
  // blocks (no kicker/title/subtitle) would otherwise get an empty coloured stripe.
  const hasHeader = !!kicker || !!title || !!subtitle;
  const band = lay.header === 'band' && !rotateKick && hasHeader;
  const bandBg = band ? (lay.bandTone === 'ink' ? (bgIsDark ? '#F4F1EA' : '#17161B') : mixHex(accent, '#101012', 0.12)) : '';
  const bandText = band ? readableOn(bandBg, bg) : text;
  const kickColor = band ? (lay.bandTone === 'ink' ? accent : bandText) : accent;
  const titleColor = band ? bandText : text;
  const subColor = band ? mixHex(bandBg, bandText, 0.62) : muted;
  const tLH = 1.04;
  const gutter = rotateKick ? Math.round(W * 0.085) : 0;       // left clearance for the vertical spine
  const ccX = cX + gutter, ccW = cW - gutter;                  // content column (indented when a spine is present)
  const tsBase = mega ? Math.round(W * 0.094) : Math.round(W * 0.072);
  const ts = title ? fitTitleSize(title, tsBase, ccW, titleFont, mega) : tsBase;  // shrink so the longest word fits

  // Drop leading/trailing dividers (a rule at the very top/bottom is pointless
  // dead space — a common blind-model habit). Trim BEFORE measuring.
  const isDiv = (b: Record<string, unknown>): boolean => { const ki = shStr(b['kind'] ?? b['type']); return ki === 'divider' || ki === 'rule'; };
  const bl = blocks.slice();
  while (bl.length && isDiv(bl[0])) bl.shift();
  while (bl.length && isDiv(bl[bl.length - 1])) bl.pop();
  const heights = bl.map((b, i) => renderSectionBlock(b, `${id}_b${i}`, z, ccX, 0, ccW, ctx).height);
  const sumH = heights.reduce((a, h) => a + h, 0);
  const n = Math.max(1, bl.length);

  // ── Fit pass — size the CANVAS to the content, not the content to a fixed
  // canvas. Short content shrinks the page (no dead band below the last block);
  // long content grows it (no clipping past the bottom). Measure the header +
  // blocks first, then compose the background at this fitted height so the baked
  // sweep geometry (triangles, diagonals, waves) matches the page exactly.
  let hY = Math.round(W * 0.08);
  if (kicker && !rotateKick) hY += Math.round(headlineStyle === 'highlight' ? W * 0.052 : W * 0.045);
  if (title) hY += estTextHeight(title, ts, ccW, tLH, mega ? 0.66 : 0.54) + Math.round(W * 0.02) + (headlineStyle === 'underline' ? Math.round(W * 0.018) : 0);
  if (subtitle) hY += estTextHeight(subtitle, Math.round(W * 0.028), ccW, 1.45) + Math.round(W * 0.025);
  if (kicker || title || subtitle) hY += Math.round(W * 0.05);
  const footerBand = footer ? Math.round(W * 0.1) : Math.round(W * 0.06);
  const naturalH = hY + sumH + Math.round(W * 0.032) * Math.max(0, n - 1) + footerBand + Math.round(W * 0.04);
  // A page-fill slide is EXACTLY the page height (bg spans it → no strip); a
  // poster sizes to content. When the page is taller than the content, center the
  // whole composition (topPad) — unless a masthead band is present, which is a
  // top-anchored cover archetype whose slab is drawn at the page top.
  const H = fillPage ? boxH : Math.max(Math.round(W * 0.9), Math.min(Math.round(W * 3.4), naturalH));
  // Vertically center the whole composition whenever the canvas is taller than the
  // content — a fixed fill page (carousel) OR a thin POSTER floored at W*0.9 (a
  // single stat + caption that used to sit top-anchored with a dead band below).
  // The masthead slab is shifted by the same offset (below) so the band stays
  // aligned with its reversed-out header text. Dense content (H==naturalH) → 0.
  const topPad = H > naturalH ? Math.round((H - naturalH) * 0.42) : 0;

  // Rich engine-composed background when bg_style is set, else a flat wash.
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  // Lay the masthead slab over the composed wash, under the header text. Its
  // height is the pre-measure estimate `hY`; after the real header is laid we
  // shrink it to the actual header bottom (the estimate over-reserves ~W*0.05,
  // which showed as a dead colour band under the subtitle).
  const bandLayer = band
    ? ({ id: `${id}_mband`, type: 'rect', z: layers.length, x: X, y: Y + topPad, width: W, height: Math.round(hY), fill: { type: 'solid', color: bandBg } } as unknown as Layer)
    : null;
  if (bandLayer) layers.push(bandLayer);
  let k = layers.length, cy = Y + Math.round(W * 0.08) + topPad;

  // Vertical magazine-spine kicker (rotate): a -90° label pinned at the left
  // edge; the content column is already indented (gutter) to clear it. Built as a
  // raw layer because rotation is a LAYER prop, not a text-style field.
  if (rotateKick) {
    const kSize = Math.round(W * 0.019), kbw = Math.round(W * 0.34), kbh = Math.round(kSize * 1.8);
    const cxp = X + Math.round(W * 0.04), cyp = cy + Math.round(W * 0.18);
    layers.push({ id: `${id}_kick`, type: 'text', z: z + k++, x: Math.round(cxp - kbw / 2), y: Math.round(cyp - kbh / 2), width: kbw, height: kbh, rotation: -90,
      content: { type: 'plain', value: kicker }, style: { font_family: 'IBM Plex Mono', font_size: kSize, font_weight: 700, color: accent, letter_spacing: 3, text_transform: 'uppercase', align: 'center' } } as unknown as Layer);
  } else if (kicker && headlineStyle === 'highlight' && !band) {
    // Knockout marker chip — accent band, text in the canvas color.
    layers.push(txt(`${id}_kick`, z + k++, ccX, cy, ccW, 42, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 700, color: readableOn(accent, bg), letter_spacing: 2, text_transform: 'uppercase', highlight: accent, ...halign }));
    cy += Math.round(W * 0.052);
  } else if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, ccX, cy, ccW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: kickColor, letter_spacing: 2, text_transform: 'uppercase', ...halign }));
    cy += Math.round(W * 0.045);
  }
  if (title) {
    // Mega is uppercase and often falls back to a wider raster font than the
    // measured display font, so it wraps to MORE lines than the 0.54 estimate
    // predicts → the subtitle collided into it. Reserve with a wider factor.
    const th = estTextHeight(title, ts, ccW, tLH, mega ? 0.66 : 0.54);
    // highlight with no kicker → put the marker band on the TITLE itself (a
    // knockout headline) so the treatment is never dormant on a kicker-less deck.
    const titleHi = headlineStyle === 'highlight' && !kicker && !band;
    const titleStyle: Record<string, unknown> = { font_size: ts, font_weight: 800, color: titleHi ? readableOn(accent, bg) : titleColor, line_height: tLH, letter_spacing: mega ? -2 : -1, font_family: titleFont, ...halign };
    if (mega) titleStyle['text_transform'] = 'uppercase';
    if (titleHi) titleStyle['highlight'] = accent;
    layers.push(txt(`${id}_title`, z + k++, ccX, cy, ccW, th, title, titleStyle));
    cy += th + Math.round(W * 0.02);
    // Underline swipe — a thick accent bar directly beneath the title (centered
    // under a centered headline, else left-anchored).
    if (headlineStyle === 'underline' && !band) {
      const ulw = Math.min(ccW, Math.round(W * 0.32)), ulh = Math.max(7, Math.round(W * 0.013));
      const ulx = centered ? ccX + Math.round((ccW - ulw) / 2) : ccX;
      layers.push({ id: `${id}_ul`, type: 'rect', z: z + k++, x: ulx, y: Math.round(cy - W * 0.01), width: ulw, height: ulh, fill: { type: 'solid', color: accent } } as unknown as Layer);
      cy += Math.round(W * 0.012);
    }
  }
  if (subtitle) {
    const ss = Math.round(W * 0.028), sh2 = estTextHeight(subtitle, ss, ccW, 1.45);
    layers.push(txt(`${id}_sub`, z + k++, ccX, cy, ccW, sh2, subtitle, { font_size: ss, font_weight: 400, color: subColor, line_height: 1.45, ...halign }));
    cy += sh2 + Math.round(W * 0.025);
  }
  // Shrink the masthead slab to the real header bottom now that the header is
  // laid (cy = last header element + its trailing pad). `hY` over-reserved, so
  // the slab used to extend a dead band of flat colour below the subtitle.
  if (bandLayer) (bandLayer as unknown as Record<string, unknown>)['height'] = Math.max(Math.round(W * 0.12), Math.round(cy - (Y + topPad)));
  // A header rule belongs to the plain/mega/rotate treatments; highlight +
  // underline already carry their own accent moment, so a rule is redundant. The
  // masthead band already frames the header, so it suppresses the rule too.
  if ((kicker || title || subtitle) && !band && (headlineStyle === 'rule' || mega || headlineStyle === 'rotate')) {
    if (centered) {
      // A single short accent rule centered under the keynote header.
      const crw = Math.round(W * 0.16);
      layers.push({ id: `${id}_hr`, type: 'rect', z: z + k++, x: ccX + Math.round((ccW - crw) / 2), y: Math.round(cy), width: crw, height: mega ? 6 : 5, fill: { type: 'solid', color: accent } } as unknown as Layer);
    } else {
      layers.push({ id: `${id}_hr`, type: 'rect', z: z + k++, x: ccX, y: Math.round(cy), width: ccW, height: mega ? 4 : 3, fill: { type: 'solid', color: text } } as unknown as Layer);
      layers.push({ id: `${id}_htick`, type: 'rect', z: z + k++, x: ccX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    }
    cy += Math.round(W * 0.05);
  } else if (kicker || title || subtitle) {
    cy += Math.round(W * 0.03);
  }

  // The masthead band reserves the header zone (height hY). A band-mode header is
  // a touch shorter than that estimate (the rule is suppressed), so push the first
  // block clear of the band's bottom edge rather than letting its top tuck under it.
  if (band) cy = Math.max(cy, Y + topPad + Math.round(hY) + Math.round(W * 0.05));
  // Place blocks: distribute only the SMALL leftover slack in the fitted canvas
  // (floor keeps dense content tight, cap keeps a slightly-roomy page balanced).
  const footerH = footer ? Math.round(W * 0.1) : Math.round(W * 0.03);
  // Clip-safety cushion: the fill distribution below otherwise seats the LAST
  // block flush against the bottom edge (measured extent == box height exactly),
  // so any text-measurement drift in that block — a callout/body line that
  // resvg wraps one line longer than estTextHeight predicted — spills off the
  // canvas. Reserve a small band so the last block always lands just inside.
  const clipSafety = Math.round(W * 0.025);
  const avail = (Y + H - M - footerH - clipSafety) - cy;
  // When the composition is centered (topPad > 0, i.e. the canvas has slack), use
  // the NATURAL inter-block gap — matching the gap naturalH assumed — so the
  // centered block keeps its true height. A content-tight page (no slack) keeps
  // the original distribute-the-remainder behavior.
  const gap = topPad > 0
    ? Math.round(W * 0.032)
    : Math.max(Math.round(W * 0.024), Math.min(Math.round(W * 0.06), (avail - sumH) / n));
  bl.forEach((b, i) => {
    const out = renderSectionBlock(b, `${id}_b${i}`, z + k, ccX, cy, ccW, ctx);
    out.layers.forEach(l => layers.push(l));
    k += out.layers.length + 1;
    cy += heights[i] + gap;
  });

  if (footer) {
    const fy = Y + H - Math.round(W * 0.05);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: ccX, y: fy - 16, width: ccW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(footerLayer(`${id}_footer`, z + k++, ccX, fy, ccW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }, r));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// ── Main expansion function ─────────────────────────────────
// ── Decorative MOTIFS ─────────────────────────────────────────
// Composed, multi-primitive vector illustrations that fill the negative space a
// blind model leaves (big empty columns). Each draws into a box from rect/ellipse/
// path/line ONLY (rasterizes in PNG/PDF) using one accent color at varied OPACITY
// for depth — no color interpolation, so it is token-safe ($accent passes through
// to the resolver untouched). Returns absolute-coord layers; the caller wraps them
// in a group. Math.sin/cos only (deterministic — no Math.random/Date in render).
