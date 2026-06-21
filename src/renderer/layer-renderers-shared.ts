// Folio renderer — shared helpers used across the layer renderers (verbatim).
import type { Layer, TextLayer, AutoLayoutLayer, ColorOrGradient, TextContent, TextStyle } from '../schema/types';
import { createSVGElement, getOrCreateDefs } from './svg-utils';

import { resolveColorOrGradient } from './fill-renderer';

// Word-wrap plain text into lines that fit within maxWidth.
// Default char-width is ~0.52× font-size (accurate for Inter/sans-serif). Pass
// perCharPx to override for wider glyph runs — monospace, ALL-CAPS, and
// letter-spaced text are meaningfully wider, and the 0.52 estimate packs too
// many chars per line so the rendered line OVERFLOWS its box (e.g. a stat
// label "RENEWABLE CAPACITY ADDED…" bleeding into the next column).
export function wrapPlainText(text: string, maxWidth: number | undefined, fontSize: number, perCharPx?: number): string[] {
  const lines: string[] = [];
  const cw = perCharPx && perCharPx > 0 ? perCharPx : fontSize * 0.52;
  for (const para of text.split('\n')) {
    if (!maxWidth || maxWidth <= 0) { lines.push(para); continue; }
    const maxChars = Math.max(1, Math.floor(maxWidth / cw));
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      if (!cur) { cur = word; }
      else if ((cur + ' ' + word).length <= maxChars) { cur += ' ' + word; }
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

export function applyCommonAttributes(
  el: SVGElement,
  layer: Layer,
): void {
  el.setAttribute('data-layer-id', layer.id);

  // Build transform: flip (scale around center) then rotate
  const cx = (layer.x ?? 0) + ((typeof layer.width === 'number' ? layer.width : 0) / 2);
  const cy = (layer.y ?? 0) + ((typeof layer.height === 'number' ? layer.height : 0) / 2);
  const transforms: string[] = [];
  if (layer.flip_h || layer.flip_v) {
    const sx = layer.flip_h ? -1 : 1;
    const sy = layer.flip_v ? -1 : 1;
    transforms.push(`translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
  }
  if (layer.rotation) {
    transforms.push(`rotate(${layer.rotation} ${cx} ${cy})`);
  }
  if (transforms.length > 0) el.setAttribute('transform', transforms.join(' '));

  if (layer.visible === false) el.setAttribute('display', 'none');
  if (layer.opacity !== undefined) el.setAttribute('opacity', String(layer.opacity));
}

// A hand-placed shape may carry `stroke` as a bare color string (with the width
// in a sibling `stroke_width`/`strokeWidth`) — the natural verbose form — instead
// of the canonical {color, width} object the shorthand parser emits. Reading
// `.color`/`.type` off a string threw (→ the `⚠ type#id` error placeholder), so
// normalize either shape here. Returns null when there is no usable stroke.
export function normalizeStroke(
  layer: unknown,
): { color: ColorOrGradient; width: number; dash?: number[]; linecap?: string; linejoin?: string } | null {
  const o = layer as Record<string, unknown>;
  const s = o['stroke'];
  if (s == null) return null;
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : d;
  const sibling = o['stroke_width'] ?? o['strokeWidth'] ?? o['stroke-width'];
  if (typeof s === 'string') {
    return s.trim() ? { color: s, width: num(sibling, 1) } : null;
  }
  if (typeof s === 'object') {
    const so = s as Record<string, unknown>;
    if (so['color'] == null) return null; // malformed object → skip, don't crash
    return {
      color: so['color'] as ColorOrGradient,
      width: num(so['width'] ?? sibling, 1),
      dash: Array.isArray(so['dash']) ? (so['dash'] as number[]) : undefined,
      linecap: typeof so['linecap'] === 'string' ? (so['linecap'] as string) : undefined,
      linejoin: typeof so['linejoin'] === 'string' ? (so['linejoin'] as string) : undefined,
    };
  }
  return null;
}

export function applyStroke(el: SVGElement, stroke: { color: ColorOrGradient; width: number; dash?: number[]; linecap?: string; linejoin?: string } | string, svg?: SVGSVGElement): void {
  // Defensive: tolerate a bare string or a malformed object so a shape never
  // crashes the whole layer into the error placeholder.
  const s = typeof stroke === 'string' ? { color: stroke, width: 1 } : stroke;
  if (s == null || s.color == null) return;
  const strokeColor = typeof s.color === 'string'
    ? s.color
    : resolveColorOrGradient(s.color, getOrCreateDefs(svg ?? el.ownerSVGElement as SVGSVGElement));
  el.setAttribute('stroke', strokeColor);
  el.setAttribute('stroke-width', String(s.width));
  if (s.dash) {
    el.setAttribute('stroke-dasharray', s.dash.join(' '));
  }
  if (s.linecap) {
    el.setAttribute('stroke-linecap', s.linecap);
  }
  if (s.linejoin) {
    el.setAttribute('stroke-linejoin', s.linejoin);
  }
}

// Build an SVG path for a rect with per-corner radii (quarter-circle arcs)

export function roundedRectPath(x: number, y: number, w: number, h: number,
  r: { tl: number; tr: number; br: number; bl: number }): string {
  const { tl, tr, br, bl } = r;
  return [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`, `Q ${x + w} ${y} ${x + w} ${y + tr}`,
    `L ${x + w} ${y + h - br}`, `Q ${x + w} ${y + h} ${x + w - br} ${y + h}`,
    `L ${x + bl} ${y + h}`,    `Q ${x} ${y + h} ${x} ${y + h - bl}`,
    `L ${x} ${y + tl}`,        `Q ${x} ${y} ${x + tl} ${y}`, 'Z',
  ].join(' ');
}

// ── Rect ────────────────────────────────────────────────────

export function normalizeTextLayer(layer: TextLayer): { content: TextContent; style: NonNullable<TextLayer['style']> } {
  const o = layer as unknown as Record<string, unknown>;
  let content = o['content'] as TextContent | string | undefined | { value?: unknown };
  if (typeof content === 'string') content = { type: 'plain', value: content };
  else if (content == null) content = { type: 'plain', value: typeof o['text'] === 'string' ? o['text'] as string : '' };
  else if (typeof content === 'object' && !(content as { type?: unknown }).type) content = { type: 'plain', value: String((content as { value?: unknown }).value ?? '') };

  const s = { ...(layer.style ?? {}) } as Record<string, unknown>;
  if (s['font_family'] == null && o['font'] != null) s['font_family'] = o['font'];
  if (s['font_size'] == null && o['size'] != null) s['font_size'] = o['size'];
  if (s['font_weight'] == null && o['weight'] != null) s['font_weight'] = o['weight'];
  if (s['color'] == null && o['color'] != null) s['color'] = o['color'];
  if (s['line_height'] == null && o['lh'] != null) s['line_height'] = o['lh'];
  if (s['letter_spacing'] == null && o['track'] != null) s['letter_spacing'] = o['track'];
  return { content: content as TextContent, style: s as NonNullable<TextLayer['style']> };
}

// Apply CSS text-transform at the string level so it works in resvg too (resvg
// doesn't honor the CSS text-transform property on <text>).

export function transformText(v: string, mode?: TextStyle['text_transform']): string {
  if (mode === 'uppercase') return v.toUpperCase();
  if (mode === 'lowercase') return v.toLowerCase();
  if (mode === 'capitalize') return v.replace(/\b\p{L}/gu, c => c.toUpperCase());
  return v;
}

export function settingsString(f: Record<string, number> | string | undefined): string | undefined {
  if (!f) return undefined;
  if (typeof f === 'string') return f || undefined;
  const parts = Object.entries(f).map(([k, v]) => `"${k}" ${v}`);
  return parts.length ? parts.join(', ') : undefined;
}

// Set the advanced typographic attributes shared by plain & rich <text>:
// italic, word-spacing, variable-font axes, OpenType features, glyph outline.

export function applyTypography(textEl: SVGElement, style: TextStyle): void {
  if (style.font_style) textEl.setAttribute('font-style', style.font_style);
  if (style.word_spacing) textEl.setAttribute('word-spacing', `${style.word_spacing}px`);
  const fv = settingsString(style.font_variation_settings);
  if (fv) textEl.style.setProperty('font-variation-settings', fv);
  const ff = settingsString(style.font_feature_settings);
  if (ff) textEl.style.setProperty('font-feature-settings', ff);
  if (style.stroke && style.stroke.width > 0) {
    textEl.setAttribute('stroke', style.stroke.color);
    textEl.setAttribute('stroke-width', String(style.stroke.width));
    textEl.setAttribute('stroke-linejoin', 'round');
    textEl.setAttribute('paint-order', 'stroke'); // outline behind the fill
  }
}

export function normalizePadding(
  p: AutoLayoutLayer['padding'],
): { top: number; right: number; bottom: number; left: number } {
  if (p === undefined || p === null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return p;
}

// ── Helpers shared by report renderers ──────────────────────

export function makeForeignObject(
  layer: { x?: number; y?: number; width?: number | 'auto'; height?: number | 'auto'; id?: string },
  placeholderLabel: string,
  cssClass: string,
  extraStyle?: string,
): { fo: SVGElement; container: HTMLElement } {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = cssClass;
  container.style.cssText = `width:100%;height:100%;overflow:hidden;box-sizing:border-box;${extraStyle ?? ''}`;
  if (layer.id) container.dataset['layerId'] = layer.id;

  const placeholder = document.createElement('div');
  placeholder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  // A neutral styled card so static exports (PNG/PDF/SVG) don't show
  // the literal `[Chart: bar]` text. The interactive runtime replaces
  // this whole foreignObject's content once Plotly/Tabulator mount.
  placeholder.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:8px',
    'height:100%',
    'width:100%',
    'box-sizing:border-box',
    'background:rgba(128,128,160,0.06)',
    'border:1px dashed rgba(128,128,160,0.35)',
    'border-radius:8px',
    'color:rgba(128,128,160,0.85)',
    'font-family:Inter, sans-serif',
    'font-size:11px',
    'letter-spacing:0.06em',
    'text-transform:uppercase',
  ].join(';');
  // Strip the bracketed legacy label form, e.g. "[Chart: bar]" → "bar".
  const cleaned = placeholderLabel.replace(/^\[(.*?):\s*/, '').replace(/\]$/, '').trim();
  const icon = document.createElement('div');
  icon.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  icon.style.cssText = 'font-size:24px;line-height:1;opacity:0.7;';
  icon.textContent = '◧';
  const label = document.createElement('div');
  label.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  label.textContent = cleaned || placeholderLabel;
  placeholder.appendChild(icon);
  placeholder.appendChild(label);
  container.appendChild(placeholder);
  fo.appendChild(container);

  return { fo, container };
}

/** Be liberal in what we accept: LLMs author charts with `chart`/`kind` instead
 *  of chart_type, and a string `x`/`y` instead of x_field/y_field. Fold them so
 *  the preview isn't an empty box. (numeric x/y = pixel position, left alone.) */

export function escHtml(s: unknown): string {
  // Coerce defensively: component layers are author/LLM-authored and a missing
  // text field (undefined) must not throw `.replace of undefined` and crash the
  // whole render. Treat null/undefined as empty.
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Map (Leaflet) ────────────────────────────────────────────

export function foPreview(layer: Layer, w: number, h: number, inner: string): SVGElement {
  const fo = createSVGElement('foreignObject', {
    x: (layer as { x?: number }).x ?? 0,
    y: (layer as { y?: number }).y ?? 0,
    width: w, height: h,
  });
  const div = document.createElement('div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.style.cssText = 'width:100%;height:100%;box-sizing:border-box;font-family:Inter,system-ui,sans-serif;color:#e8e8ec;';
  div.innerHTML = inner;
  fo.appendChild(div);
  applyCommonAttributes(fo, layer);
  return fo;
}

export const numOr = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
