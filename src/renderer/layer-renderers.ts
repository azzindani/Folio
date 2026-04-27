import type {
  Layer, RectLayer, CircleLayer, PathLayer, PolygonLayer,
  LineLayer, TextLayer, ImageLayer, IconLayer,
  MermaidLayer, ChartLayer, CodeLayer, MathLayer, GroupLayer,
  QRCodeLayer, AutoLayoutLayer, ColorOrGradient,
} from '../schema/types';
import { createSVGElement, getOrCreateDefs } from './svg-utils';
import { applyFill, resolveColorOrGradient } from './fill-renderer';
import { applyEffects } from './effects-renderer';
import { LUCIDE_ICONS } from './lucide-icons';
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
export function renderText(layer: TextLayer, svg: SVGSVGElement): SVGElement {
  const g = createSVGElement('g');
  const style = layer.style ?? {};

  if (layer.content.type === 'markdown') {
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

    const mdValue = (layer.content as { value: string }).value;
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
  } else if (layer.content.type === 'rich') {
    const textEl = createSVGElement('text', {
      x: layer.x ?? 0,
      y: (layer.y ?? 0) + (style.font_size ?? 16),
    });
    textEl.setAttribute('font-family', style.font_family ?? 'Inter, sans-serif');
    textEl.setAttribute('font-size', String(style.font_size ?? 16));

    for (const span of layer.content.spans) {
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
    const value = layer.content.value;
    const lines = wrapPlainText(value, typeof layer.width === 'number' ? layer.width : undefined, fontSize);

    // Compute x anchor
    const anchor = style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start';
    let textX = layer.x ?? 0;
    if (style.align === 'center' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width / 2;
    else if (style.align === 'right' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width;

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
    if (style.align) textEl.setAttribute('text-anchor', anchor);

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

// ── Icon ────────────────────────────────────────────────────
export function renderIcon(layer: IconLayer, svg: SVGSVGElement): SVGElement {
  const size = layer.size ?? 24;
  const color = layer.color ?? 'currentColor';
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;

  const g = createSVGElement('g');
  g.setAttribute('transform', `translate(${x}, ${y})`);

  const inner = LUCIDE_ICONS[layer.name];

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
    const placed: Layer = {
      ...child,
      x: isRow ? x + mc : x + crossPos,
      y: isRow ? y + crossPos : y + mc,
      ...(align === 'stretch' &&  isRow ? { height: trackCross } : {}),
      ...(align === 'stretch' && !isRow ? { width:  trackCross } : {}),
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
