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
  const anims = collectLayerAnimations(pageLayers(spec, pageIndex));
  const css = anims.size > 0 ? generateDesignAnimationCSS(anims) : '';
  return { svg: injectStyle(svg, css), animatedLayers: [...anims.keys()] };
}

/**
 * Wrap an animated SVG in a single HTML file.
 *
 * Same pixels as the bare SVG, but it opens in any browser with a background
 * and centring, and `prefers-reduced-motion` is honored — a looping animation
 * that cannot be stopped is an accessibility problem, and the SVG on its own
 * has nowhere sensible to put that rule.
 */
export function wrapAnimatedHTML(svg: string, title: string): string {
  const safeTitle = title.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { display: grid; place-items: center; background: #f4f4f2; }
  svg { max-width: 100vw; max-height: 100vh; height: auto; }
  @media (prefers-reduced-motion: reduce) {
    svg * { animation: none !important; }
  }
</style>
</head>
<body>
${svg}
</body>
</html>
`;
}
