// Render a DesignSpec to an SVG string in either browser or Node.
//
// Browser: `document` and `XMLSerializer` are real globals — render directly.
// Node:    delegate to mcp/engine/svg-export which spins up a jsdom shim.
//
// The Node import is lazy so the browser bundle never pulls in jsdom and its
// dependency tree (which references SharedArrayBuffer at module top-level).

import { renderDesign } from '../renderer/renderer';
import type { DesignSpec } from '../schema/types';

export function renderToSVGStringUniversal(spec: DesignSpec): string {
  if (typeof document !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    const svgEl = renderDesign(spec);
    let raw = new XMLSerializer().serializeToString(svgEl);
    if (!raw.includes('xmlns=')) raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return raw;
  }
  // Node: defer the jsdom-backed renderer; it lives behind a guard so the
  // browser bundle never sees the import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('../mcp/engine/svg-export') as typeof import('../mcp/engine/svg-export');
  return mod.renderToSVGString(spec);
}
