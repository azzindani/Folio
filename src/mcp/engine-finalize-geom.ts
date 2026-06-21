// Folio MCP engine — finalization passes — geometry/dedup/preset stacking. Split from engine.ts; verbatim bodies.
import type { DesignSpec, Layer } from '../schema/types';

import { estTextHeight } from './shorthand-parser';

import { fontCharFactor } from './engine-finalize-text';
import { isDeliberatePosterRatio } from './poster-ratio';

export function collectLayerIds(spec: DesignSpec): Set<string> {
  const ids = new Set<string>();
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      if (l?.id) ids.add(l.id);
      const o = l as unknown as Record<string, unknown>;
      if (Array.isArray(o['layers'])) visit(o['layers'] as Layer[]);
      if (Array.isArray(o['tabs'])) for (const t of o['tabs'] as Record<string, unknown>[]) visit(t['layers'] as Layer[] | undefined);
      if (Array.isArray(o['items'])) for (const it of o['items'] as Record<string, unknown>[]) visit(it['layers'] as Layer[] | undefined);
    }
  };
  for (const p of spec.pages ?? []) visit(p.layers);
  visit(spec.layers);
  return ids;
}

/** Rename incoming ids that collide with `used` (and each other) so the design
 *  never grows duplicate ids — the corruption behind charts/selection breaking
 *  when separate add_layers batches each restart numbering (rect_1, text_2…). */

export function dedupeIncomingIds(incoming: Layer[], used: Set<string>): string[] {
  const renamed: string[] = [];
  for (const l of incoming) {
    if (!l?.id) continue;
    if (used.has(l.id)) {
      let n = 2, nid = `${l.id}-${n}`;
      while (used.has(nid)) nid = `${l.id}-${++n}`;
      renamed.push(`${l.id} → ${nid}`);
      l.id = nid;
    }
    used.add(l.id);
  }
  return renamed;
}

/** Fold tolerated field aliases to canonical names so the stored YAML is valid
 *  and renders everywhere. LLMs reach for the natural short name; the renderers
 *  read the schema name. Normalize on write so charts/callouts aren't silently
 *  blank. callout body: `text`→`content`; chart: `chart`→`chart_type`, and a
 *  STRING `x`/`y` (a field name, not a pixel position) → `x_field`/`y_field`. */

export function normalizeReportAliases(incoming: Layer[]): void {
  for (const l of incoming) {
    const o = l as unknown as Record<string, unknown>;
    if (l.type === 'callout' && o['content'] == null && o['text'] != null) {
      o['content'] = o['text'];
      delete o['text'];
    }
    if (l.type === 'interactive_chart') {
      if (o['chart_type'] == null && typeof o['chart'] === 'string') { o['chart_type'] = o['chart']; delete o['chart']; }
      if (o['chart_type'] == null && typeof o['kind'] === 'string') { o['chart_type'] = o['kind']; delete o['kind']; }
      if (o['x_field'] == null && typeof o['x'] === 'string') { o['x_field'] = o['x']; delete o['x']; }
      if (o['y_field'] == null && typeof o['y'] === 'string') { o['y_field'] = o['y']; delete o['y']; }
    }
    if (l.type === 'interactive_table' && Array.isArray(o['columns'])) {
      for (const col of o['columns'] as Record<string, unknown>[]) {
        if (col && col['title'] == null) {
          const alias = col['label'] ?? col['header'] ?? col['name'];
          if (alias != null) col['title'] = alias;
        }
      }
    }
  }
}

/** Fold a VERBOSE text layer's `text:"…"` alias + flat style shorthand
 *  (font/size/weight/color/lh/track) into the canonical { content:{type,value},
 *  style:{…} } the schema requires. The lenient editor renderer tolerates a bare
 *  `text` field, but the VALIDATOR + SVG/PDF export + the empty-slot/decollide
 *  passes (which read `content.value`) do NOT — so a model that hand-authors
 *  `{type:'text', text:'…', size:80, color:'#0A0A0A'}` (the blind-120B
 *  "website-redesign-timeline" blank: 9 such layers) fails export and reads as an
 *  empty slot. The shorthand path already normalizes this; this covers the verbose
 *  path. Recurses into group/auto_layout children. Returns the count normalized. */

export function normalizeTextAliases(incoming: Layer[]): number {
  let n = 0;
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      const o = l as unknown as Record<string, unknown>;
      if (l?.type === 'text') {
        const c = o['content'];
        const hasContent = typeof c === 'string'
          ? c !== ''
          : (c != null && typeof c === 'object' && String((c as Record<string, unknown>)['value'] ?? '') !== '');
        if (!hasContent && typeof o['text'] === 'string' && o['text'] !== '') {
          o['content'] = { type: 'plain', value: o['text'] };
          delete o['text'];
          n++;
        }
        // Lift flat style shorthand into `style`, then drop the top-level aliases
        // so the stored layer is canonical (and `size`/`color` can't shadow a
        // shape's own meaning downstream).
        const s = (o['style'] && typeof o['style'] === 'object' ? o['style'] : {}) as Record<string, unknown>;
        const lift = (from: string, to: string): void => { if (s[to] == null && o[from] != null) s[to] = o[from]; if (o[from] != null) delete o[from]; };
        lift('font', 'font_family'); lift('size', 'font_size'); lift('weight', 'font_weight');
        lift('color', 'color'); lift('lh', 'line_height'); lift('track', 'letter_spacing');
        if (Object.keys(s).length) o['style'] = s;
      }
      if (Array.isArray(o['layers'])) visit(o['layers'] as Layer[]);
    }
  };
  visit(incoming);
  return n;
}

// A poster whose real content fills only the TOP of an over-tall canvas strands a
// dead band of background below the last element: a flow preset that over-measured
// its own height (buildSections `naturalH` ≈ 1.8× the true extent — suite-113), or
// a sparse hand-placed poster (suite-112/115). Shrink the DOCUMENT to the true
// content extent + a bottom margin matching the top, and clamp full-canvas
// backdrops/groups to it. ONLY when the composition is clearly TOP-ANCHORED — a
// centered/balanced layout has a matching top gap and is left untouched. Measures
// MEANINGFUL leaves (text/icon/image) so a background wash or corner-decor shape
// never counts as content (conservative: under-trim is benign, over-trim clips).
// Returns the new height, or 0 if unchanged. Poster-only — never a fixed slide.
export function trimTrailingDeadBand(layers: Layer[], docW: number, docH: number): number {
  // Honor a DELIBERATE poster ratio (4:5, 9:16, 1:1, A4, …): a sparse 4:5 Instagram
  // post must STAY 4:5, not become a strip — its whitespace is the format the user
  // chose, not a dead band (honorPosterRatio's domain). Only rescue genuinely
  // mismatched / non-standard canvases the model picked by accident.
  if (isDeliberatePosterRatio(docW, docH)) return 0;
  let top = Infinity, bottom = -Infinity, found = false;
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      if (!l) continue;
      const kids = (l as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids)) { visit(kids as Layer[]); continue; }    // descend; the group box itself isn't content
      if (l.type !== 'text' && l.type !== 'icon' && l.type !== 'image') continue;
      if (l.type === 'text' && !layerText(l).trim()) continue;          // an empty text box isn't content
      const b = layerBBox(l);
      if (b.b <= b.y) continue;
      top = Math.min(top, b.y); bottom = Math.max(bottom, b.b); found = true;
    }
  };
  visit(layers);
  if (!found || bottom <= 0) return 0;
  const topGap = Math.max(0, top), bottomGap = docH - bottom;
  // Fire ONLY on genuinely TOP-ANCHORED content (a masthead/title near the top with
  // a dead band below). A centered/balanced layout — buildSections' `topPad` cover,
  // a deliberate minimalist poster — has a large top gap and is left entirely alone.
  if (topGap > docH * 0.15) return 0;
  if (bottomGap <= docH * 0.12) return 0;       // no meaningful dead band
  const margin = Math.max(topGap, Math.round(docW * 0.05));
  const newH = Math.round(bottom + margin);
  if (newH >= docH - Math.round(docH * 0.02)) return 0;  // negligible shrink
  // Clamp full-canvas backdrops + the full-bleed preset group (and its bg children)
  // so nothing declares a height past the trimmed page.
  const clamp = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      if (!l) continue;
      const o = l as unknown as Record<string, unknown>;
      const b = layerBBox(l);
      const fullCanvas = (b.r - b.x) >= docW * 0.9 && (b.b - b.y) >= docH * 0.9;
      if (fullCanvas && typeof o['height'] === 'number' && (o['height'] as number) > newH) o['height'] = newH;
      if (Array.isArray(o['layers'])) clamp(o['layers'] as Layer[]);
    }
  };
  clamp(layers);
  return newH;
}

// A model may hand-author a `group` at (gx,gy) and position its children in the
// group's LOCAL frame (child coords near 0), expecting the group origin to offset
// them. The engine treats group x/y as bounds only — children render at ABSOLUTE
// canvas coords (every shorthand/section template relies on this), so such a
// group's children collapse to the top-left and collide with whatever else is up
// there (the blind-model lightning poster: a y:250 column group printed over the
// y:100 headline). Detect the local-frame case — a child positioned BEFORE the
// group origin, which is impossible for genuinely-absolute children (they always
// sit at >= the origin) — and bake the offset into the whole subtree, then zero
// then shrink the group box to the children's true extent (NOT 0,0: a stale
// full-height box makes the downstream de-collide pass treat the whole upper
// canvas as occupied and shove a sibling headline far down).
// Processes innermost-first so nested relative frames compose correctly.

export function layerLeftTop(l: Layer): { x: number; y: number } {
  const o = l as unknown as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const xs = [num(o['x']), num(o['x1']), num(o['x2']), num(o['cx'])].filter((n): n is number => n !== undefined);
  const ys = [num(o['y']), num(o['y1']), num(o['y2']), num(o['cy'])].filter((n): n is number => n !== undefined);
  return { x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.min(...ys) : 0 };
}

export function bakeOffsetDeep(l: Layer, dx: number, dy: number): void {
  const o = l as unknown as Record<string, unknown>;
  for (const k of ['x', 'x1', 'x2', 'cx']) if (typeof o[k] === 'number') o[k] = (o[k] as number) + dx;
  for (const k of ['y', 'y1', 'y2', 'cy']) if (typeof o[k] === 'number') o[k] = (o[k] as number) + dy;
  const kids = o['layers'];
  if (Array.isArray(kids)) for (const k of kids) bakeOffsetDeep(k as Layer, dx, dy);
}

// Axis-aligned box of a layer in absolute coords (line endpoints, or x/y+size).

export function layerBBox(l: Layer): { x: number; y: number; r: number; b: number } {
  const o = l as unknown as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const x1 = n(o['x1']), y1 = n(o['y1']), x2 = n(o['x2']), y2 = n(o['y2']);
  if (x1 !== undefined && x2 !== undefined && y1 !== undefined && y2 !== undefined) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), r: Math.max(x1, x2), b: Math.max(y1, y2) };
  }
  const x = n(o['x']) ?? 0, y = n(o['y']) ?? 0, w = n(o['width']) ?? 0, h = n(o['height']) ?? 0;
  return { x, y, r: x + w, b: y + h };
}

// Plain string of a text layer's content (handles both `content: "str"` and
// `content: { value: "str" }`). Empty for non-text / missing content.

export function layerText(l: Layer): string {
  const c = (l as unknown as Record<string, unknown>)['content'];
  return typeof c === 'string' ? c : (c && typeof c === 'object' ? String((c as Record<string, unknown>)['value'] ?? '') : '');
}

// A layer the model (or the editor) marked `locked: true` asserts deliberate,
// authored placement + styling — the auto-rescue passes (reflow / re-measure /
// re-stack / re-center / re-light) must leave it ALONE. Opt-in, so it never
// changes the blind-model path (which never sets it). A locked GROUP locks its
// whole subtree (the rescue passes operate on top-level layers, so skipping the
// group already exempts its children).
export function isLocked(l: Layer): boolean {
  return (l as unknown as Record<string, unknown>)['locked'] === true;
}

export function flattenRelativeGroups(layers: Layer[]): number {
  let moved = 0;
  for (const l of layers) {
    const o = l as unknown as Record<string, unknown>;
    if (l?.type !== 'group' || !Array.isArray(o['layers']) || (o['layers'] as unknown[]).length === 0) continue;
    const kids = o['layers'] as Layer[];
    moved += flattenRelativeGroups(kids); // innermost-first
    const gx = typeof o['x'] === 'number' ? o['x'] : 0;
    const gy = typeof o['y'] === 'number' ? o['y'] : 0;
    if (gx === 0 && gy === 0) continue;
    // Strict `<`: an absolute child is never positioned before its group origin,
    // so this never false-fires on a real template (children at X+margin >= X).
    const local = kids.some(k => { const p = layerLeftTop(k); return p.x < gx || p.y < gy; });
    if (!local) continue;
    for (const k of kids) bakeOffsetDeep(k, gx, gy);
    // Re-fit the group box to the children's true extent so the de-collide pass
    // and any bounds logic see the real occupied region, not the old origin.
    let minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const k of kids) {
      const bb = layerBBox(k);
      minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
      maxR = Math.max(maxR, bb.r); maxB = Math.max(maxB, bb.b);
    }
    if (Number.isFinite(minX)) {
      o['x'] = minX; o['y'] = minY; o['width'] = maxR - minX; o['height'] = maxB - minY;
    }
    moved++;
  }
  return moved;
}

// A motif (meta.role==='motif') is a space-filling decoration — it exists to
// occupy DEAD space. On a full-width layout (versus/comparison, pricing, feature
// grid, a stat row) there is no open side column, so a model that followed the
// "add a motif to fill the side" directive drops it straight onto content: the
// arcs strike through the text. Collect the real content boxes, then remove any
// motif that overlaps them past a small threshold — a decoration that isn't in
// empty space has failed its only job, and dropping it beats a strikethrough.

export function isMotifLayer(l: Layer): boolean {
  const m = (l as unknown as Record<string, unknown>)['meta'];
  return !!m && (m as Record<string, unknown>)['role'] === 'motif';
}

export function collectContentBoxes(layers: Layer[], out: Array<{ x: number; y: number; r: number; b: number }>): void {
  for (const l of layers) {
    if (isMotifLayer(l)) continue; // a motif never counts as content it must avoid
    const o = l as unknown as Record<string, unknown>;
    if (l.type === 'group' && Array.isArray(o['layers'])) {
      collectContentBoxes(o['layers'] as Layer[], out);
      continue;
    }
    if (l.type === 'text' || l.type === 'chart' || l.type === 'image' ||
        l.type === 'kpi_card' || l.type === 'rich_text' || l.type === 'mermaid') {
      out.push(layerBBox(l));
    }
  }
}

// A model that hand-places a title/label can compute a position just past the
// canvas edge (e.g. a 1080-tall poster with its title at y:1095) — the layer
// then renders ENTIRELY off-canvas and its content is silently LOST (no error,
// no strikethrough, just gone). If a top-level content layer has zero overlap
// with the canvas, snap it back just inside the nearest edge so the text shows
// rather than vanishing. Only fires on layers with NO intersection at all — a
// bleeding/partly-visible decoration (motif, backdrop) is never touched.

export function snapOffCanvasContent(layers: Layer[], docW: number, docH: number): number {
  let snapped = 0;
  const mX = Math.round(docW * 0.03), mY = Math.round(docH * 0.03);
  const SNAPPABLE = new Set(['text', 'rich_text', 'image', 'group', 'chart', 'kpi_card', 'mermaid', 'icon']);
  for (const l of layers) {
    if (isMotifLayer(l) || !SNAPPABLE.has(l.type)) continue;
    const o = l as unknown as Record<string, unknown>;
    const bb = layerBBox(l);
    const w = bb.r - bb.x, h = bb.b - bb.y;
    if (w <= 0 || h <= 0 || w >= docW * 1.5 || h >= docH * 1.5) continue; // skip empty / bleed-sized
    const outX = bb.r <= 0 || bb.x >= docW;
    const outY = bb.b <= 0 || bb.y >= docH;
    if (!outX && !outY) continue; // overlaps the canvas → already visible
    let nx = bb.x, ny = bb.y;
    if (bb.r <= 0) nx = mX; else if (bb.x >= docW) nx = docW - w - mX;
    if (bb.b <= 0) ny = mY; else if (bb.y >= docH) ny = docH - h - mY;
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2) { p[0] = Math.round(nx); p[1] = Math.round(ny); }
    else { o['x'] = Math.round(nx); o['y'] = Math.round(ny); }
    snapped++;
  }
  return snapped;
}

export function dropCollidingMotifs(layers: Layer[]): number {
  const content: Array<{ x: number; y: number; r: number; b: number }> = [];
  collectContentBoxes(layers, content);
  if (!content.length) return 0;
  let dropped = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!isMotifLayer(layers[i])) continue;
    const m = layerBBox(layers[i]);
    const mArea = Math.max(1, (m.r - m.x) * (m.b - m.y));
    let overlap = 0;
    for (const c of content) {
      const ix = Math.max(0, Math.min(m.r, c.r) - Math.max(m.x, c.x));
      const iy = Math.max(0, Math.min(m.b, c.b) - Math.max(m.y, c.y));
      overlap += ix * iy;
    }
    if (overlap / mArea > 0.12) { layers.splice(i, 1); dropped++; }
  }
  return dropped;
}

// A top-level `type:chart` layer is a foreignObject (vega) — it renders BLANK in
// PNG/PDF/render_preview (resvg can't run a browser), so a model that builds a bar
// chart this way ships a poster with an empty hole where the data should be (live
// find: a "popular languages" poster = title + takeaway + a blank middle). When the
// chart is a simple BAR chart, draw it natively (rect bars + labels) so it shows in
// every export. Other chart marks (line/area/scatter) stay foreignObject for now.

export function rasterizeBarChartLayer(l: Layer): Layer | null {
  const o = l as unknown as Record<string, unknown>;
  if (o['type'] !== 'chart') return null;
  const spec = o['spec'] as Record<string, unknown> | undefined;
  const markRaw = spec?.['mark'] ?? o['chart_type'] ?? o['chartType'];
  const mark = typeof markRaw === 'string' ? markRaw.toLowerCase()
    : (markRaw && typeof markRaw === 'object' ? String((markRaw as Record<string, unknown>)['type'] ?? '').toLowerCase() : '');
  if (mark !== 'bar' && mark !== 'bars' && mark !== 'column') return null;
  const dv = (spec?.['data'] as Record<string, unknown> | undefined)?.['values'] ?? o['data'] ?? o['values'] ?? spec?.['values'];
  if (!Array.isArray(dv) || !dv.length) return null;
  const items = (dv as Record<string, unknown>[]).slice(0, 10).map(d => ({
    label: String(d['x'] ?? d['label'] ?? d['name'] ?? d['category'] ?? d['key'] ?? ''),
    value: Number(d['y'] ?? d['value'] ?? d['count'] ?? d['amount'] ?? 0),
  })).filter(it => it.label && Number.isFinite(it.value));
  if (items.length < 2) return null;
  const n = (v: unknown, dft: number): number => (typeof v === 'number' ? v : dft);
  const x = n(o['x'], 100), y = n(o['y'], 200), w = n(o['width'], 880), h = n(o['height'], 500);
  const max = Math.max(1, ...items.map(it => Math.abs(it.value)));
  const rowH = h / items.length, barH = Math.max(8, Math.round(rowH * 0.5));
  const labelW = Math.round(w * 0.26), valW = Math.round(w * 0.12);
  const trackX = x + labelW, trackW = Math.max(20, w - labelW - valW);
  const fs = Math.max(13, Math.min(28, Math.round(rowH * 0.3)));
  const cid = String(o['id'] ?? 'chart');
  const kids: Layer[] = [];
  let k = 0;
  items.forEach((it, i) => {
    const ry = Math.round(y + i * rowH + (rowH - barH) / 2);
    const bw = Math.max(4, Math.round(trackW * (Math.abs(it.value) / max)));
    kids.push({ id: `${cid}_l${i}`, type: 'text', z: k++, x, y: ry + Math.round((barH - fs) / 2) - 2, width: labelW - 12, height: barH + 6, content: { type: 'plain', value: it.label }, style: { font_size: fs, font_weight: 600, color: '$text', line_height: 1.1 } } as unknown as Layer);
    kids.push({ id: `${cid}_t${i}`, type: 'rect', z: k++, x: trackX, y: ry, width: trackW, height: barH, opacity: 0.14, fill: { type: 'solid', color: '$muted' }, radius: 4 } as unknown as Layer);
    kids.push({ id: `${cid}_b${i}`, type: 'rect', z: k++, x: trackX, y: ry, width: bw, height: barH, fill: { type: 'solid', color: '$accent' }, radius: 4 } as unknown as Layer);
    kids.push({ id: `${cid}_v${i}`, type: 'text', z: k++, x: trackX + bw + 8, y: ry + Math.round((barH - fs) / 2), width: valW + 40, height: barH, content: { type: 'plain', value: String(it.value) }, style: { font_family: 'IBM Plex Mono', font_size: fs, font_weight: 700, color: '$muted' } } as unknown as Layer);
  });
  return { id: cid, type: 'group', z: typeof o['z'] === 'number' ? (o['z'] as number) : 0, x, y, width: w, height: h, layers: kids } as unknown as Layer;
}

// A full-canvas OPAQUE content preset group (sections/feature_grid/editorial/…) —
// it paints its own background, so two of them at the origin fully cover each
// other. (decor/marble/backdrop presets and motifs are excluded — those are meant
// to show through.)

export const CONTENT_PRESET_RE = /^(feature_grid|sections|infographic|document|report_poster|editorial|stat|list|steps|event|flyer|hero|split|poster)([_-]|$)/;

export function isFullBleedContentPreset(l: Layer, docW: number, docH: number): boolean {
  const o = l as unknown as Record<string, unknown>;
  if (o['type'] !== 'group') return false;
  if (!CONTENT_PRESET_RE.test(String(o['id'] ?? ''))) return false;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0, w = Number(o['width']) || 0;
  return x <= docW * 0.02 && y <= docH * 0.04 && w >= docW * 0.9;
}

// All text tokens inside a preset group — used to tell a THRASH rebuild (the same
// poster re-stacked, ~identical content) from N DISTINCT sections a model stacked
// (a 3-section menu: Breakfast / Lunch / Drinks — different items each).

export function presetTokens(g: Layer): Set<string> {
  const out = new Set<string>();
  const walk = (ls: Layer[]): void => { for (const k of ls) { if (k.type === 'text') for (const t of layerText(k).toLowerCase().split(/[^a-z0-9$%]+/)) if (t.length >= 3) out.add(t); const kids = (k as unknown as Record<string, unknown>)['layers']; if (Array.isArray(kids)) walk(kids as Layer[]); } };
  const kids = (g as unknown as Record<string, unknown>)['layers'];
  if (Array.isArray(kids)) walk(kids as Layer[]);
  return out;
}

export function presetsSimilar(a: Layer, b: Layer): boolean {
  const ta = presetTokens(a), tb = presetTokens(b);
  if (ta.size < 2 || tb.size < 2) return true; // no real content to tell apart → treat as dup (old behavior)
  let shared = 0; for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

// A thrashing model rebuilds a poster several times → many full-canvas content
// presets STACKED at the origin (e.g. 8 feature_grids, de-duped to unique ids by
// the page-id/layer-id pass but still overlapping into an illegible mess). They're
// opaque and fully cover one another, so keep the LAST and drop the earlier ones —
// BUT only the ones whose content DUPLICATES a later preset (a true rebuild). A
// model that stacked N DISTINCT full-canvas sections (a 3-section menu) must NOT
// have 2 silently deleted as "dupes" — that loses whole sections of content.

export function dropStackedPresets(layers: Layer[], docW: number, docH: number): number {
  const idxs: number[] = [];
  layers.forEach((l, i) => { if (isFullBleedContentPreset(l, docW, docH)) idxs.push(i); });
  if (idxs.length < 2) return 0;
  const drop = new Set<number>();
  // Drop a preset only when a LATER stacked preset repeats its content (keep the
  // last of each duplicate group); distinct sections are all preserved.
  for (let a = 0; a < idxs.length; a++) {
    for (let b = a + 1; b < idxs.length; b++) {
      if (presetsSimilar(layers[idxs[a]], layers[idxs[b]])) { drop.add(idxs[a]); break; }
    }
  }
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A blind model handed a multi-section brief (intro + schedule + pricing) often
// emits 2+ DISTINCT full-bleed content presets — one per section — all pinned to
// the SAME full-canvas box, so they z-STACK and only the topmost renders: every
// earlier section (and any title beneath them) is silently invisible. By this
// point dropStackedPresets has removed true rebuild DUPLICATES, so the presets
// left here are distinct sections that must all be SEEN — re-seat each into its
// own vertical BAND down the page. A group applies NO render transform (renderGroup
// emits a bare <g>; its children carry ABSOLUTE doc coords), so banding means
// TRANSLATING the whole subtree, not just moving the group box — moving the box
// alone leaves every child where it was. Single posters only (carousels page these).

export function stackDistinctFullBleedPresets(layers: Layer[], doc: { width: number; height: number }, docW: number, docH: number): number {
  // Detect by full WIDTH only (NOT y): once a section has been re-seated into a
  // lower band, a y-gated check would stop seeing it, so a later add_layers call
  // would re-band fresh sections ON TOP of the stuck ones. Width-only detection
  // makes every pass re-derive the whole band layout from scratch — idempotent.
  const isSection = (l: Layer): boolean => {
    const o = l as unknown as Record<string, unknown>;
    if (o['type'] !== 'group' || !CONTENT_PRESET_RE.test(String(o['id'] ?? ''))) return false;
    const x = Number(o['x']) || 0, w = Number(o['width']) || 0;
    return x <= docW * 0.02 && w >= docW * 0.9;
  };
  const presets = layers.filter(isSection);
  if (presets.length < 2) return 0;
  const zOf = (l: Layer): number => { const z = (l as unknown as Record<string, unknown>)['z']; return typeof z === 'number' ? z : 0; };
  // Reading order = render order: stack the earliest-drawn (lowest z) section on top.
  presets.sort((a, b) => zOf(a) - zOf(b));
  const yOf = (l: Layer): number => { const o = l as unknown as Record<string, unknown>; const p = o['pos']; return (Array.isArray(p) && p.length >= 2) ? (Number(p[1]) || 0) : (Number(o['y']) || 0); };
  const setY = (l: Layer, y: number): void => { const o = l as unknown as Record<string, unknown>; const p = o['pos']; if (Array.isArray(p) && p.length >= 2) p[1] = y; else o['y'] = y; };
  // The preset's full-bleed background rect anchors the band top — decorations and
  // cards keep their offset relative to it, and reading it (not the unreliable group
  // box) keeps the pass idempotent across incremental re-bands.
  const bgTop = (g: Layer): number => {
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return yOf(g);
    const gw = Number((g as unknown as Record<string, unknown>)['width']) || docW, gh = Number((g as unknown as Record<string, unknown>)['height']) || docH;
    for (const k of kids as Layer[]) {
      if (k.type !== 'rect') continue;
      const b = layerBBox(k);
      if ((b.r - b.x) >= gw * 0.9 && (b.b - b.y) >= gh * 0.9) return b.y; // the full-canvas wash
    }
    return yOf(g);
  };
  // Translate a subtree's absolute y by delta. An auto_layout lays its children out
  // from its OWN y (their coords are recomputed at render), so shift the container
  // and STOP; every other node carries an absolute y to shift, recursing into groups.
  const shiftY = (l: Layer, d: number): void => {
    setY(l, yOf(l) + d);
    if ((l as unknown as Record<string, unknown>)['type'] === 'auto_layout') return;
    const kids = (l as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) shiftY(k, d);
  };
  // A full-canvas grid is built to fill a 1080 SQUARE, but a section often holds
  // only a heading + one short row of cards, so ~two thirds of each band is dead
  // space (the menu: Starters/Mains/Desserts each ~60% empty). Trim every band to
  // its real CONTENT extent — the heading text + the card auto_layout, NOT the
  // full-bleed wash/grain or the oversized corner motif — so the stacked brochure
  // reads tight instead of airy. Content-type children measure their own absolute
  // box; decorations are excluded from the extent and dropped if the trim leaves
  // them overflowing the smaller band.
  const CONTENT_TYPES = new Set(['text', 'rich_text', 'auto_layout', 'chart', 'kpi_card', 'mermaid', 'group', 'icon']);
  const contentExtent = (g: Layer): { top: number; bot: number } | null => {
    const kids = (g as unknown as Record<string, unknown>)['layers'];
    if (!Array.isArray(kids)) return null;
    let top = Infinity, bot = -Infinity;
    for (const k of kids as Layer[]) {
      if (!CONTENT_TYPES.has(k.type)) continue;
      const b = layerBBox(k);
      if (b.b <= b.y) continue;
      top = Math.min(top, b.y); bot = Math.max(bot, b.b);
    }
    return Number.isFinite(top) && bot > top ? { top, bot } : null;
  };
  const pad = Math.round(docW * 0.055);
  const gap = Math.round(docW * 0.018);
  const fontOf = (l: Layer): number => { const st = (l as unknown as Record<string, unknown>)['style'] as Record<string, unknown> | undefined; return st && typeof st['font_size'] === 'number' ? st['font_size'] as number : 16; };
  const textH = (l: Layer): number => {
    const o = l as unknown as Record<string, unknown>; const st = (o['style'] as Record<string, unknown>) ?? {};
    const fs = Number(st['font_size']) || Math.round(docW * 0.04), lh = Number(st['line_height']) || 1.3;
    const p = o['pos']; const w = Number(o['width']) || (Array.isArray(p) && p.length >= 3 ? Number(p[2]) : 0) || Math.round(docW * 0.84);
    const font = typeof st['font_family'] === 'string' ? st['font_family'] as string : '';
    return estTextHeight(layerText(l), fs, w, lh, fontCharFactor(font));
  };
  // Place a loose text centered at y; return its measured height.
  const seatCentered = (t: Layer, ty: number): number => {
    const o = t as unknown as Record<string, unknown>; const h = textH(t);
    const w = Number(o['width']) || Math.round(docW * 0.84);
    const nx = Math.max(0, Math.round((docW - w) / 2));
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2) { p[0] = nx; p[1] = ty; if (p.length >= 4) p[3] = h; } else { o['x'] = nx; o['y'] = ty; o['height'] = h; }
    const st = (o['style'] && typeof o['style'] === 'object') ? o['style'] as Record<string, unknown> : (o['style'] = {} as Record<string, unknown>);
    if (st['align'] == null) st['align'] = 'center';
    return h;
  };
  const bandBgHex = (g: Layer): string | null => {
    const kids = (g as unknown as Record<string, unknown>)['layers']; if (!Array.isArray(kids)) return null;
    for (const k of kids as Layer[]) { if (k.type !== 'rect') continue; const f = (k as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined; if (f && typeof f['color'] === 'string') return f['color'] as string; }
    return null;
  };
  const lumOf = (hex: string): number => { const h = (hex || '').replace('#', ''); if (h.length < 6) return 1; return (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255; };
  // Loose top-level text the model placed OUTSIDE the bands. SHORT lines (≤3 words)
  // are section HEADINGS the model stranded (wellness: "Daily Schedule"/"Pricing"
  // piled at the top, their bands left unlabelled); when exactly one such heading
  // exists per band, seat each ABOVE its band in reading order. Everything else (the
  // doc title, an intro) goes in a zone above the first band. The menu's lone "The
  // Olive Branch" has 0 short headings ≠ 2 bands → it simply tops the brochure.
  const looseText = layers.filter(l => l && l.type === 'text' && layerText(l).trim() && !presets.includes(l));
  const headings = looseText.filter(l => layerText(l).trim().split(/\s+/).filter(Boolean).length <= 3).sort((a, b) => yOf(a) - yOf(b));
  const assignHeads = headings.length === presets.length && headings.length >= 1;
  const bandHead: Layer[] = assignHeads ? headings : [];
  const topZone = assignHeads ? looseText.filter(l => !headings.includes(l)) : looseText;
  let cursorY = 0;
  if (topZone.length) {
    topZone.sort((a, b) => fontOf(b) - fontOf(a));     // title on top, tagline/intro below
    let ty = pad;
    for (const t of topZone) ty += seatCentered(t, ty) + gap;
    cursorY = ty + Math.round(docW * 0.02);
  }
  presets.forEach((g, gi) => {
    const o = g as unknown as Record<string, unknown>;
    const gW = Number(o['width']) || docW, gH = Number(o['height']) || docH;
    const head = bandHead[gi];
    const headH = head ? textH(head) : 0;
    const topReserve = pad + (head ? headH + gap : 0);  // band-top space (+ room for a heading)
    const ext = contentExtent(g);
    let bandH: number, delta: number;
    if (ext) {                                          // trim the band to heading + content + margins
      bandH = Math.round((ext.bot - ext.top) + topReserve + pad);
      delta = (cursorY + topReserve) - ext.top;
    } else {                                            // no measurable content → keep full band
      bandH = gH + (head ? headH + gap : 0);
      delta = cursorY + (head ? headH + gap : 0) - bgTop(g);
    }
    if (delta) shiftY(g, delta);                        // move the whole section into its band
    if (head) {                                         // seat the heading over the band, contrasting its wash
      seatCentered(head, cursorY + pad);
      const ho = head as unknown as Record<string, unknown>;
      ho['z'] = zOf(g) + 1;
      const bgHex = bandBgHex(g);
      if (bgHex) { const st = (ho['style'] as Record<string, unknown>) ?? (ho['style'] = {}); st['color'] = lumOf(bgHex) < 0.5 ? '#FAFAFA' : '#141414'; }
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) {
      const kept: Layer[] = [];
      for (const k of kids as Layer[]) {
        const ko = k as unknown as Record<string, unknown>;
        if (k.type === 'rect' && (Number(ko['width']) || 0) >= gW * 0.9) {  // bg / grain wash → span the band
          const p = ko['pos'];
          if (Array.isArray(p) && p.length >= 4) { p[1] = cursorY; p[3] = bandH; } else { ko['y'] = cursorY; ko['height'] = bandH; }
          kept.push(k); continue;
        }
        if (!CONTENT_TYPES.has(k.type)) {               // decoration sized for the old full band
          const b = layerBBox(k);
          if (b.b > cursorY + bandH + 2 || b.y < cursorY - 2) continue;     // overflows the trim → drop
        }
        kept.push(k);
      }
      o['layers'] = kept;
    }
    setY(g, cursorY);                                   // group box top = band top (bbox/inspect)
    if (Array.isArray(o['pos']) && (o['pos'] as unknown[]).length >= 4) (o['pos'] as unknown[])[3] = bandH; else o['height'] = bandH;
    cursorY += bandH;
  });
  // The page is now exactly the stacked bands — but never crop a top-level layer
  // (a hand-placed title sitting beside the first band) that reaches further down.
  let floor = cursorY;
  for (const l of layers) { if (presets.includes(l) || isFullCanvasBackdrop(l, docW, docH)) continue; floor = Math.max(floor, layerBBox(l).b); }
  doc.height = floor;
  const bg = layers.find(l => isFullCanvasBackdrop(l, docW, docH));
  if (bg) (bg as unknown as Record<string, unknown>)['height'] = floor; // base wash spans the whole page
  return presets.length;
}

// A full-canvas OPAQUE solid backdrop rect at the origin — the base wash a model
// lays down first. A clean page has exactly one; a thrashing rebuild re-adds it
// on every pass (8 stacked here). Gradient/noise overlays aren't counted (a legit
// layered background is base + gradient + grain → different fills, not dupes).

export function isFullCanvasBackdrop(l: Layer, docW: number, docH: number): boolean {
  if (l.type !== 'rect') return false;
  const fill = (l as unknown as Record<string, unknown>)['fill'] as Record<string, unknown> | undefined;
  if (!fill || fill['type'] !== 'solid') return false;
  const b = layerBBox(l);
  return b.x <= docW * 0.02 && b.y <= docH * 0.02 && (b.r - b.x) >= docW * 0.95 && (b.b - b.y) >= docH * 0.95;
}

// A thrashing model can rebuild a HAND-PLACED poster many times across add_layers
// calls — each pass re-adds the WHOLE composition (a full-canvas backdrop + every
// text/rect) without clearing, so the page piles up dozens of overlapping
// duplicates (here: 8 backdrops, 5 copies of each pricing tier). dropStackedPresets
// only sees preset GROUPS, not these loose layers. When several full-canvas
// backdrops AND a complete full-bleed content preset coexist — an unambiguous
// rebuild signal no clean design produces — the preset already holds the clean
// composition: keep it + one backdrop and drop the loose hand-placed duplicates.
// EXCEPT a hand-placed poster TITLE: it isn't redundant with the preset (whose
// header is usually empty), so dropping it would lose the title. Loose text is
// only dropped when it's REDUNDANT with the preset's own content (the pricing tier
// labels the grid already shows); unique loose text is kept for promoteCoveredTitle
// to surface. Loose shapes/rects are always structural junk the preset replaces.

export function dropThrashDuplicates(layers: Layer[], docW: number, docH: number): number {
  const backdropIdx = layers.map((l, i) => isFullCanvasBackdrop(l, docW, docH) ? i : -1).filter(i => i >= 0);
  const presetIdx = layers.map((l, i) => isFullBleedContentPreset(l, docW, docH) ? i : -1).filter(i => i >= 0);
  // Need the rebuild signal (≥3 stacked backdrops) AND a preset to fall back on.
  if (backdropIdx.length < 3 || presetIdx.length < 1) return 0;
  // Tokenize the preset's own text so we can tell redundant loose copies (tier
  // labels) from a unique title.
  const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9$%]+/).filter(t => t.length >= 3);
  const presetWords = new Set<string>();
  const collectText = (ls: Layer[]): void => { for (const k of ls) { if (k.type === 'text') tokens(layerText(k)).forEach(t => presetWords.add(t)); const kids = (k as unknown as Record<string, unknown>)['layers']; if (Array.isArray(kids)) collectText(kids as Layer[]); } };
  presetIdx.forEach(i => collectText([layers[i]]));
  const redundant = (l: Layer): boolean => { const t = tokens(layerText(l)); if (!t.length) return true; return t.filter(w => presetWords.has(w)).length / t.length >= 0.7; };
  const keep = new Set<number>([backdropIdx[backdropIdx.length - 1], ...presetIdx]);
  const SHAPE = new Set(['rect', 'line', 'ellipse', 'icon', 'path']);
  const drop = new Set<number>();
  layers.forEach((l, i) => {
    if (keep.has(i) || isMotifLayer(l)) return;
    if (SHAPE.has(l.type)) drop.add(i);                       // structural junk the preset replaces
    else if (l.type === 'text' && redundant(l)) drop.add(i);  // a duplicate of preset content (not the title)
  });
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A rebuild thrash that does NOT re-lay the backdrop (so the dup-backdrop gates
// miss it): the model re-adds the CHART/diagram group and a reworded CAPTION each
// pass, stacking three identical chart groups + two overlapping captions ("Chrome
// leads…" / "Chrome dominates…") that render as garbled overprint. Collapse two
// kinds of stacked duplicate: (1) groups sharing an id-base and box (the suffixed
// chart_3 / chart_3-2 / chart_3-3 rebuilds) → keep the last; (2) heavily
// overlapping NEAR-DUPLICATE text (same spot, ≥50% shared tokens — so two distinct
// labels that merely abut are never merged) → keep the last.

export function dedupOverlappingDuplicates(layers: Layer[], docW: number, docH: number): number {
  const drop = new Set<number>();
  const baseId = (l: Layer): string => String((l as unknown as Record<string, unknown>)['id'] ?? '').replace(/-\d+$/, '');
  const tol = Math.max(docW, docH) * 0.02;
  const sameBox = (a: Layer, b: Layer): boolean => {
    const A = layerBBox(a), B = layerBBox(b);
    return Math.abs(A.x - B.x) < tol && Math.abs(A.y - B.y) < tol && Math.abs((A.r - A.x) - (B.r - B.x)) < tol && Math.abs((A.b - A.y) - (B.b - B.y)) < tol;
  };
  // (1) stacked duplicate groups (same id-base + same box) — keep the last
  const groups = layers.map((l, i) => ({ l, i })).filter(x => x.l.type === 'group' && !isFullBleedContentPreset(x.l, docW, docH) && baseId(x.l));
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (baseId(groups[a].l) === baseId(groups[b].l) && sameBox(groups[a].l, groups[b].l)) drop.add(groups[a].i);
    }
  }
  // (2) heavily-overlapping near-duplicate text — keep the last
  const toks = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9$%]+/).filter(t => t.length >= 2);
  const similar = (a: Layer, b: Layer): boolean => {
    const ta = new Set(toks(layerText(a))), tb = toks(layerText(b));
    if (!ta.size || !tb.length) return false;
    return tb.filter(t => ta.has(t)).length / Math.max(ta.size, tb.length) >= 0.5;
  };
  const idOf = (l: Layer): string => String((l as unknown as Record<string, unknown>)['id'] ?? '');
  const norm = (l: Layer): string => layerText(l).toLowerCase().replace(/\s+/g, ' ').trim();
  const texts = layers.map((l, i) => ({ l, i })).filter(x => x.l.type === 'text' && layerText(x.l).trim());
  for (let a = 0; a < texts.length; a++) {
    if (drop.has(texts[a].i)) continue;
    for (let b = a + 1; b < texts.length; b++) {
      if (drop.has(texts[b].i)) continue;
      // Rename-twins: an id collision produced `X` + `X-2` (distinct ids, same
      // base). When the SAME line is re-placed across two add_layers calls the two
      // copies land at DIFFERENT y (a menu split into two offset ladders), so the
      // overlap test below misses them. If the base-id matches and the text is an
      // EXACT duplicate, drop the earlier — the `-2` suffix only exists because the
      // model reused the id, so one copy is always redundant. Keeps the last (the
      // model's most recent placement).
      const ba = baseId(texts[a].l);
      if (ba && ba === baseId(texts[b].l) && idOf(texts[a].l) !== idOf(texts[b].l)) {
        const na = norm(texts[a].l);
        if (na.length >= 3 && na === norm(texts[b].l)) { drop.add(texts[a].i); break; }
      }
      const A = layerBBox(texts[a].l), B = layerBBox(texts[b].l);
      const ox = Math.min(A.r, B.r) - Math.max(A.x, B.x), oy = Math.min(A.b, B.b) - Math.max(A.y, B.y);
      if (ox <= 0 || oy <= 0) continue;
      const inter = ox * oy, areaA = (A.r - A.x) * (A.b - A.y), areaB = (B.r - B.x) * (B.b - B.y);
      if (inter >= Math.min(areaA, areaB) * 0.6 && similar(texts[a].l, texts[b].l)) drop.add(texts[a].i);
    }
  }
  let removed = 0;
  for (let i = layers.length - 1; i >= 0; i--) { if (drop.has(i)) { layers.splice(i, 1); removed++; } }
  return removed;
}

// A model that hand-places a title + intro/tagline (or several bullets) sometimes
// gives them the SAME y — they render as an illegible overprint (the pizza recipe:
// "Classic Margherita Pizza" stamped over "A timeless Italian classic…"). These
// are DISTINCT top-level texts (different content, so dedup won't drop them) and
// decollideHandPlaced is switched off once a preset group is on the page. Cluster
// the top-level texts that heavily overlap each other and aren't near-duplicates,
// then re-stack each cluster vertically (largest font first) — clamped to stay on
// the canvas — so the pair reads as separate lines instead of one smear.
