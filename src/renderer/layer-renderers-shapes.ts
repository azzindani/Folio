// Folio renderer — SVG-native shape/text/image/icon renderers (verbatim).
import type { RectLayer, CircleLayer, PathLayer, PolygonLayer, LineLayer, TextLayer, ImageLayer, IconLayer } from '../schema/types';
import { createSVGElement, getOrCreateDefs, defIdFor, appendDefOnce } from './svg-utils';
import { resolveAssetUrl } from './render-context';

import { applyFill, resolveColorOrGradient, type FillResult } from './fill-renderer';
import { applyEffects } from './effects-renderer';
import { LUCIDE_ICONS, resolveIconName } from './lucide-icons';
import { shapePath } from '../engine/shape-paths';

import { wrapPlainText, applyCommonAttributes, applyStroke, normalizeStroke, roundedRectPath, normalizeTextLayer, transformText, applyTypography } from './layer-renderers-shared';

// Resolve a shape's fill, tolerating a bare `color` string. Small models very
// often emit `{type:'rect', color:'#0A0A0A'}` (color is the universal "make it
// this colour" word) with no `fill`. The schema fill lives under `fill`, so
// without this fallback the shape renders fill="none" (transparent) and a
// full-canvas background rect silently VANISHES → a white poster (the #1
// blank-design cause for verbose/mixed payloads that bypass shorthand expansion).
// Treat a stray color as a solid fill so the model's unambiguous intent renders.
function shapeFill(
  layer: { fill?: unknown; color?: unknown },
  svg: SVGSVGElement,
  box: { width: number; height: number; x?: number; y?: number },
): FillResult | null {
  if (layer.fill !== undefined && layer.fill !== null) {
    return applyFill(layer.fill as Parameters<typeof applyFill>[0], svg, box);
  }
  const c = layer.color;
  if (typeof c === 'string' && c.trim()) return applyFill({ type: 'solid', color: c }, svg, box);
  return null;
}

/**
 * A `noise` fill paints nothing on the shape itself: applyFill returns
 * `fill:'none'` plus a SIBLING rect carrying the turbulence filter, which the
 * caller has to place. Only the LAYOUT renderer ever did — these four read
 * `.fill` and dropped `.extraElements`, so `fill:{type:"noise"}` rendered an
 * invisible layer and left an orphaned <filter> in every SVG export. The
 * engine's own background composer emits exactly that shape for a grain sweep,
 * so 22 of 276 library designs carry a grain nobody has ever seen.
 *
 * Wraps only when there is something to add, so every other shape's output is
 * byte-identical to before. Extras go AFTER the shape — grain is an overlay.
 */
function withFillExtras(el: SVGElement, fillResult: FillResult | null, layerId: string): SVGElement {
  const extras = fillResult?.extraElements;
  if (!extras || extras.length === 0) return el;
  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layerId);
  g.appendChild(el);
  for (const extra of extras) g.appendChild(extra);
  return g;
}

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

  const fillResult = shapeFill(layer, svg, { width: w, height: h, x, y });
  if (fillResult) {
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) el.setAttribute('fill-opacity', String(fillResult.opacity));
  } else {
    el.setAttribute('fill', 'none');
  }

  const sn = normalizeStroke(layer);
  if (sn) applyStroke(el, sn, svg);

  applyCommonAttributes(el, layer);

  if (layer.effects) applyEffects(el, layer.effects, svg);

  return withFillExtras(el, fillResult, layer.id);
}

// ── Circle ──────────────────────────────────────────────────

export function renderCircle(layer: CircleLayer, svg: SVGSVGElement): SVGElement {
  const cx = layer.cx ?? ((layer.x ?? 0) + ((typeof layer.width === 'number' ? layer.width : 0) / 2));
  const cy = layer.cy ?? ((layer.y ?? 0) + ((typeof layer.height === 'number' ? layer.height : 0) / 2));
  const rx = layer.rx ?? ((typeof layer.width === 'number' ? layer.width : 0) / 2);
  const ry = layer.ry ?? ((typeof layer.height === 'number' ? layer.height : 0) / 2);

  const el = createSVGElement('ellipse', { cx, cy, rx, ry });

  const fillResult = shapeFill(layer, svg, { width: rx * 2, height: ry * 2, x: cx - rx, y: cy - ry });
  if (fillResult) {
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) {
      el.setAttribute('fill-opacity', String(fillResult.opacity));
    }
  } else {
    el.setAttribute('fill', 'none');
  }

  const sn = normalizeStroke(layer);
  if (sn) applyStroke(el, sn, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return withFillExtras(el, fillResult, layer.id);
}

// ── Path ────────────────────────────────────────────────────

export function renderPath(layer: PathLayer, svg: SVGSVGElement): SVGElement {
  const el = createSVGElement('path', { d: layer.d });
  if (layer.fill_rule) el.setAttribute('fill-rule', layer.fill_rule);

  const fillResult = shapeFill(layer, svg, {
    width: typeof layer.width === 'number' ? layer.width : 100,
    height: typeof layer.height === 'number' ? layer.height : 100,
    x: layer.x ?? 0, y: layer.y ?? 0,
  });
  if (fillResult) {
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) el.setAttribute('fill-opacity', String(fillResult.opacity));
  } else {
    el.setAttribute('fill', 'none');
  }

  const sn = normalizeStroke(layer);
  if (sn) applyStroke(el, sn, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return withFillExtras(el, fillResult, layer.id);
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

  const fillResult = shapeFill(layer, svg, {
    width: typeof layer.width === 'number' ? layer.width : 0,
    height: typeof layer.height === 'number' ? layer.height : 0,
    x: layer.x ?? 0, y: layer.y ?? 0,
  });
  if (fillResult) {
    el.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) el.setAttribute('fill-opacity', String(fillResult.opacity));
  } else {
    el.setAttribute('fill', 'none');
  }

  const sn = normalizeStroke(layer);
  if (sn) applyStroke(el, sn, svg);
  applyCommonAttributes(el, layer);
  if (layer.effects) applyEffects(el, layer.effects, svg);

  return withFillExtras(el, fillResult, layer.id);
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
  const lineStroke = normalizeStroke(layer);
  if (lineStroke) {
    applyStroke(el, lineStroke, svg);
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
    if (style.font_weight) textEl.setAttribute('font-weight', String(style.font_weight));
    applyTypography(textEl, style);

    for (const span of content.spans) {
      const tspan = createSVGElement('tspan');
      tspan.textContent = transformText(span.text, style.text_transform);
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
    const value = transformText(content.value, style.text_transform);

    const alignVal = style.text_align ?? style.align;
    const anchor = alignVal === 'center' ? 'middle' : alignVal === 'right' ? 'end' : 'start';
    const textColor = style.color
      ? resolveColorOrGradient(style.color, getOrCreateDefs(svg))
      : '#000';

    if (style.text_path?.d) {
      // Curve a single line of text along an arbitrary SVG path.
      const pathId = defIdFor('textpath', style.text_path.d);
      appendDefOnce(getOrCreateDefs(svg), createSVGElement('path', { id: pathId, d: style.text_path.d, fill: 'none' }));
      const textEl = createSVGElement('text');
      textEl.setAttribute('font-family', style.font_family ?? 'Inter, sans-serif');
      textEl.setAttribute('font-size', String(fontSize));
      textEl.setAttribute('font-weight', String(style.font_weight ?? 400));
      if (style.letter_spacing) textEl.setAttribute('letter-spacing', `${style.letter_spacing}px`);
      if (alignVal) textEl.setAttribute('text-anchor', anchor);
      textEl.setAttribute('fill', textColor);
      applyTypography(textEl, style);
      const tp = createSVGElement('textPath');
      tp.setAttribute('href', `#${pathId}`);
      tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pathId}`);
      const off = style.text_path.start_offset;
      tp.setAttribute('startOffset', `${off != null ? off : alignVal === 'center' ? 50 : 0}%`);
      if (style.text_path.side) tp.setAttribute('side', style.text_path.side);
      tp.textContent = value;
      textEl.appendChild(tp);
      g.appendChild(textEl);
    } else {
      // Widen the char estimate for wider glyph runs so the line actually fits
      // its box: monospace (~0.60), ALL-CAPS (+0.06), plus literal letter-spacing.
      // Plain sans mixed-case keeps the original 0.52 → no change to those lines.
      const fam = (style.font_family ?? '').toLowerCase();
      const isMono = /\bmono\b|monospace|courier|consolas|menlo/.test(fam);
      // ALL-CAPS runs wider — whether forced via text_transform OR the string is
      // already literally uppercase (a model very often types a CAPS headline). Both
      // need the wider factor or the line under-wraps and bleeds off the right edge.
      const isUpper = style.text_transform === 'uppercase'
        || (value.length > 2 && value === value.toUpperCase() && /[A-Z]/.test(value));
      let factor = isMono ? 0.60 : 0.52;
      if (isUpper) factor += 0.06;
      const perChar = factor === 0.52 ? undefined
        : fontSize * factor + (typeof style.letter_spacing === 'number' ? Math.max(0, style.letter_spacing) : 0);
      const lines = wrapPlainText(value, typeof layer.width === 'number' ? layer.width : undefined, fontSize, perChar);
      let textX = layer.x ?? 0;
      if (alignVal === 'center' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width / 2;
      else if (alignVal === 'right' && typeof layer.width === 'number') textX = (layer.x ?? 0) + layer.width;

      let textY = (layer.y ?? 0) + fontSize;
      if (typeof layer.height === 'number' && style.vertical_align) {
        const totalH = lines.length * lineH;
        if (style.vertical_align === 'middle') textY = (layer.y ?? 0) + (layer.height - totalH) / 2 + fontSize;
        else if (style.vertical_align === 'bottom') textY = (layer.y ?? 0) + layer.height - totalH + fontSize;
      }

      // Marker/highlight band behind the text (estimated width — matches wrap heuristic).
      if (style.highlight) {
        // Monospace glyphs are wider than the 0.54em sans average; widen so the
        // band covers every char (an undersized chip clips the last letter).
        const mono = /mono|courier|consol/i.test(style.font_family ?? '');
        const cw = fontSize * (mono ? 0.62 : 0.54);
        for (let i = 0; i < lines.length; i++) {
          const lw = lines[i].length * cw + (style.letter_spacing ?? 0) * Math.max(0, lines[i].length - 1);
          let rx = textX;
          if (anchor === 'middle') rx = textX - lw / 2; else if (anchor === 'end') rx = textX - lw;
          const pad = fontSize * 0.12;
          g.appendChild(createSVGElement('rect', {
            x: rx - pad, y: textY + i * lineH - fontSize * 0.82,
            width: lw + pad * 2, height: fontSize * 1.04, fill: style.highlight,
          }));
        }
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
      textEl.setAttribute('fill', textColor);
      applyTypography(textEl, style);

      if (lines.length > 1) {
        for (let i = 0; i < lines.length; i++) {
          const tspan = createSVGElement('tspan', { x: String(textX), dy: i === 0 ? '0' : String(lineH) });
          tspan.textContent = lines[i];
          textEl.appendChild(tspan);
        }
      } else {
        textEl.textContent = lines[0] ?? '';
      }
      g.appendChild(textEl);
    }
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

  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 100;
  const h = typeof layer.height === 'number' ? layer.height : 100;

  const el = createSVGElement('image', {
    x, y, width: w, height: h,
    // Editor: project-relative srcs route through /__project_files (see
    // render-context). Server export: no resolver installed — srcs arrive
    // pre-embedded as data: URIs.
    href: resolveAssetUrl(layer.src),
  });

  // focal:[fx,fy] (0–1) — keep the subject when cover-cropping. SVG's
  // preserveAspectRatio only knows thirds (Min/Mid/Max), which is exactly the
  // "keep the face in the left third" control a blind model needs, and it
  // rasterizes identically in resvg.
  if (Array.isArray(layer.focal) && layer.focal.length === 2) {
    const part = (v: number): string => (v < 0.34 ? 'Min' : v > 0.66 ? 'Max' : 'Mid');
    const fx = Math.max(0, Math.min(1, Number(layer.focal[0]) || 0));
    const fy = Math.max(0, Math.min(1, Number(layer.focal[1]) || 0));
    el.setAttribute('preserveAspectRatio', `x${part(fx)}Y${part(fy)} slice`);
  } else if (layer.fit === 'cover' || layer.fit === 'contain') {
    el.setAttribute('preserveAspectRatio', layer.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
  } else if (layer.mask) {
    el.setAttribute('preserveAspectRatio', 'xMidYMid slice');   // a mask implies cover
  }

  if (!layer.mask && !layer.overlay && !layer.frame) {
    applyCommonAttributes(el, layer);
    if (layer.effects) applyEffects(el, layer.effects, svg);
    return el;
  }

  // Treatments: <g> [clip(img + overlay)] + frame — pure SVG, resvg-safe.
  const g = createSVGElement('g', {});
  let clipRef: string | undefined;
  if (layer.mask) {
    const maskD = imageMaskPath(layer.mask, x, y, w, h, layer.id);
    const cid = defIdFor('imgclip', maskD);
    const clip = createSVGElement('clipPath', { id: cid });
    clip.appendChild(createSVGElement('path', { d: maskD }));
    appendDefOnce(getOrCreateDefs(svg), clip);
    clipRef = `url(#${cid})`;
  }
  const inner = createSVGElement('g', clipRef ? { 'clip-path': clipRef } : {});
  inner.appendChild(el);
  if (layer.overlay) {
    const o = layer.overlay;
    const scrim = createSVGElement('rect', {
      x, y, width: w, height: h,
      fill: o.fill ?? '#000000', opacity: String(o.opacity ?? 0.35),
    });
    if (o.blend) scrim.setAttribute('style', `mix-blend-mode:${o.blend}`);
    inner.appendChild(scrim);
  }
  g.appendChild(inner);
  if (layer.frame) {
    const f = layer.frame;
    const off = f.offset ?? 0;
    const d = layer.mask
      ? imageMaskPath(layer.mask, x - off, y - off, w + off * 2, h + off * 2, layer.id)
      : `M ${x - off} ${y - off} h ${w + off * 2} v ${h + off * 2} h ${-(w + off * 2)} Z`;
    g.appendChild(createSVGElement('path', {
      d, fill: 'none', stroke: f.stroke ?? '#1A1A1A', 'stroke-width': String(f.width ?? 3),
    }));
  }
  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

/** Mask outline for a photo treatment — absolute coords so the same fn draws
 *  the clip AND the (offset) frame stroke. Blob is seeded from the layer id,
 *  so re-renders are stable (no Math.random in the render path). */
function imageMaskPath(mask: NonNullable<ImageLayer['mask']>, x: number, y: number, w: number, h: number, id: string): string {
  switch (mask) {
    case 'circle':   // ellipse inscribed in the box (a square box = a true circle)
      return `M ${x} ${y + h / 2} a ${w / 2} ${h / 2} 0 1 0 ${w} 0 a ${w / 2} ${h / 2} 0 1 0 ${-w} 0 Z`;
    case 'rounded': {
      const r = Math.min(w, h) * 0.14;
      return roundedRectPath(x, y, w, h, { tl: r, tr: r, br: r, bl: r });
    }
    case 'arch': {   // semicircular top + straight sides (portrait doorway crop)
      const r = w / 2;
      if (h <= r) return roundedRectPath(x, y, w, h, { tl: h / 2, tr: h / 2, br: 0, bl: 0 });
      return `M ${x} ${y + h} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
    }
    case 'hex':      // flat-top hexagon inscribed in the box
      return `M ${x + w * 0.25} ${y} L ${x + w * 0.75} ${y} L ${x + w} ${y + h / 2} L ${x + w * 0.75} ${y + h} L ${x + w * 0.25} ${y + h} L ${x} ${y + h / 2} Z`;
    case 'blob': {
      const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
      return shapePath('blob', { x, y, w, h }, { seed }).d;
    }
  }
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

  // A purely-numeric "icon name" ("01", "1"…) means a NUMBERED badge, not a
  // glyph — models reach for it on numbered feature cards. Render the number in
  // a ring (both in the accent color) instead of the empty-ring fallback, which
  // read as a broken icon. Strip a leading zero so "01" shows as "1".
  const numName = (layer.name ?? '').trim();
  if (!inner && /^\d{1,2}$/.test(numName)) {
    const label = numName.replace(/^0+(?=\d)/, '');
    g.appendChild(createSVGElement('circle', {
      cx: size / 2, cy: size / 2, r: Math.max(2, size / 2 - 1),
      fill: 'none', stroke: color, 'stroke-width': '2',
    }));
    const num = createSVGElement('text', {
      x: size / 2, y: Math.round(size / 2 + size * 0.18),
      fill: color, 'font-size': String(Math.round(size * 0.5)), 'font-weight': '700',
      'text-anchor': 'middle', 'font-family': 'Inter, system-ui, sans-serif',
    });
    num.textContent = label;
    g.appendChild(num);
    applyCommonAttributes(g, layer);
    if (layer.effects) applyEffects(g, layer.effects, svg);
    return g;
  }

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
    // Unknown icon → a SOLID accent dot. A blind model can't see that its name
    // didn't resolve; a hollow ring at icon size read as an empty/broken slot
    // next to real glyphs, whereas a small filled disc reads as an intentional
    // bullet/marker. (The emoji + alias maps resolve the vast majority; this is
    // the last resort, and diagnoseLayers still WARNS for an agentic caller.)
    const dot = createSVGElement('circle', {
      cx: size / 2, cy: size / 2, r: Math.max(2, size * 0.26),
      fill: color, stroke: 'none',
    });
    g.appendChild(dot);
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

// ── Mermaid ─────────────────────────────────────────────────
// Lazy-loads mermaid on first use; renders asynchronously into
// a foreignObject container and updates the DOM once done.
