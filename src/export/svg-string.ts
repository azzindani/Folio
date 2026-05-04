import { renderDesign } from '../renderer/renderer';
import type { DesignSpec } from '../schema/types';

/**
 * Render a DesignSpec to an SVG string using the global `document` +
 * `XMLSerializer`. In the browser these are real globals. In Node, callers
 * (MCP server) must install a DOM shim (jsdom) onto globalThis BEFORE calling
 * this function — see src/mcp/engine/svg-export.ts which does exactly that.
 *
 * Keeping this module DOM-agnostic (no jsdom import) is critical: the editor
 * bundle stays small and free of node-only dependencies.
 */
export function renderToSVGStringUniversal(spec: DesignSpec): string {
  if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error(
      'renderToSVGStringUniversal: no DOM available. Call from a browser, or ' +
      'install a jsdom shim on globalThis before calling (see mcp/engine/svg-export.ts).',
    );
  }
  const svgEl = renderDesign(spec);
  let raw = new XMLSerializer().serializeToString(svgEl);
  raw = raw.replace(/(<svg[^>]*?) xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '$1');
  if (!raw.includes('xmlns=')) raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return raw;
}
