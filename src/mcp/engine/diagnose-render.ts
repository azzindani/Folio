// Does this design actually RENDER? — the one question the diagnosis never asked.
//
// Every other check in diagnose.ts reasons about the spec: geometry, contrast,
// measured text. All of them can pass while a layer throws on the way to the
// canvas, because none of them ever draws it. The renderer, meanwhile, already
// knows: when a layer throws it catches, draws a dashed red box labelled
// `⚠ type#id`, and records the message on the group as `data-render-error`.
// Nothing read it.
//
// Measured live: a group whose members were authored under `children:` (the key
// almost every scene graph uses; Folio's is `layers:`) threw "Spread syntax
// requires ...iterable not be null or undefined", rendered as an empty warning
// box — and diagnose_design reported "No problems — 0 errors, 0 warnings".
//
// This asks the renderer instead of re-deriving its answer. That makes the check
// general: any layer that fails to draw, for any reason now or later, becomes a
// finding the model can act on, without this file having to know why.

import type { DesignSpec, Layer } from '../../schema/types';
import { renderToSVGString } from './svg-export';
import type { Finding } from './diagnose';

/** Layer ids the SVG marks as having thrown, with the message the renderer caught. */
function renderErrorsIn(svg: string): Array<{ id: string; message: string }> {
  const out: Array<{ id: string; message: string }> = [];
  // The placeholder <g> carries data-layer-id then data-render-error, in that
  // order (renderer.ts). Attribute values are serialised with " escaped.
  const re = /data-layer-id="([^"]*)"\s+data-render-error="([^"]*)"/g;
  for (const m of svg.matchAll(re)) {
    out.push({ id: m[1] ?? '?', message: (m[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') });
  }
  return out;
}

const unrenderableGroup = (layers: Layer[] | undefined, id: string): boolean => {
  for (const l of layers ?? []) {
    if (l.id === id) {
      const kids = (l as Layer & { layers?: unknown }).layers;
      return (l.type === 'group' || l.type === 'auto_layout') && !Array.isArray(kids);
    }
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids) && unrenderableGroup(kids, id)) return true;
  }
  return false;
};

/**
 * Render the design and report every layer that threw.
 *
 * Best effort by design: if rendering the WHOLE design fails there is nothing
 * to inspect, and the rest of the diagnosis still stands on its own — a broken
 * audit must not take the working checks down with it. One render per call,
 * only when not scoped to a single page.
 */
export function renderFailureFindings(spec: DesignSpec): Finding[] {
  let svg = '';
  try { svg = renderToSVGString(spec); } catch { return []; }
  const out: Finding[] = [];
  for (const { id, message } of renderErrorsIn(svg)) {
    const aliased = unrenderableGroup(spec.layers, id)
      || (spec.pages ?? []).some(p => unrenderableGroup(p.layers, id));
    out.push({
      code: 'layer_render_failed',
      severity: 'error',
      message: aliased
        ? `Layer "${id}" is a group with no \`layers\` — it renders as an empty ⚠ placeholder, and anything inside it is not drawn.`
        : `Layer "${id}" failed to render and was drawn as a ⚠ placeholder: ${message}`,
      layer_id: id,
      fix: aliased
        ? 'Group members go under `layers:`, not `children:`. Re-add them with add_layers, which folds the alias.'
        : 'Inspect this layer and fix the field the message names, or remove it.',
    });
  }
  return out;
}
