import type {
  Layer, RectLayer, CircleLayer, PathLayer, PolygonLayer,
  LineLayer, TextLayer, ImageLayer, IconLayer,
  MermaidLayer, ChartLayer, CodeLayer, MathLayer, GroupLayer,
  QRCodeLayer, AutoLayoutLayer, ColorOrGradient,
  InteractiveChartLayer, InteractiveTableLayer, RichTextLayer,
  KpiCardLayer, MapLayer, EmbedCodeLayer, PopupLayer, ParticleLayer,
  ButtonLayer, TabsLayer, AccordionLayer, FilterBarLayer, ToggleLayer,
  TooltipLayer, CalloutLayer, ProgressLayer, TextContent,
} from '../schema/types';
import { createSVGElement, getOrCreateDefs } from './svg-utils';
import { getPreviewRows, getPreviewAccent } from './render-context';
import { applyFill, resolveColorOrGradient } from './fill-renderer';
import { applyEffects } from './effects-renderer';
import { LUCIDE_ICONS, resolveIconName } from './lucide-icons';
import { encodeQR } from './qr/encode';

// Word-wrap plain text into lines that fit within maxWidth.
// Uses a ~0.52× font-size char-width estimate (accurate for Inter/sans-serif).
function wrapPlainText(text: string, maxWidth: number | undefined, fontSize: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth || maxWidth <= 0) { lines.push(para); continue; }
    const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.52)));
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

function applyCommonAttributes(
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

function applyStroke(el: SVGElement, stroke: { color: ColorOrGradient; width: number; dash?: number[]; linecap?: string; linejoin?: string }, svg?: SVGSVGElement): void {
  const strokeColor = typeof stroke.color === 'string'
    ? stroke.color
    : resolveColorOrGradient(stroke.color, getOrCreateDefs(svg ?? el.ownerSVGElement as SVGSVGElement));
  el.setAttribute('stroke', strokeColor);
  el.setAttribute('stroke-width', String(stroke.width));
  if (stroke.dash) {
    el.setAttribute('stroke-dasharray', stroke.dash.join(' '));
  }
  if (stroke.linecap) {
    el.setAttribute('stroke-linecap', stroke.linecap);
  }
  if (stroke.linejoin) {
    el.setAttribute('stroke-linejoin', stroke.linejoin);
  }
}

// Build an SVG path for a rect with per-corner radii (quarter-circle arcs)
function roundedRectPath(x: number, y: number, w: number, h: number,
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
export function renderRect(layer: RectLayer, svg: SVGSVGElement): SVGElement {
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width  === 'number' ? layer.width  : 0;
  const h = typeof layer.height === 'number' ? layer.height : 0;

  // Determine which element to use based on radius type
  let el: SVGElement;
  if (layer.radius !== undefined && typeof layer.radius !== 'number') {
    // Per-corner radius → convert to path
    const r = layer.radius as { tl: number; tr: number; br: number; bl: number };
    el = createSVGElement('path', { d: roundedRectPath(x, y, w, h, r) });
  } else {
    el = createSVGElement('rect', { x, y, width: w, height: h });
    if (layer.radius !== undefined) {
      el.setAttribute('rx', String(layer.radius as number));
    }
  }

  if (layer.fill) {
    const fillResult = applyFill(layer.fill, svg, { width: w, height: h });
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) el.setAttribute('fill-opacity', String(fillResult.opacity));
  } else {
    el.setAttribute('fill', 'none');
  }

  if (layer.stroke) applyStroke(el, layer.stroke, svg);

  applyCommonAttributes(el, layer);

  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// ── Circle ──────────────────────────────────────────────────
export function renderCircle(layer: CircleLayer, svg: SVGSVGElement): SVGElement {
  const cx = layer.cx ?? ((layer.x ?? 0) + ((typeof layer.width === 'number' ? layer.width : 0) / 2));
  const cy = layer.cy ?? ((layer.y ?? 0) + ((typeof layer.height === 'number' ? layer.height : 0) / 2));
  const rx = layer.rx ?? ((typeof layer.width === 'number' ? layer.width : 0) / 2);
  const ry = layer.ry ?? ((typeof layer.height === 'number' ? layer.height : 0) / 2);

  const el = createSVGElement('ellipse', { cx, cy, rx, ry });

  if (layer.fill) {
    const fillResult = applyFill(layer.fill, svg, { width: rx * 2, height: ry * 2 });
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) {
      el.setAttribute('fill-opacity', String(fillResult.opacity));
    }
  } else {
    el.setAttribute('fill', 'none');
  }

  if (layer.stroke) applyStroke(el, layer.stroke, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// ── Path ────────────────────────────────────────────────────
export function renderPath(layer: PathLayer, svg: SVGSVGElement): SVGElement {
  const el = createSVGElement('path', { d: layer.d });

  if (layer.fill) {
    const fillResult = applyFill(layer.fill, svg, {
      width: typeof layer.width === 'number' ? layer.width : 100,
      height: typeof layer.height === 'number' ? layer.height : 100,
    });
    el.setAttribute('fill', fillResult.fill);
  } else {
    el.setAttribute('fill', 'none');
  }

  if (layer.stroke) applyStroke(el, layer.stroke, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// ── Polygon ─────────────────────────────────────────────────
export function renderPolygon(layer: PolygonLayer, svg: SVGSVGElement): SVGElement {
  let points = layer.points ?? '';

  if (!points && layer.sides && layer.sides >= 3) {
    const cx = (layer.x ?? 0) + ((typeof layer.width === 'number' ? layer.width : 0) / 2);
    const cy = (layer.y ?? 0) + ((typeof layer.height === 'number' ? layer.height : 0) / 2);
    const r = Math.min(
      typeof layer.width === 'number' ? layer.width : 0,
      typeof layer.height === 'number' ? layer.height : 0,
    ) / 2;
    const pts: string[] = [];
    for (let i = 0; i < layer.sides; i++) {
      const angle = (2 * Math.PI * i) / layer.sides - Math.PI / 2;
      pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    points = pts.join(' ');
  }

  const el = createSVGElement('polygon', { points });

  if (layer.fill) {
    const fillResult = applyFill(layer.fill, svg, {
      width: typeof layer.width === 'number' ? layer.width : 0,
      height: typeof layer.height === 'number' ? layer.height : 0,
    });
    el.setAttribute('fill', fillResult.fill);
  } else {
    el.setAttribute('fill', 'none');
  }

  if (layer.stroke) applyStroke(el, layer.stroke, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// ── Line ────────────────────────────────────────────────────
export function renderLine(layer: LineLayer, svg: SVGSVGElement): SVGElement {
  const el = createSVGElement('line', {
    x1: layer.x1,
    y1: layer.y1,
    x2: layer.x2,
    y2: layer.y2,
  });

  el.setAttribute('fill', 'none');
  if (layer.stroke) {
    applyStroke(el, layer.stroke, svg);
  } else {
    el.setAttribute('stroke', '#000');
    el.setAttribute('stroke-width', '1');
  }

  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// ── Text ────────────────────────────────────────────────────
/** Coerce the many text-layer shapes LLMs author into the canonical
 *  { content:{type,value|spans}, style } the renderer expects. Tolerates a bare
 *  `text:"…"` alias, a string `content`, a missing content, and flat style
 *  shorthand (font/size/weight/color/lh/track) — so a heading never throws
 *  `layer.content.type of undefined` and vanishes into an error placeholder. */
function normalizeTextLayer(layer: TextLayer): { content: TextContent; style: NonNullable<TextLayer['style']> } {
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

export function renderText(layer: TextLayer, svg: SVGSVGElement): SVGElement {
  const g = createSVGElement('g');
  const { content, style } = normalizeTextLayer(layer);

  if (content.type === 'markdown') {
    // Use foreignObject for HTML rendering via marked.js
    const fo = createSVGElement('foreignObject', {
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      width: typeof layer.width === 'number' ? layer.width : 400,
      height: typeof layer.height === 'number' ? layer.height : 200,
    });

    const div = document.createElement('div');
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    div.style.fontFamily = style.font_family ?? 'Inter, sans-serif';
    div.style.fontSize = `${style.font_size ?? 16}px`;
    div.style.fontWeight = String(style.font_weight ?? 400);
    div.style.color = typeof style.color === 'string' ? style.color : '#000';
    div.style.lineHeight = String(style.line_height ?? 1.5);
    div.style.overflow = 'hidden';

    // Scoped styles for markdown HTML output (tables, code, headings, etc.)
    const mdStyle = document.createElement('style');
    mdStyle.textContent = [
      'table{border-collapse:collapse;width:100%;margin:.5em 0}',
      'th,td{border:1px solid currentColor;padding:4px 8px;text-align:left}',
      'th{font-weight:bold;opacity:.8}',
      'tr:nth-child(even){background:rgba(128,128,128,.1)}',
      'code{font-family:monospace;font-size:.9em;background:rgba(128,128,128,.15);padding:1px 4px;border-radius:3px}',
      'pre{background:rgba(128,128,128,.15);padding:8px;border-radius:4px;overflow:auto}',
      'pre code{background:none;padding:0}',
      'blockquote{margin:0;padding-left:1em;border-left:3px solid currentColor;opacity:.7}',
    ].join('');
    div.appendChild(mdStyle);

    // Content container — mdStyle stays live, content goes here (avoids re-serialising the style tag)
    const mdContent = document.createElement('div');
    div.appendChild(mdContent);

    const mdValue = (content as { value: string }).value;
    import('marked').then(({ marked }) => {
      mdContent.innerHTML = marked.parse(mdValue, { gfm: true }) as string;
      // Syntax-highlight code blocks via Prism (lazy, best-effort)
      return import('prismjs').then(({ default: Prism }) => {
        mdContent.querySelectorAll<HTMLElement>('pre code[class*="language-"]').forEach(block => {
          Prism.highlightElement(block);
        });
      }).catch(() => { /* Prism unavailable — unstyled code is fine */ });
    }).catch(() => {
      // marked.js failed — fall back to plain text, no flash since div was empty
      mdContent.textContent = mdValue;
    });
    fo.appendChild(div);
    g.appendChild(fo);
  } else if (content.type === 'rich') {
    const textEl = createSVGElement('text', {
      x: layer.x ?? 0,
      y: (layer.y ?? 0) + (style.font_size ?? 16),
    });
    textEl.setAttribute('font-family', style.font_family ?? 'Inter, sans-serif');
    textEl.setAttribute('font-size', String(style.font_size ?? 16));

    for (const span of content.spans) {
      const tspan = createSVGElement('tspan');
      tspan.textContent = span.text;
      if (span.bold) tspan.setAttribute('font-weight', 'bold');
      if (span.italic) tspan.setAttribute('font-style', 'italic');
      if (span.color) tspan.setAttribute('fill', span.color);
      if (span.size) tspan.setAttribute('font-size', String(span.size));
      textEl.appendChild(tspan);
    }

    g.appendChild(textEl);
  } else {
    // Plain text
    const fontSize = style.font_size ?? 16;
    const lineH = fontSize * (style.line_height ?? 1.4);
    const value = content.value;
    const lines = wrapPlainText(value, typeof layer.width === 'number' ? layer.width : undefined, fontSize);

    // Compute x anchor — `text_align` is the dominant authored form in
    // templates, `align` is the legacy field; honour either.
    const alignVal = style.text_align ?? style.align;
    const anchor = alignVal === 'center' ? 'middle' : alignVal === 'right' ? 'end' : 'start';
    let textX = layer.x ?? 0;
    if (alignVal === 'center' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width / 2;
    else if (alignVal === 'right' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width;

    // Compute y anchor (vertical align within layer height)
    let textY = (layer.y ?? 0) + fontSize;
    if (typeof layer.height === 'number' && style.vertical_align) {
      const totalH = lines.length * lineH;
      if (style.vertical_align === 'middle') textY = (layer.y ?? 0) + (layer.height - totalH) / 2 + fontSize;
      else if (style.vertical_align === 'bottom') textY = (layer.y ?? 0) + layer.height - totalH + fontSize;
    }

    const textEl = createSVGElement('text', { x: textX, y: textY });
    textEl.setAttribute('font-family', style.font_family ?? 'Inter, sans-serif');
    textEl.setAttribute('font-size', String(fontSize));
    textEl.setAttribute('font-weight', String(style.font_weight ?? 400));
    if (style.text_decoration && style.text_decoration !== 'none') {
      textEl.setAttribute('text-decoration', style.text_decoration);
    }
    if (style.letter_spacing) textEl.setAttribute('letter-spacing', `${style.letter_spacing}px`);
    if (alignVal) textEl.setAttribute('text-anchor', anchor);

    const textColor = style.color
      ? resolveColorOrGradient(style.color, getOrCreateDefs(svg))
      : '#000';
    textEl.setAttribute('fill', textColor);

    if (lines.length > 1) {
      for (let i = 0; i < lines.length; i++) {
        const tspan = createSVGElement('tspan', {
          x: String(textX),
          dy: i === 0 ? '0' : String(lineH),
        });
        tspan.textContent = lines[i];
        textEl.appendChild(tspan);
      }
    } else {
      textEl.textContent = lines[0] ?? '';
    }

    g.appendChild(textEl);
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);

  return g;
}

// ── Image ───────────────────────────────────────────────────
export function renderImage(layer: ImageLayer, svg: SVGSVGElement): SVGElement {
  // No src → render a styled dashed-frame placeholder. Cleaner than the
  // browser's broken-image icon and matches the chart placeholder card
  // (foreignObject with dashed border + neutral label).
  const hasSrc = typeof layer.src === 'string' && layer.src.trim().length > 0;
  if (!hasSrc) {
    const w = typeof layer.width === 'number' ? layer.width : 100;
    const h = typeof layer.height === 'number' ? layer.height : 100;
    return makeImagePlaceholder(layer, w, h, svg);
  }

  const el = createSVGElement('image', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: typeof layer.width === 'number' ? layer.width : 100,
    height: typeof layer.height === 'number' ? layer.height : 100,
    href: layer.src,
  });

  if (layer.fit === 'cover' || layer.fit === 'contain') {
    el.setAttribute('preserveAspectRatio', layer.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
  }

  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return el;
}

// Native-SVG placeholder (rect + glyph + label). Built from primitives, not a
// foreignObject — so it renders in server-side PNG export (resvg) too, not
// just the editor's browser SVG. Shown for an image layer with no/unresolved
// src, so a small model's missing-photo reference reads as an intentional
// frame instead of a blank hole.
function makeImagePlaceholder(layer: ImageLayer, w: number, h: number, svg: SVGSVGElement): SVGElement {
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const stroke = 'rgba(128,128,160,0.45)';
  const g = createSVGElement('g', { transform: `translate(${x}, ${y})` });

  g.appendChild(createSVGElement('rect', {
    x: 0, y: 0, width: w, height: h, rx: '8',
    fill: 'rgba(128,128,160,0.06)', stroke, 'stroke-width': '1.5', 'stroke-dasharray': '6 4',
  }));

  // Lucide "image" glyph, scaled into the box and centred in the upper area.
  const glyph = Math.max(16, Math.min(w, h) * 0.32);
  const ns = 'http://www.w3.org/2000/svg';
  const iconSvg = document.createElementNS(ns, 'svg') as SVGSVGElement;
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('width', String(glyph));
  iconSvg.setAttribute('height', String(glyph));
  iconSvg.setAttribute('x', String((w - glyph) / 2));
  iconSvg.setAttribute('y', String(h / 2 - glyph * 0.7));
  iconSvg.setAttribute('stroke', stroke);
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.innerHTML = LUCIDE_ICONS['image'];
  g.appendChild(iconSvg);

  // Caller may pass `alt` via shorthand even though it's not in the typed
  // schema; fall back to a neutral label.
  const alt = (layer as ImageLayer & { alt?: string }).alt;
  const label = createSVGElement('text', {
    x: w / 2, y: h / 2 + glyph * 0.55,
    'text-anchor': 'middle',
    'font-family': 'Inter, sans-serif',
    'font-size': String(Math.max(10, Math.min(18, w * 0.04))),
    fill: 'rgba(128,128,160,0.85)',
    'letter-spacing': '0.06em',
  });
  label.textContent = alt ?? 'image';
  g.appendChild(label);

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

// ── Icon ────────────────────────────────────────────────────
export function renderIcon(layer: IconLayer, svg: SVGSVGElement): SVGElement {
  const size = layer.size ?? 24;
  const color = layer.color ?? 'currentColor';
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;

  const g = createSVGElement('g');
  g.setAttribute('transform', `translate(${x}, ${y})`);

  // Tolerate synonyms / separators a model emits ("coffee_cup", "photo") by
  // resolving to the nearest real icon; only fall back to the placeholder when
  // there's no confident match.
  const resolved = resolveIconName(layer.name);
  const inner = resolved ? LUCIDE_ICONS[resolved] : undefined;

  if (inner) {
    // Real Lucide icon — embed scaled SVG as nested <svg>
    const ns = 'http://www.w3.org/2000/svg';
    const iconSvg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('width', String(size));
    iconSvg.setAttribute('height', String(size));
    iconSvg.setAttribute('stroke', color);
    iconSvg.setAttribute('stroke-width', '2');
    iconSvg.setAttribute('stroke-linecap', 'round');
    iconSvg.setAttribute('stroke-linejoin', 'round');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.innerHTML = inner;
    g.appendChild(iconSvg);
  } else {
    // Fallback: dashed rect + name label for unknown icons
    const rect = createSVGElement('rect', {
      x: 0, y: 0, width: size, height: size,
      rx: '3', fill: 'none', stroke: color,
      'stroke-width': '1.5', 'stroke-dasharray': '4 3',
    });
    const label = createSVGElement('text', {
      x: size / 2, y: size / 2 + 4,
      'text-anchor': 'middle',
      'font-size': String(Math.max(7, Math.floor(size / 4))),
      fill: color,
    });
    label.textContent = layer.name;
    g.appendChild(rect);
    g.appendChild(label);
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

// ── Mermaid ─────────────────────────────────────────────────
// Lazy-loads mermaid on first use; renders asynchronously into
// a foreignObject container and updates the DOM once done.
export function renderMermaid(layer: MermaidLayer, _svg: SVGSVGElement): SVGElement {
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
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  // Placeholder until async render completes
  const placeholder = document.createElement('div');
  placeholder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  placeholder.style.cssText = 'font-family:monospace;font-size:12px;color:#8892A4;padding:8px;white-space:pre;';
  placeholder.textContent = layer.definition;
  container.appendChild(placeholder);
  fo.appendChild(container);

  // Stable ID derived from layer.id to avoid mermaid ID collisions
  const diagramId = `mermaid-${layer.id.replace(/[^a-zA-Z0-9]/g, '-')}`;

  import('mermaid').then(mod => {
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    return mermaid.render(diagramId, layer.definition);
  }).then(({ svg }) => {
    container.innerHTML = svg;
  }).catch(() => {
    // Leave placeholder on error
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Chart (vega-embed) ───────────────────────────────────────
// Lazy-loads vega-embed on first use; renders a Vega-Lite spec
// into a foreignObject container and updates the DOM once done.
export function renderChart(layer: ChartLayer, _svg: SVGSVGElement): SVGElement {
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
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  container.style.overflow = 'hidden';

  // Placeholder
  const placeholder = document.createElement('div');
  placeholder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#8892A4;font-family:monospace;font-size:12px;';
  placeholder.textContent = '[Chart loading…]';
  container.appendChild(placeholder);
  fo.appendChild(container);

  // Merge layer dimensions into spec so vega-embed respects them
  const spec = { width: w - 20, height: h - 20, ...layer.spec };

  import('vega-embed').then(({ default: embed }) => {
    container.innerHTML = '';
    return embed(container, spec as unknown as Parameters<typeof embed>[1], {
      renderer: 'svg',
      actions: false,
      theme: 'dark',
    });
  }).catch(() => {
    container.innerHTML = '';
    placeholder.textContent = '[Chart render failed]';
    container.appendChild(placeholder);
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Code (Prism.js) ──────────────────────────────────────────
// Lazy-loads Prism on first use for syntax highlighting.
export function renderCode(layer: CodeLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 200;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const pre = document.createElement('pre');
  pre.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  pre.style.cssText = [
    'font-family:JetBrains Mono,monospace',
    'font-size:13px',
    'margin:0',
    'padding:16px',
    'background:#1a1a2e',
    'color:#e0e0e8',
    'border-radius:8px',
    'overflow:auto',
    `width:${w}px`,
    `height:${h}px`,
    'box-sizing:border-box',
  ].join(';');

  const code = document.createElement('code');
  code.className = `language-${layer.language}`;
  // Escape HTML entities for initial plain render
  code.textContent = layer.code;
  pre.appendChild(code);
  fo.appendChild(pre);

  // Lazy-load Prism and apply syntax highlighting
  // prismjs uses `export =` so the dynamic import resolves to Prism directly
  import('prismjs').then(Prism => {
    // Dynamically load the language component if not already present
    const grammar = Prism.languages[layer.language];
    if (grammar) {
      code.innerHTML = Prism.highlight(layer.code, grammar, layer.language);
    } else {
      import(`prismjs/components/prism-${layer.language}.js`).then(() => {
        const g = Prism.languages[layer.language];
        if (g) code.innerHTML = Prism.highlight(layer.code, g, layer.language);
      }).catch(() => {
        // Language not available — plain text is fine
      });
    }
  }).catch(() => {
    // Prism unavailable — plain text remains
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Math (KaTeX) ─────────────────────────────────────────────
// Lazy-loads KaTeX on first use; renders LaTeX into HTML inside
// a foreignObject. Falls back to raw expression string on error.
export function renderMath(layer: MathLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 300;
  const h = typeof layer.height === 'number' ? layer.height : 100;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.style.cssText = `display:flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;`;
  // Plain-text placeholder
  container.textContent = layer.expression;
  fo.appendChild(container);

  import('katex').then(mod => {
    const katex = mod.default;
    container.innerHTML = katex.renderToString(layer.expression, {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    });
  }).catch(() => {
    // Leave plain text fallback
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Group ───────────────────────────────────────────────────
export function renderGroup(
  layer: GroupLayer,
  svg: SVGSVGElement,
  renderLayerFn: (layer: Layer, svg: SVGSVGElement) => SVGElement,
): SVGElement {
  const g = createSVGElement('g');

  const sorted = [...layer.layers].sort((a, b) => a.z - b.z);
  for (const child of sorted) {
    g.appendChild(renderLayerFn(child, svg));
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);

  return g;
}

// ── QR Code ─────────────────────────────────────────────────
// Real QR Code renderer using Reed-Solomon error correction.
// Supports Version 1 (21×21), EC levels L/M/Q/H, byte mode.
// Input longer than ~17 chars (H) / ~25 chars (L) will be truncated to fit.
export function renderQRCode(layer: QRCodeLayer, _svg: SVGSVGElement): SVGElement {
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 120;
  const h = typeof layer.height === 'number' ? layer.height : 120;
  const fg = layer.fill ?? '#000000';
  const bg = layer.background ?? 'transparent';
  const ec = (layer.error_correction ?? 'M') as 'L' | 'M' | 'Q' | 'H';

  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  if (bg !== 'transparent') {
    g.appendChild(createSVGElement('rect', { x, y, width: w, height: h, fill: bg }));
  }

  // Encode — returns 21×21 boolean matrix
  let matrix: boolean[][];
  try {
    matrix = encodeQR(layer.value, ec);
  } catch {
    // Fallback: empty black square with error indicator
    g.appendChild(createSVGElement('rect', { x, y, width: w, height: h, fill: '#ff000033', stroke: '#e94560', 'stroke-width': 2 }));
    return g;
  }

  const MODULES = matrix.length;
  const cellSize = w / MODULES;

  for (let row = 0; row < MODULES; row++) {
    for (let col = 0; col < MODULES; col++) {
      if (matrix[row][col]) {
        g.appendChild(createSVGElement('rect', {
          x: x + col * cellSize,
          y: y + row * cellSize,
          width: cellSize + 0.5, // +0.5 prevents hairline gaps between cells
          height: cellSize + 0.5,
          fill: fg,
        }));
      }
    }
  }

  if (layer.effects) applyEffects(g, layer.effects, _svg);
  return g;
}

// ── Auto Layout ──────────────────────────────────────────────
export function renderAutoLayout(
  layer: AutoLayoutLayer,
  svg: SVGSVGElement,
  renderChild: (l: Layer, s: SVGSVGElement) => SVGElement,
): SVGElement {
  const isRow = layer.direction === 'row';
  const gap = layer.gap ?? 0;
  const pad = normalizePadding(layer.padding);
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 0;
  const h = typeof layer.height === 'number' ? layer.height : 0;

  const align   = layer.align_items    ?? 'start';
  const justify = layer.justify_content ?? 'start';

  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  if (layer.fill && layer.fill.type !== 'none') {
    const bg = createSVGElement('rect', { x, y, width: w, height: h });
    if (typeof layer.radius === 'number') {
      bg.setAttribute('rx', String(layer.radius));
      bg.setAttribute('ry', String(layer.radius));
    }
    const fillResult = applyFill(layer.fill, svg, { width: w, height: h });
    bg.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) bg.setAttribute('opacity', String(fillResult.opacity));
    fillResult.extraElements?.forEach(el => g.appendChild(el));
    if (layer.stroke) applyStroke(bg, layer.stroke, svg);
    g.appendChild(bg);
  }

  const sorted = [...(layer.layers ?? [])].sort((a, b) => a.z - b.z);

  const mainSizes = sorted.map(child =>
    isRow ? (typeof child.width  === 'number' ? child.width  : 0)
          : (typeof child.height === 'number' ? child.height : 0),
  );
  const crossSizes = sorted.map(child =>
    isRow ? (typeof child.height === 'number' ? child.height : 0)
          : (typeof child.width  === 'number' ? child.width  : 0),
  );

  const mainPadStart  = isRow ? pad.left  : pad.top;
  const mainPadEnd    = isRow ? pad.right : pad.bottom;
  const crossPadStart = isRow ? pad.top   : pad.left;
  const containerMain  = isRow ? w : h;
  const containerCross = isRow ? h : w;
  const availableMain  = containerMain  - mainPadStart - mainPadEnd;
  const availableCross = containerCross - crossPadStart - (isRow ? pad.bottom : pad.right);

  // Flexbox-style sizing for children that omit dimensions. Models expect a
  // container to distribute space, but Folio sizes children from their own
  // width/height — so a row of 3 sizeless columns would collapse onto each
  // other. Children with no main-axis size share the leftover main space
  // equally (flex-grow:1); children with no cross-axis size fill the cross.
  // Skipped when wrapping (wrap needs intrinsic sizes). Sized children are
  // left untouched.
  if (!layer.wrap && availableMain > 0) {
    const flexIdx = sorted.map((_, i) => i).filter(i => !(mainSizes[i] > 0));
    if (flexIdx.length) {
      const fixed = mainSizes.reduce((s, v) => s + (v > 0 ? v : 0), 0);
      const gaps = Math.max(0, sorted.length - 1) * gap;
      const share = Math.max(0, (availableMain - fixed - gaps) / flexIdx.length);
      for (const i of flexIdx) mainSizes[i] = share;
    }
    for (let i = 0; i < crossSizes.length; i++) if (!(crossSizes[i] > 0)) crossSizes[i] = availableCross;
  }
  const totalMain = mainSizes.reduce((s, v) => s + v, 0) + Math.max(0, sorted.length - 1) * gap;

  const calcCursor = (total: number, count: number, sizes: number[]): { start: number; dynGap: number } => {
    switch (justify) {
      case 'center':      return { start: mainPadStart + (availableMain - total) / 2,              dynGap: gap };
      case 'end':         return { start: mainPadStart + availableMain - total,                    dynGap: gap };
      case 'space-between': return { start: mainPadStart, dynGap: count > 1 ? (availableMain - sizes.reduce((s,v)=>s+v,0)) / (count-1) : 0 };
      case 'space-around':  { const sp = availableMain - sizes.reduce((s,v)=>s+v,0); return { start: mainPadStart + (sp/count)/2, dynGap: sp/count }; }
      default:            return { start: mainPadStart,                                            dynGap: gap };
    }
  };

  const placeChild = (child: Layer, mc: number, cc: number, cIdx: number, trackCross: number): void => {
    let crossPos: number;
    switch (align) {
      case 'center': crossPos = cc + (trackCross - crossSizes[cIdx]) / 2; break;
      case 'end':    crossPos = cc + trackCross - crossSizes[cIdx]; break;
      default:       crossPos = cc;
    }
    // Apply the layout-computed sizes (== the child's own size when it set
    // one; the flex/fill value otherwise) so flexed/filled children actually
    // render at their distributed size and nested containers know their box.
    const mainSize  = mainSizes[cIdx];
    const crossSize = align === 'stretch' ? trackCross : crossSizes[cIdx];
    const placed: Layer = {
      ...child,
      x: isRow ? x + mc : x + crossPos,
      y: isRow ? y + crossPos : y + mc,
      width:  isRow ? mainSize : crossSize,
      height: isRow ? crossSize : mainSize,
    };
    g.appendChild(renderChild(placed, svg));
  };

  if (layer.wrap && availableMain > 0) {
    // Group children into wrap tracks
    const tracks: { idxs: number[] }[] = [];
    let track: number[] = [];
    let trackUsed = 0;
    for (let i = 0; i < sorted.length; i++) {
      const sz = mainSizes[i];
      const needed = track.length === 0 ? sz : trackUsed + gap + sz;
      if (track.length > 0 && needed > availableMain + 0.5) {
        tracks.push({ idxs: [...track] });
        track = [i]; trackUsed = sz;
      } else {
        track.push(i); trackUsed = needed;
      }
    }
    if (track.length > 0) tracks.push({ idxs: track });

    let crossCursor = crossPadStart;
    for (const { idxs } of tracks) {
      const tSizes = idxs.map(i => mainSizes[i]);
      const tTotal = tSizes.reduce((s,v)=>s+v,0) + Math.max(0, idxs.length-1) * gap;
      const trackCross = Math.max(...idxs.map(i => crossSizes[i]));
      const { start, dynGap } = calcCursor(tTotal, idxs.length, tSizes);
      let mc = start;
      for (let j = 0; j < idxs.length; j++) {
        placeChild(sorted[idxs[j]], mc, crossCursor, idxs[j], trackCross);
        mc += tSizes[j] + dynGap;
      }
      crossCursor += trackCross + gap;
    }
  } else {
    // No wrap — linear pass
    const { start, dynGap } = calcCursor(totalMain, sorted.length, mainSizes);
    let cursor = start;
    for (let i = 0; i < sorted.length; i++) {
      placeChild(sorted[i], cursor, crossPadStart, i, availableCross);
      cursor += mainSizes[i] + dynGap;
    }
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

function normalizePadding(
  p: AutoLayoutLayer['padding'],
): { top: number; right: number; bottom: number; left: number } {
  if (p === undefined || p === null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return p;
}

// ── Helpers shared by report renderers ──────────────────────

function makeForeignObject(
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

// ── Interactive Chart (Plotly) ───────────────────────────────
export function renderInteractiveChart(layer: InteractiveChartLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = 'folio-chart';
  container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;background:#191926;border-radius:10px;`;
  if (layer.id) container.dataset['layerId'] = layer.id;

  const ph = document.createElement('div');
  ph.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  ph.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#8892A4;font-family:Inter,sans-serif;font-size:12px;';
  ph.textContent = layer.title ?? `${layer.chart_type} chart`;
  container.appendChild(ph);
  fo.appendChild(container);

  // Draw a real chart from the design's inline data (or a representative
  // sample when the source is external / not present at design time) so the
  // studio canvas previews the widget instead of an empty placeholder.
  const rows = getPreviewRows(layer.data_ref);
  const { spec, isSample } = buildChartPreviewSpec(layer, rows, getPreviewAccent(), w, h);
  import('vega-embed').then(({ default: embed }) => {
    container.innerHTML = '';
    return embed(container, spec as unknown as Parameters<typeof embed>[1], {
      renderer: 'svg', actions: false, theme: 'dark',
    });
  }).then(() => {
    if (isSample) {
      const note = document.createElement('div');
      note.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      note.textContent = 'sample data';
      note.style.cssText = 'position:absolute;right:8px;bottom:6px;font:9px Inter,sans-serif;color:rgba(180,180,200,0.55);letter-spacing:0.05em;pointer-events:none;';
      container.style.position = 'relative';
      container.appendChild(note);
    }
  }).catch(() => {
    container.innerHTML = '';
    container.appendChild(ph);
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// Pick x/y fields for a chart preview — explicit fields win; otherwise infer a
// categorical x + numeric y from the first row.
function inferChartFields(layer: InteractiveChartLayer, rows: Record<string, unknown>[]): { x: string; y: string } {
  let x = layer.x_field;
  let y = layer.y_field;
  if ((!x || !y) && rows.length > 0) {
    const keys = Object.keys(rows[0]);
    const numKey = keys.find((k) => typeof rows[0][k] === 'number');
    const catKey = keys.find((k) => typeof rows[0][k] !== 'number') ?? keys[0];
    x = x ?? catKey;
    y = y ?? numKey ?? keys[1] ?? keys[0];
  }
  return { x: x ?? 'category', y: y ?? 'value' };
}

function sampleChartRows(x: string, y: string): Record<string, unknown>[] {
  const cats = ['A', 'B', 'C', 'D', 'E'];
  const vals = [38, 62, 49, 71, 55];
  return cats.map((c, i) => ({ [x]: c, [y]: vals[i] }));
}

interface VlSpec { [k: string]: unknown }

// Map an interactive_chart layer → a Vega-Lite spec for the editor preview.
// Vega is already bundled (the static `chart` layer uses it), so this needs no
// new dependency. The exported HTML still draws Chart.js/Plotly; this is a
// faithful design-time preview of shape + data, not a pixel match.
export function buildChartPreviewSpec(
  layer: InteractiveChartLayer,
  rows: Record<string, unknown>[],
  accent: string,
  w: number,
  h: number,
): { spec: VlSpec; isSample: boolean } {
  const { x, y } = inferChartFields(layer, rows);
  const isSample = rows.length === 0;
  const values = isSample ? sampleChartRows(x, y) : rows.slice(0, 60);
  const xType = typeof values[0]?.[x] === 'number' ? 'quantitative' : 'nominal';
  const colorEnc = layer.color_field
    ? { color: { field: layer.color_field, type: 'nominal', scale: { scheme: 'tableau10' } } }
    : {};

  const spec: VlSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: Math.max(80, w - 28),
    height: Math.max(60, h - (layer.title ? 56 : 34)),
    background: '#191926',
    padding: 12,
    data: { values },
    config: {
      view: { stroke: 'transparent' },
      axis: { labelColor: '#b8b8c8', titleColor: '#d8d8e4', gridColor: 'rgba(255,255,255,0.06)', domainColor: 'rgba(255,255,255,0.18)' },
      legend: { labelColor: '#b8b8c8', titleColor: '#d8d8e4' },
      title: { color: '#f0f0f6', fontSize: 13, anchor: 'start' },
    },
  };
  if (layer.title) spec['title'] = layer.title;

  const xEnc = { field: x, type: xType, axis: { labelAngle: 0 } };
  const yEnc = { field: y, type: 'quantitative' };

  switch (layer.chart_type) {
    case 'line':
      spec['mark'] = { type: 'line', color: accent, point: { filled: true, color: accent }, strokeWidth: 2 };
      spec['encoding'] = { x: { field: x, type: 'ordinal' }, y: yEnc, ...colorEnc };
      break;
    case 'area':
      spec['mark'] = { type: 'area', color: accent, opacity: 0.65, line: { color: accent, strokeWidth: 2 } };
      spec['encoding'] = { x: { field: x, type: 'ordinal' }, y: yEnc, ...colorEnc };
      break;
    case 'scatter':
      spec['mark'] = { type: 'point', filled: true, color: accent, size: 70, opacity: 0.8 };
      spec['encoding'] = { x: xEnc, y: yEnc, ...colorEnc };
      break;
    case 'pie':
    case 'donut':
      spec['mark'] = { type: 'arc', outerRadius: Math.min(spec['width'] as number, spec['height'] as number) / 2 - 6, ...(layer.chart_type === 'donut' ? { innerRadius: Math.min(spec['width'] as number, spec['height'] as number) / 5 } : {}) };
      spec['encoding'] = { theta: { field: y, type: 'quantitative' }, color: { field: x, type: 'nominal', scale: { scheme: 'tableau10' } } };
      break;
    case 'heatmap':
      if (layer.color_field) {
        spec['mark'] = 'rect';
        spec['encoding'] = { x: { field: x, type: 'nominal' }, y: { field: layer.color_field, type: 'nominal' }, color: { field: y, type: 'quantitative', scale: { scheme: 'viridis' } } };
      } else {
        spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
        spec['encoding'] = { x: xEnc, y: yEnc };
      }
      break;
    case 'funnel':
      spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
      spec['encoding'] = { y: { field: x, type: 'nominal', sort: '-x' }, x: yEnc };
      break;
    case 'bar':
    case 'waterfall':
    default:
      spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
      spec['encoding'] = { x: xEnc, y: yEnc, ...colorEnc };
      break;
  }
  return { spec, isSample };
}

// ── Interactive Table (Tabulator) ────────────────────────────
export function renderInteractiveTable(layer: InteractiveTableLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = 'folio-table';
  container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;background:#191926;border-radius:10px;font-family:Inter,sans-serif;`;
  if (layer.id) container.dataset['layerId'] = layer.id;

  // Draw a real static table preview from the design's inline rows (Tabulator
  // mounts only in the exported HTML). Falls back to a sample so the shape
  // shows even when the source is external / not present at design time.
  const allRows = getPreviewRows(layer.data_ref);
  const cols = (layer.columns ?? []).length > 0
    ? layer.columns
    : (allRows[0] ? Object.keys(allRows[0]).map((f) => ({ field: f, title: f })) : [{ field: 'value', title: 'Value' }]);
  const sample = allRows.length === 0;
  const maxRows = Math.max(2, Math.floor((h - 44) / 30));
  const rows = sample ? sampleTableRows(cols) : allRows.slice(0, maxRows);

  const th = cols.map((c) => {
    const align = (c as { align?: string }).align ?? 'left';
    return `<th style="text-align:${escHtml(align)};padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#9aa;border-bottom:1px solid rgba(255,255,255,0.12);white-space:nowrap;">${escHtml(String(c.title ?? c.field))}</th>`;
  }).join('');
  const trs = rows.map((r) => {
    const tds = cols.map((c) => {
      const align = (c as { align?: string }).align ?? 'left';
      const v = (r as Record<string, unknown>)[c.field];
      return `<td style="text-align:${escHtml(align)};padding:7px 12px;font-size:12px;color:#d8d8e4;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${escHtml(v == null ? '' : String(v))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  const hiddenCount = sample ? 0 : Math.max(0, allRows.length - rows.length);
  const footer = hiddenCount > 0
    ? `<div xmlns="http://www.w3.org/1999/xhtml" style="padding:6px 12px;font-size:10px;color:rgba(180,180,200,0.6);border-top:1px solid rgba(255,255,255,0.08);">+${hiddenCount} more row${hiddenCount === 1 ? '' : 's'}${layer.pagination === false ? '' : ' · paginated'}${layer.exportable ? ' · CSV' : ''}</div>`
    : (sample ? `<div xmlns="http://www.w3.org/1999/xhtml" style="padding:6px 12px;font-size:10px;color:rgba(180,180,200,0.55);border-top:1px solid rgba(255,255,255,0.08);">sample data</div>` : '');

  container.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;flex-direction:column;"><div xmlns="http://www.w3.org/1999/xhtml" style="flex:1;overflow:hidden;"><table xmlns="http://www.w3.org/1999/xhtml" style="width:100%;border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>${footer}</div>`;

  fo.appendChild(container);
  applyCommonAttributes(fo, layer);
  return fo;
}

function sampleTableRows(cols: { field: string; title?: string }[]): Record<string, unknown>[] {
  const fill = (i: number, c: { field: string }, j: number): unknown =>
    j === 0 ? `Item ${i + 1}` : Math.round((i + 1) * (j + 1) * 12.5);
  return [0, 1, 2].map((i) => {
    const row: Record<string, unknown> = {};
    cols.forEach((c, j) => { row[c.field] = fill(i, c, j); });
    return row;
  });
}

// ── Rich Text (marked.js) ────────────────────────────────────
export function renderRichText(layer: RichTextLayer, _svg: SVGSVGElement): SVGElement {
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
  container.className = 'folio-richtext';
  const ff = layer.font_family ?? 'Inter, sans-serif';
  const fs = layer.font_size ?? 16;
  const lh = layer.line_height ?? 1.6;
  const color = layer.color ?? '#e0e0e0';
  const linkColor = layer.link_color ?? '#6c5ce7';
  container.style.cssText = `width:100%;height:100%;overflow:auto;box-sizing:border-box;font-family:${ff};font-size:${fs}px;line-height:${lh};color:${color};--link-color:${linkColor};`;

  if (layer.format === 'html') {
    container.innerHTML = layer.content;
  } else {
    // Eager markdown render. We also keep the source in a dataset attr
    // so the report runtime can re-render after data-binding without
    // re-parsing the engine output.
    container.dataset['markdownSrc'] = layer.content;
    container.dataset['renderType'] = 'markdown';
    // Initial paint = literal text inside an inline-styled span; once
    // marked.js loads (lazy chunk) we swap it for parsed HTML. The
    // wrapper keeps font/colour inheritance and avoids the raw `<pre>`
    // look that surfaced as `**asterisks**` in static exports.
    const initial = document.createElement('span');
    initial.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    initial.style.cssText = 'white-space:pre-wrap;display:block;';
    initial.textContent = layer.content;
    container.appendChild(initial);
    import('marked').then(({ marked }) => {
      const html = marked.parse(layer.content, { gfm: true, breaks: true });
      // marked@18 returns a string for non-async input.
      container.innerHTML = typeof html === 'string' ? html : layer.content;
      container.dataset['markdownSrc'] = layer.content;
      container.dataset['renderType'] = 'markdown';
    }).catch(() => {
      // marked unavailable — leave the plain-text fallback in place.
    });
  }

  fo.appendChild(container);
  applyCommonAttributes(fo, layer);
  return fo;
}

// ── KPI Card ─────────────────────────────────────────────────
export function renderKpiCard(layer: KpiCardLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 300;
  const h = typeof layer.height === 'number' ? layer.height : 180;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const card = document.createElement('div');
  card.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  card.className = 'folio-kpi';
  const bg = layer.background ?? '#1e1e3a';
  const textColor = layer.text_color ?? '#ffffff';
  const radius = layer.border_radius ?? 12;
  card.style.cssText = `width:100%;height:100%;box-sizing:border-box;background:${bg};color:${textColor};border-radius:${radius}px;padding:20px;display:flex;flex-direction:column;justify-content:space-between;`;

  const valStr = typeof layer.value === 'number'
    ? formatKpiValue(layer.value, layer.format, layer.currency, layer.decimals)
    : String(layer.value);
  const deltaStr = layer.delta !== undefined
    ? formatKpiValue(Number(layer.delta), layer.delta_format === 'percent' ? 'percent' : 'number', undefined, 1)
    : undefined;
  const posColor = layer.delta_positive_color ?? '#00b894';
  const negColor = layer.delta_negative_color ?? '#e17055';
  const deltaNum = layer.delta !== undefined ? Number(layer.delta) : 0;
  const deltaColor = deltaNum >= 0 ? posColor : negColor;

  card.innerHTML = `
    <div class="kpi-label" xmlns="http://www.w3.org/1999/xhtml" style="font-size:13px;opacity:0.7;text-transform:uppercase;letter-spacing:0.08em;">${escHtml(layer.label)}</div>
    <div class="kpi-value" xmlns="http://www.w3.org/1999/xhtml" style="font-size:36px;font-weight:700;line-height:1;">${escHtml(valStr)}</div>
    ${deltaStr ? `<div class="kpi-delta" xmlns="http://www.w3.org/1999/xhtml" style="font-size:14px;color:${deltaColor};">${escHtml((deltaNum >= 0 ? '▲ ' : '▼ ') + deltaStr)}</div>` : ''}
    ${layer.sparkline_data ? `<canvas class="kpi-sparkline" data-data-ref="${escHtml(layer.sparkline_data ?? '')}" data-field="${escHtml(layer.sparkline_field ?? '')}" data-color="${escHtml(layer.sparkline_color ?? '#6c5ce7')}" style="width:100%;height:40px;"></canvas>` : ''}
  `;

  fo.appendChild(card);
  applyCommonAttributes(fo, layer);
  return fo;
}

// Cache by (currency, decimals). Constructing Intl.NumberFormat is expensive
// on cold workers — Node lazy-loads ICU data on first currency-style call,
// which is the root cause of the Windows CI timeout this cache fixes.
const _currencyFormatters = new Map<string, Intl.NumberFormat>();
function getCurrencyFormatter(currency: string, dec: number): Intl.NumberFormat {
  const key = `${currency}|${dec}`;
  let fmt = _currencyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: dec });
    _currencyFormatters.set(key, fmt);
  }
  return fmt;
}

function formatKpiValue(value: number, format?: string, currency?: string, decimals?: number): string {
  const dec = decimals ?? 0;
  if (format === 'currency') {
    return getCurrencyFormatter(currency ?? 'USD', dec).format(value);
  }
  if (format === 'percent') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(dec)}%`;
  }
  return value.toFixed(dec);
}

function escHtml(s: unknown): string {
  // Coerce defensively: component layers are author/LLM-authored and a missing
  // text field (undefined) must not throw `.replace of undefined` and crash the
  // whole render. Treat null/undefined as empty.
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Map (Leaflet) ────────────────────────────────────────────
export function renderMap(layer: MapLayer, _svg: SVGSVGElement): SVGElement {
  const { fo, container } = makeForeignObject(layer, '[Map loading…]', 'folio-map');

  const meta = {
    layerId: layer.id,
    center: layer.center,
    zoom: layer.zoom ?? 2,
    tileProvider: layer.tile_provider ?? 'osm',
    overlays: layer.overlays ?? [],
  };
  container.dataset['leafletSpec'] = JSON.stringify(meta);
  container.dataset['renderType'] = 'leaflet';

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Embed Code ───────────────────────────────────────────────
export function renderEmbedCode(layer: EmbedCodeLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  if (layer.sandbox !== false) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    iframe.style.cssText = `width:${w}px;height:${h}px;border:none;`;
    iframe.setAttribute('srcdoc', layer.html);
    iframe.setAttribute('sandbox', layer.allow_scripts ? 'allow-scripts' : '');
    fo.appendChild(iframe);
  } else {
    const container = document.createElement('div');
    container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;`;
    container.innerHTML = layer.html;
    fo.appendChild(container);
  }

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Popup ────────────────────────────────────────────────────
export function renderPopup(
  layer: PopupLayer,
  svg: SVGSVGElement,
  renderChildFn: (l: Layer, s: SVGSVGElement) => SVGElement,
): SVGElement {
  // Popup renders as a hidden <g> group; the report runtime JS shows/hides it.
  const w = typeof layer.width === 'number' ? layer.width : 600;
  const h = typeof layer.height === 'number' ? layer.height : 400;

  const g = createSVGElement('g', {
    'data-popup-id': layer.id,
    'data-trigger-id': layer.trigger_id ?? '',
    'data-modal': String(layer.modal ?? true),
    'data-animation': layer.open_animation ?? 'fade',
  });

  // Backdrop rect (hidden by default)
  const backdrop = createSVGElement('rect', {
    x: 0, y: 0, width: '100%', height: '100%',
    fill: 'rgba(0,0,0,0.5)',
    'data-popup-backdrop': layer.id,
  });
  g.appendChild(backdrop);

  // Panel rect
  const panel = createSVGElement('rect', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
    fill: '#1a1a2e',
    rx: 8,
    ry: 8,
  });
  g.appendChild(panel);

  // Child layers
  for (const child of (layer.layers ?? [])) {
    g.appendChild(renderChildFn(child, svg));
  }

  // Hidden by default; runtime JS handles show/hide
  g.setAttribute('visibility', 'hidden');
  g.setAttribute('opacity', '0');

  applyCommonAttributes(g, layer);
  return g;
}

// ── Particle ─────────────────────────────────────────────────

/** Deterministic PRNG — seed with layer id + index to avoid Math.random() in render path. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function makeStar(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.4;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return points.join(' ');
}

export function renderParticle(layer: ParticleLayer, _svg: SVGSVGElement): SVGElement {
  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  const count  = layer.count ?? 50;
  const size   = layer.size ?? 4;
  const speed  = layer.speed ?? 3;
  const colors = layer.colors ?? ['#6c5ce7', '#00cec9', '#fd79a8'];
  const shape  = layer.shape ?? 'circle';
  const spread = layer.spread ?? 1;

  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width  === 'number' ? layer.width  : 200;
  const h = typeof layer.height === 'number' ? layer.height : 200;

  const idSeed = hashString(layer.id);

  for (let i = 0; i < count; i++) {
    const seed = idSeed + i * 997;
    const px = x + seededRandom(seed)      * w * spread;
    const py = y + seededRandom(seed + 1)  * h * spread;
    const color = colors[i % colors.length];
    const animDelay = seededRandom(seed + 2) * speed;
    const animDur   = speed * (0.7 + seededRandom(seed + 3) * 0.6);
    const driftX    = (seededRandom(seed + 4) - 0.5) * size * 6;
    const driftY    = (seededRandom(seed + 5) - 0.5) * size * 6;

    let particle: SVGElement;
    if (shape === 'square') {
      particle = createSVGElement('rect', {
        x: px - size / 2,
        y: py - size / 2,
        width:  size,
        height: size,
        fill:   color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    } else if (shape === 'star') {
      particle = createSVGElement('polygon', {
        points:  makeStar(px, py, size),
        fill:    color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    } else {
      particle = createSVGElement('circle', {
        cx:      px,
        cy:      py,
        r:       size / 2,
        fill:    color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    }

    // Floating CSS animation injected via inline style
    particle.setAttribute('style',
      `animation: folio-particle-float ${animDur.toFixed(2)}s ${animDelay.toFixed(2)}s ease-in-out infinite alternate;` +
      `--dp-dx:${driftX.toFixed(1)}px;--dp-dy:${driftY.toFixed(1)}px;`
    );

    g.appendChild(particle);
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, _svg);

  return g;
}

// ── Interactive report controls (editor-canvas previews) ──────
// Static foreignObject previews so the studio shows + lets you select/edit these
// components (full interactivity lives in the HTML export runtime). The YAML/
// payload editor edits every field; these give a faithful visual on the canvas.

function foPreview(layer: Layer, w: number, h: number, inner: string): SVGElement {
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

const numOr = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

export function renderButton(layer: ButtonLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 200), h = numOr(layer.height, 46);
  const variant = layer.variant ?? 'solid';
  const bg = variant === 'solid' ? (layer.background ?? '#f5c842') : 'transparent';
  const col = layer.text_color ?? (variant === 'solid' ? '#0b0d12' : '#f5c842');
  const border = variant === 'ghost' || variant === 'link' ? 'none' : `1px solid ${layer.background ?? '#f5c842'}`;
  const r = layer.border_radius ?? 8;
  return foPreview(layer, w, h,
    `<div style="display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:100%;background:${bg};color:${col};border:${border};border-radius:${r}px;font-weight:600;">${layer.icon ? escHtml(layer.icon) + ' ' : ''}${escHtml(layer.label)}</div>`);
}

export function renderToggle(layer: ToggleLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 240), h = numOr(layer.height, 48);
  const opts = (layer.options ?? []).map((o, i) => {
    const lbl = typeof o === 'object' ? String(o.label) : String(o);
    const on = i === 0;
    return `<span style="padding:6px 14px;border-radius:6px;font-weight:600;${on ? 'background:#f5c842;color:#0b0d12;' : 'color:#9aa7b4;'}">${escHtml(lbl)}</span>`;
  }).join('');
  const lbl = layer.label ? `<span style="font-size:12px;color:#9aa7b4;font-weight:600;">${escHtml(layer.label)}</span>` : '';
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;gap:10px;height:100%;">${lbl}<div style="display:inline-flex;background:#1c1f2b;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:3px;gap:2px;">${opts}</div></div>`);
}

export function renderCallout(layer: CalloutLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 90);
  const v = layer.variant ?? 'info';
  const accent = { info: '#60a5fa', success: '#22c55e', warning: '#f5a623', danger: '#ef4444', neutral: '#9aa7b4' }[v];
  const icon = layer.icon ?? { info: 'ℹ', success: '✓', warning: '⚠', danger: '✕', neutral: '•' }[v];
  const title = layer.title ? `<div style="font-weight:700;margin-bottom:3px;">${escHtml(layer.title)}</div>` : '';
  // `content` is canonical; accept `text` as an alias (the field LLMs reach for).
  const body = layer.content ?? (layer as { text?: string }).text ?? '';
  return foPreview(layer, w, h,
    `<div style="display:flex;gap:12px;height:100%;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-left:4px solid ${accent};border-radius:10px;background:#161821;box-sizing:border-box;"><div style="color:${accent};font-size:18px;">${escHtml(icon)}</div><div style="font-size:14px;line-height:1.5;overflow:hidden;">${title}${escHtml(body)}</div></div>`);
}

export function renderProgress(layer: ProgressLayer, _svg: SVGSVGElement): SVGElement {
  const max = layer.max ?? 100;
  const pct = Math.max(0, Math.min(100, (layer.value / max) * 100));
  const color = layer.color ?? '#f5c842';
  const valText = `${layer.value}${layer.unit ?? (max === 100 ? '%' : '')}`;
  if (layer.style === 'radial') {
    const w = numOr(layer.width, 120), h = numOr(layer.height, 120);
    const r = 30, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return foPreview(layer, w, h,
      `<div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 80 80" style="width:90px;height:90px;transform:rotate(-90deg);"><circle cx="40" cy="40" r="${r}" fill="none" stroke="#1c1f2b" stroke-width="8"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><div style="position:absolute;font-weight:700;font-size:18px;">${escHtml(valText)}</div></div>`);
  }
  const w = numOr(layer.width, 280), h = numOr(layer.height, 60);
  const lbl = layer.label ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#9aa7b4;font-weight:600;margin-bottom:6px;"><span>${escHtml(layer.label)}</span><span>${escHtml(valText)}</span></div>` : '';
  return foPreview(layer, w, h,
    `<div style="display:flex;flex-direction:column;justify-content:center;height:100%;">${lbl}<div style="height:9px;border-radius:999px;background:#1c1f2b;overflow:hidden;"><div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:999px;"></div></div></div>`);
}

export function renderTooltip(layer: TooltipLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 40), h = numOr(layer.height, 40);
  const trig = layer.icon ? escHtml(layer.icon) : (layer.label ? escHtml(layer.label) : 'ℹ');
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:#1c1f2b;color:#9aa7b4;font-size:12px;font-weight:700;padding:0 7px;">${trig}</span></div>`);
}

export function renderFilterBar(layer: FilterBarLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 56);
  const opts: string[] = (layer.options ?? []).map(o => (typeof o === 'object' ? String((o as { label: unknown }).label) : String(o)));
  const lbl = layer.label ? `<span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9aa7b4;font-weight:700;">${escHtml(layer.label)}</span>` : '';
  const all = layer.include_all !== false ? `<span style="padding:6px 14px;border-radius:999px;background:#f5c842;color:#0b0d12;font-size:13px;font-weight:600;">All</span>` : '';
  const chips = opts.map(o => `<span style="padding:6px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:13px;">${escHtml(o)}</span>`).join('');
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;height:100%;">${lbl}${all}${chips}</div>`);
}

export function renderTabs(layer: TabsLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 300);
  const active = layer.active ?? 0;
  const bar = (layer.tabs ?? []).map((t, i) =>
    `<span style="padding:9px 16px;font-weight:600;${i === active ? 'color:#f5c842;border-bottom:2px solid #f5c842;' : 'color:#9aa7b4;'}">${escHtml(t.label)}</span>`).join('');
  const cnt = (layer.tabs?.[active]?.layers ?? []).length;
  return foPreview(layer, w, h,
    `<div style="display:flex;flex-direction:column;height:100%;"><div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.1);">${bar}</div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:#6b7685;font-size:13px;">Tab “${escHtml(layer.tabs?.[active]?.label ?? '')}” · ${cnt} layer(s)</div></div>`);
}

export function renderAccordion(layer: AccordionLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 200);
  const items = (layer.items ?? []).map((it, i) => {
    const open = it.open ?? (i === 0);
    const body = open ? `<div style="padding:0 16px 14px;font-size:13px;color:#c2cad4;line-height:1.5;">${escHtml((it.body ?? '').slice(0, 160))}</div>` : '';
    return `<div style="border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden;"><div style="padding:13px 16px;font-weight:600;display:flex;justify-content:space-between;">${escHtml(it.title)}<span style="color:#9aa7b4;">${open ? '▴' : '▾'}</span></div>${body}</div>`;
  }).join('');
  return foPreview(layer, w, h, `<div style="display:flex;flex-direction:column;gap:10px;">${items}</div>`);
}
