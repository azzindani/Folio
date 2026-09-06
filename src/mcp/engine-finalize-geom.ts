// Folio MCP engine — finalization passes — geometry/dedup/motif/margin. Split from engine.ts; verbatim bodies.
// Content-preset stacking + duplicate collapse split out to engine-finalize-presets.ts (700-line budget).
import type { DesignSpec, Layer } from '../schema/types';

import { isDeliberateCanvasRatio } from './poster-ratio';
import { FLAT_TEXT_STYLE_KEYS } from '../schema/validator';
import { specOf } from './design-spec';
import { rasterizeNonBarChartLayer } from './engine-finalize-charts';

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

/** Fold a group's `children:[…]` alias into the canonical `layers:[…]`.
 *
 *  `children` is the word almost every scene graph uses, so a model hand-authoring
 *  a group reaches for it — and the schema's key is `layers`. Nothing read the
 *  alias: add_layers wrote it to disk verbatim and answered `success: true,
 *  added: 1`, findDeep (layer-lookup) descends `layers` only so every child was
 *  "Layer not found", inspect listed the group with no children, diagnose_design
 *  reported zero errors, and the renderer drew a dashed `⚠ group#id` placeholder
 *  where the content should have been. Measured live: a 2-layer group came back
 *  as an empty box, and the reply's next_action advised calling seal_design.
 *
 *  Folding beats rejecting (§0.4 — support the model's own authoring), and it
 *  must run BEFORE flattenRelativeGroups and every other pass that recurses, all
 *  of which look for `layers`. Both keys populated is not a shape a model
 *  actually sends; if it happens the alias is appended rather than dropped,
 *  because losing content is the failure being fixed. Returns the count folded. */
export function normalizeGroupChildren(incoming: Layer[]): number {
  let n = 0;
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      const o = l as unknown as Record<string, unknown>;
      const alias = o['children'];
      if ((l?.type === 'group' || l?.type === 'auto_layout') && Array.isArray(alias) && alias.length) {
        const own = Array.isArray(o['layers']) ? (o['layers'] as Layer[]) : [];
        o['layers'] = own.length ? [...own, ...(alias as Layer[])] : (alias as Layer[]);
        delete o['children'];
        n++;
      }
      if (Array.isArray(o['layers'])) visit(o['layers'] as Layer[]);
    }
  };
  visit(incoming);
  return n;
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
        // LLMs frequently emit a literal backslash-n inside a YAML plain or
        // single-quoted scalar (where \n is two chars, NOT a newline) when they
        // mean a line break — it then renders verbatim ("9TH\nBYOB", suite-001).
        // De-escape to the real control char so the line splitter (renderer +
        // text-measure both split on '\n') breaks it correctly. Idempotent.
        const cv = o['content'];
        if (typeof cv === 'string' && /\\[nrt]/.test(cv)) {
          o['content'] = deEscapeText(cv); n++;
        } else if (cv && typeof cv === 'object') {
          const obj = cv as Record<string, unknown>;
          if (typeof obj['value'] === 'string' && /\\[nrt]/.test(obj['value'])) {
            obj['value'] = deEscapeText(obj['value']); n++;
          }
        }
        // Lift flat style shorthand into `style`, then drop the top-level aliases
        // so the stored layer is canonical (and `size`/`color` can't shadow a
        // shape's own meaning downstream).
        const s = (o['style'] && typeof o['style'] === 'object' ? o['style'] : {}) as Record<string, unknown>;
        const lift = (from: string, to: string): void => { if (s[to] == null && o[from] != null) s[to] = o[from]; if (o[from] != null) delete o[from]; };
        lift('font', 'font_family'); lift('size', 'font_size'); lift('weight', 'font_weight');
        lift('color', 'color'); lift('lh', 'line_height'); lift('track', 'letter_spacing');
        // …and the CANONICAL names when they sit at layer level too. diagnose
        // warns about sixteen such fields; this used to fix six, so a model that
        // wrote `align:"center"` on a text layer got a warning about something
        // the engine could simply have put in the right place. Observed four
        // times in one deck from a real harness run. Same list the warning is
        // generated from, so the two cannot drift apart.
        for (const key of FLAT_TEXT_STYLE_KEYS) lift(key, key);
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
  // Honor a DELIBERATE canvas ratio (4:5, 9:16, 1:1, A4, 16:9, 3:2, …) in EITHER
  // orientation: a sparse 4:5 Instagram post must STAY 4:5, not become a strip —
  // its whitespace is the format the user chose, not a dead band. The same holds
  // LANDSCAPE: a 3840×2160 conference poster composed over several add_layers
  // calls looks top-anchored while the lower columns are still on their way, and
  // trimming it mid-compose collapsed the canvas to the height of its header.
  // Only rescue genuinely mismatched / non-standard canvases picked by accident.
  if (isDeliberateCanvasRatio(docW, docH)) return 0;
  let top = Infinity, bottom = -Infinity, found = false;
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      if (!l) continue;
      const kids = (l as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids)) { visit(kids as Layer[]); continue; }    // descend; the group box itself isn't content
      // Count text/icon/image AND backing shapes (cards, panels, bands) toward the
      // content extent: a card grid's bottom row is defined by the card RECTS, not
      // their text, so a text-only measure trimmed the canvas straight through the
      // bottom cards (clipping their rounded corners).
      const ct = l.type;
      const isContent = ct === 'text' || ct === 'icon' || ct === 'image'
        || ct === 'rect' || ct === 'circle' || ct === 'ellipse' || ct === 'path' || ct === 'polygon';
      if (!isContent) continue;
      if (ct === 'text' && !layerText(l).trim()) continue;              // an empty text box isn't content
      const b = layerBBox(l);
      if (b.b <= b.y) continue;
      // a full-canvas backdrop shape is BACKGROUND, not content extent — skip it, else
      // `bottom` is always the page height and nothing ever trims.
      if (ct !== 'text' && ct !== 'icon' && ct !== 'image'
        && (b.r - b.x) >= docW * 0.9 && (b.b - b.y) >= docH * 0.9) continue;
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

// Convert LLM-emitted literal escape sequences (backslash-n/r/t written as two
// characters in a non-double-quoted YAML scalar) into real control chars. Only
// \n \r \t — never touches other backslashes (a deliberate "\d" stays intact).
export function deEscapeText(s: string): string {
  return s.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\\t/g, ' ');
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
    // A PRESET group needs no guessing: the engine built it, and it always
    // emits absolute child coordinates. The heuristic below exists for
    // hand-authored and template groups, where the convention is genuinely
    // unknown — applied to a preset it is not a guess but a mistake.
    //
    // It was latent until something placed a preset off the origin. Several
    // presets put a decorative element ABOVE their own box (`stat` has a glow at
    // y=-146), which is exactly the signal the heuristic reads as "these are
    // relative", so the offset got baked and every coordinate doubled: a preset
    // at x=990 rendered at 1980, right off a 1920 canvas. At x=0/y=0 the early
    // return below hid it, and until `columns` nothing put a preset anywhere
    // else.
    if (specOf(l)) continue;
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

// A blind model often drops its FIRST hand-placed text at y:0 — flush against the
// canvas top, so the title's ascenders clip and the poster reads cramped (no human
// designer starts a headline at the very edge). When the topmost CONTENT sits within
// docH*0.025 of the top AND the composition is sparse enough to have room below,
// translate the whole content block down so the top clears a docH*0.05 margin —
// relative spacing is preserved (a pure vertical shift). Skips preset/group layouts
// (they own their internal margins) and dense layouts (no room → would clip the
// bottom). Only ever ADDS breathing room; never removes it.
export function ensureTopMargin(layers: Layer[], docW: number, docH: number): number {
  if (!(docW > 0) || !(docH > 0)) return 0;
  // Hand-placed only — a single preset/group container owns its own margins.
  if (layers.some(l => l?.type === 'group' || l?.type === 'auto_layout')) return 0;
  const isBg = (l: Layer): boolean => {
    const b = layerBBox(l);
    return (l.type === 'rect' || l.type === 'image') && (b.r - b.x) >= docW * 0.9 && (b.b - b.y) >= docH * 0.9;
  };
  const CONTENT = new Set(['text', 'rich_text', 'image', 'icon', 'kpi_card', 'chart', 'mermaid']);
  const shiftable = layers.filter(l => l && !isBg(l) && !isMotifLayer(l) && !isLocked(l));
  if (!shiftable.length) return 0;
  // Measure the top/bottom from real CONTENT only — a degenerate decoration parked
  // at (0,0) must not drive the margin or it over-shifts content that already clears.
  let minY = Infinity, maxB = -Infinity;
  for (const l of shiftable) {
    if (!CONTENT.has(l.type)) continue;
    const b = layerBBox(l);
    if (b.r - b.x <= 0 || b.b - b.y <= 0) continue;
    minY = Math.min(minY, b.y); maxB = Math.max(maxB, b.b);
  }
  if (!Number.isFinite(minY)) return 0;
  if (minY >= Math.round(docH * 0.025)) return 0;          // already has a top margin
  const shift = Math.round(docH * 0.05) - minY;
  if (shift <= 0) return 0;
  if (maxB + shift > docH * 0.98) return 0;                // no room — would push content off the bottom
  let moved = 0;
  for (const l of shiftable) {
    const o = l as unknown as Record<string, unknown>;
    const p = o['pos'];
    if (Array.isArray(p) && p.length >= 2 && typeof p[1] === 'number') { p[1] = Math.round((p[1] as number) + shift); moved++; continue; }
    if (typeof o['y1'] === 'number' && typeof o['y2'] === 'number') { o['y1'] = Math.round((o['y1'] as number) + shift); o['y2'] = Math.round((o['y2'] as number) + shift); moved++; continue; }
    if (typeof o['y'] === 'number') { o['y'] = Math.round((o['y'] as number) + shift); moved++; }
  }
  return moved;
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
  // Model-supplied colors win (a frontier dashboard sets the palette); else theme
  // tokens. The data VALUE defaults to $text, not $muted — a muted value is the
  // most-important number rendered illegibly, and on a hand-set canvas it re-lights
  // to a clashing color.
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  const barColor = str(o['bar_color']) ?? '$accent';
  const trackColor = str(o['track_color']) ?? '$muted';
  const labelColor = str(o['label_color']) ?? '$text';
  const valueColor = str(o['value_color']) ?? labelColor;
  const cid = String(o['id'] ?? 'chart');
  const kids: Layer[] = [];
  let k = 0;
  items.forEach((it, i) => {
    const ry = Math.round(y + i * rowH + (rowH - barH) / 2);
    const bw = Math.max(4, Math.round(trackW * (Math.abs(it.value) / max)));
    kids.push({ id: `${cid}_l${i}`, type: 'text', z: k++, x, y: ry + Math.round((barH - fs) / 2) - 2, width: labelW - 12, height: barH + 6, content: { type: 'plain', value: it.label }, style: { font_size: fs, font_weight: 600, color: labelColor, line_height: 1.1 } } as unknown as Layer);
    kids.push({ id: `${cid}_t${i}`, type: 'rect', z: k++, x: trackX, y: ry, width: trackW, height: barH, opacity: 0.14, fill: { type: 'solid', color: trackColor }, radius: 4 } as unknown as Layer);
    kids.push({ id: `${cid}_b${i}`, type: 'rect', z: k++, x: trackX, y: ry, width: bw, height: barH, fill: { type: 'solid', color: barColor }, radius: 4 } as unknown as Layer);
    kids.push({ id: `${cid}_v${i}`, type: 'text', z: k++, x: trackX + bw + 8, y: ry + Math.round((barH - fs) / 2), width: valW + 40, height: barH, content: { type: 'plain', value: String(it.value) }, style: { font_family: 'IBM Plex Mono', font_size: fs, font_weight: 700, color: valueColor } } as unknown as Layer);
  });
  return { id: cid, type: 'group', z: typeof o['z'] === 'number' ? (o['z'] as number) : 0, x, y, width: w, height: h, layers: kids } as unknown as Layer;
}

// Rasterize every bar chart in the tree — including ones nested inside a group or
// auto_layout — so a grouped/locked dashboard's charts aren't blank in PNG/PDF.
// Rasterization is a RENDER-FIDELITY transform (foreignObject → rects), not a
// layout rescue, so it must reach into containers the finalize passes otherwise
// skip. Group children already carry absolute coords, so the nested chart's x/y
// rasterize correctly in place.
export function rasterizeChartsDeep(layers: Layer[]): number {
  let n = 0;
  for (let i = 0; i < layers.length; i++) {
    const native = rasterizeBarChartLayer(layers[i]) ?? rasterizeNonBarChartLayer(layers[i]);
    if (native) { layers[i] = native; n++; continue; }
    const kids = (layers[i] as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids)) n += rasterizeChartsDeep(kids as Layer[]);
  }
  return n;
}
