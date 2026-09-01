/**
 * Binary-free motion export: a design plus its keyframes as one self-contained
 * animated SVG (or a single HTML file wrapping it).
 *
 * Why this exists: the only motion route Folio shipped went through Puppeteer
 * (to screenshot frames) and ffmpeg (to encode them). The deployed container
 * has neither, and adding a headless Chromium plus an encoder to a 4g
 * `bun --smol` box to produce a looping logo is the wrong trade.
 *
 * SVG animates natively. The renderer already tags every layer with
 * `data-layer-id`, and the CSS generator already turns an AnimationSpec into
 * `@keyframes` rules that match those selectors — so the whole export is:
 * render the SVG, generate the CSS, inline it in a `<style>` element. No
 * browser, no encoder, no new dependency, and the result is vector: sharp at
 * any size and typically a few KB rather than a few MB.
 */

import type { DesignSpec, Layer } from '../schema/types';
import type { AnimationSpec } from '../animation/types';
import { generateDesignAnimationCSS } from '../animation/css-generator';
import { usesDraw } from '../animation/keyframe-css';

export interface AnimatedSVGOptions {
  /** Which page of a multi-page design to export. Defaults to the first. */
  pageIndex?: number;
  /**
   * Render function, injected so this module stays free of the DOM shim that
   * server-side SVG rendering needs. Callers pass the engine's renderToSVGString.
   */
  renderSVG: (spec: DesignSpec, pageIndex: number) => string;
}

export interface AnimatedSVGResult {
  svg: string;
  /** Layer ids that carry animation — empty means the SVG is a still image. */
  animatedLayers: string[];
}

/** Walk layers depth-first, including group children, collecting animations. */
export function collectLayerAnimations(layers: Layer[]): Map<string, AnimationSpec> {
  const out = new Map<string, AnimationSpec>();

  const visit = (layer: Layer): void => {
    const anim = (layer as Layer & { animation?: AnimationSpec }).animation;
    if (anim && typeof layer.id === 'string') out.set(layer.id, anim);
    // Groups nest arbitrarily deep, and a carousel page is one locked group —
    // a non-recursive walk would find no animations at all on MCP-authored work.
    const children = (layer as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(children)) for (const c of children) visit(c);
  };

  for (const l of layers) visit(l);
  return out;
}

/** The layers that make up the exported page: page N of a deck, or the poster root. */
export function pageLayers(spec: DesignSpec, pageIndex: number): Layer[] {
  const pages = spec.pages;
  if (pages && pages.length > 0) {
    const idx = Math.min(Math.max(pageIndex, 0), pages.length - 1);
    return pages[idx]?.layers ?? [];
  }
  return spec.layers ?? [];
}

/**
 * Insert a `<style>` block immediately after the opening `<svg …>` tag.
 *
 * The CSS is wrapped in CDATA because an SVG file is parsed as XML: a bare `>`
 * or `&` inside a stylesheet (from a child selector or an entity) would make
 * the document malformed and every strict viewer would refuse to open it.
 */
export function injectStyle(svg: string, css: string): string {
  if (!css.trim()) return svg;
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) return svg;
  const at = (open.index ?? 0) + open[0].length;
  const style = `<style type="text/css"><![CDATA[\n${css}\n]]></style>`;
  return svg.slice(0, at) + style + svg.slice(at);
}

/** Render one page of a design as a self-contained animated SVG. */
export function buildAnimatedSVG(spec: DesignSpec, opts: AnimatedSVGOptions): AnimatedSVGResult {
  const pageIndex = opts.pageIndex ?? 0;
  const svg = opts.renderSVG(spec, pageIndex);

  const layers = pageLayers(spec, pageIndex);
  const anims = collectLayerAnimations(layers);

  // Also honour the top-level `spec.animations` map. That is the shape the
  // EDITOR reads and writes, so a design animated there — rather than through
  // the MCP ops, which write per-layer — would otherwise export as a still.
  // Per-layer wins on a conflict: it is the authoritative field, and the
  // top-level map is a mirror of it.
  const ids = new Set<string>();
  const collectIds = (ls: Layer[]): void => {
    for (const l of ls) {
      if (typeof l.id === 'string') ids.add(l.id);
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) collectIds(kids);
    }
  };
  collectIds(layers);

  const specAnims = (spec as DesignSpec & { animations?: Record<string, AnimationSpec> }).animations;
  if (specAnims) {
    for (const [id, anim] of Object.entries(specAnims)) {
      // Only for layers actually on THIS page — a carousel's map covers every
      // page, and styling an absent id would emit dead CSS.
      if (!anims.has(id) && ids.has(id) && anim) anims.set(id, anim);
    }
  }

  const css = anims.size > 0 ? generateDesignAnimationCSS(anims) : '';
  const drawIds = [...anims.entries()].filter(([, a]) => usesDraw(a)).map(([id]) => id);
  return { svg: injectStyle(normalisePathLength(svg, drawIds), css), animatedLayers: [...anims.keys()] };
}

/**
 * Give every stroked shape inside a "draw" layer `pathLength="1"`.
 *
 * A stroke reveal animates `stroke-dashoffset` from 1 to 0 against a dash of
 * length 1, which only means "the whole outline" when the browser measures
 * the path as 1 unit long. Without this the offset would be one PIXEL of a
 * two-thousand-pixel path and nothing visible would happen. Done on the
 * string after render so the renderer stays ignorant of animation.
 */
export function normalisePathLength(svg: string, drawIds: string[]): string {
  if (drawIds.length === 0) return svg;
  let out = svg;
  for (const id of drawIds) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The element carrying the id (a bare shape) …
    out = out.replace(
      new RegExp(`<(path|line|polyline|polygon|rect|circle|ellipse)\\b([^>]*\\bdata-layer-id="${esc}"[^>]*?)(/?)>`, 'g'),
      (_m, tag: string, attrs: string, close: string) => attrs.includes('pathLength=') ? _m : `<${tag}${attrs} pathLength="1"${close}>`,
    );
    // … or a group wrapping shapes (a hand-drawn illustration, a connector).
    const grp = new RegExp(`<g\\b[^>]*\\bdata-layer-id="${esc}"[^>]*>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = grp.exec(out)) !== null) {
      const startIdx = m.index + m[0].length;
      const endIdx = closingGroup(out, startIdx);
      if (endIdx < 0) break;
      const inner = out.slice(startIdx, endIdx).replace(
        /<(path|line|polyline|polygon|rect|circle|ellipse)\b([^>]*?)(\/?)>/g,
        (whole, tag: string, attrs: string, close: string) => attrs.includes('pathLength=') ? whole : `<${tag}${attrs} pathLength="1"${close}>`,
      );
      out = out.slice(0, startIdx) + inner + out.slice(endIdx);
      grp.lastIndex = startIdx + inner.length;
    }
  }
  return out;
}

/** Index of the `</g>` that closes the group whose content starts at `from`. */
function closingGroup(svg: string, from: number): number {
  let depth = 1;
  const re = /<g\b[^>]*?(\/?)>|<\/g>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    if (m[0] === '</g>') { depth--; if (depth === 0) return m.index; }
    else if (m[1] !== '/') depth++;
  }
  return -1;
}

/**
 * Wrap an animated SVG in a single HTML file — the playback surface.
 *
 * This is the file to open when you want to WATCH the animation, and it exists
 * because a one-shot entrance is otherwise nearly impossible to see: CSS plays
 * it once when the document loads, and by the time anyone has finished opening
 * the file it has already finished. There is no way to ask CSS to run it again
 * without touching the DOM, so the page carries a Replay control that does.
 *
 * Replay works by removing every animation, forcing a reflow, and restoring
 * them. Re-assigning the same animation name is a no-op to the engine — the
 * declaration has not changed, so nothing restarts — and the forced reflow
 * between the two is what makes the browser treat it as new.
 *
 * `prefers-reduced-motion` is honored: a loop the viewer cannot stop is an
 * accessibility problem, and the bare SVG has nowhere sensible to put that rule.
 */
export function wrapAnimatedHTML(svg: string, title: string, animated = true): string {
  const esc = (s: string): string => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
  const safeTitle = esc(title);

  const controls = animated ? `
<div class="bar">
  <button id="replay" type="button">↻ Replay</button>
  <span class="hint">Loops run continuously · entrances play once</span>
</div>
<script>
  document.getElementById('replay').addEventListener('click', function () {
    var svg = document.querySelector('svg');
    if (!svg) return;
    var nodes = svg.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) nodes[i].style.animation = 'none';
    void svg.getBoundingClientRect();   // force reflow — without it nothing restarts
    for (var j = 0; j < nodes.length; j++) nodes[j].style.animation = '';
  });
</script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  html, body { margin: 0; min-height: 100%; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; padding: 24px; box-sizing: border-box; background: #f4f4f2;
    font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  svg { max-width: 100%; max-height: 80vh; height: auto; }
  .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }
  button {
    font: inherit; padding: 8px 16px; border: 1px solid #c9c9c4; border-radius: 6px;
    background: #fff; color: #1c1c1a; cursor: pointer;
  }
  button:hover { background: #ecebe7; }
  .hint { color: #6b6b66; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #17171a; color: #e8e8e4; }
    button { background: #24242a; border-color: #3a3a42; color: #e8e8e4; }
    button:hover { background: #2f2f37; }
    .hint { color: #93939a; }
  }
  @media (prefers-reduced-motion: reduce) {
    svg * { animation: none !important; }
  }
</style>
</head>
<body>
${svg}${controls}
</body>
</html>
`;
}
