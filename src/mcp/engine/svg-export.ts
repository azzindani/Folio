// Server-side DOM shim. Importing this module sets up jsdom globals so any
// later code (renderer, html-assembler) can call document/XMLSerializer.
import { JSDOM } from 'jsdom';
import { invalidateCache } from '../../renderer/renderer';
import { renderEntry } from '../../renderer/render-entry';
import { BUILTIN_THEMES } from '../../themes/builtin';
import type { DesignSpec, ThemeSpec, ComponentSpec } from '../../schema/types';

let serializer: { serializeToString(el: Node): string } | null = null;

export function ensureDOM(): void {
  if (serializer) return;
  const dom = new JSDOM('<!DOCTYPE html>', { pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  g['document'] = dom.window.document;
  g['window']   = dom.window;
  if (typeof (g['XMLSerializer']) === 'undefined') {
    g['XMLSerializer'] = dom.window.XMLSerializer;
  }
  serializer = new dom.window.XMLSerializer();
}

// Install eagerly so this module's mere import is enough to enable
// browser-style rendering anywhere in Node.
ensureDOM();

/**
 * Render a design to a live SVG element (jsdom). Returned BEFORE serialization
 * so callers that need the DOM — e.g. the vector-PDF builder, which walks
 * `<text>` nodes — can read it directly instead of re-parsing a string (markdown
 * foreignObject HTML isn't valid XML, so a re-parse would throw).
 */
export function renderToSVGElement(spec: DesignSpec, formulaContext?: import('../../scripting/formula').FormulaContext, theme?: ThemeSpec, componentRegistry?: Map<string, ComponentSpec>): SVGSVGElement {
  ensureDOM();
  // Resolve the design's theme so color/typography tokens ($surface, $text…)
  // render with real values. Without a theme, renderDesign leaves tokens
  // unresolved and they fall back to black — invisible content. Default to the
  // referenced builtin theme; callers can pass a custom ThemeSpec to override.
  const resolvedTheme = theme ?? (spec.theme?.ref ? BUILTIN_THEMES[spec.theme.ref] : undefined);
  // Server-side export is stateless and the MCP process is long-lived: the
  // render cache (keyed by layer.id) would otherwise leak across designs —
  // a same-id+same-hash layer reuses a prior render's element WITHOUT
  // re-emitting its gradient/<defs>, leaving a dead url(#…) ref (e.g. every
  // feature_grid's "feature_grid_1_bg"). Clear it so each export is clean.
  invalidateCache();
  // renderEntry (not renderDesign) so flow reports get the same responsive
  // grid layout the editor canvas applies — otherwise a flow report exports
  // with every layer stacked at the origin while the studio shows the grid.
  return renderEntry(spec, { formulaContext, theme: resolvedTheme, componentRegistry }).svg;
}

/** Serialize a rendered SVG element to a string, normalizing the root xmlns
 *  (jsdom can emit it twice; resvg wants exactly one). */
export function serializeSVGElement(svgEl: SVGSVGElement): string {
  ensureDOM();
  let raw = (serializer as { serializeToString(el: Node): string }).serializeToString(svgEl);
  raw = raw.replace(/(<svg[^>]*?) xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '$1');
  if (!raw.includes('xmlns=')) raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return raw;
}

export function renderToSVGString(spec: DesignSpec, formulaContext?: import('../../scripting/formula').FormulaContext, theme?: ThemeSpec, componentRegistry?: Map<string, ComponentSpec>): string {
  return serializeSVGElement(renderToSVGElement(spec, formulaContext, theme, componentRegistry));
}
