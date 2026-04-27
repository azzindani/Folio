// Server-side SVG export using jsdom to satisfy document.createElementNS calls.
// The renderer only touches `document` inside function bodies, not at import time,
// so setting globalThis.document before calling renderDesign() is sufficient.
import { JSDOM } from 'jsdom';
import { renderDesign } from '../../renderer/renderer';
import type { DesignSpec } from '../../schema/types';

let serializer: { serializeToString(el: Node): string } | null = null;

function ensureDOM(): void {
  if (serializer) return;
  const dom = new JSDOM('<!DOCTYPE html>', { pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  g['document'] = dom.window.document;
  g['window']   = dom.window;
  serializer = new dom.window.XMLSerializer();
}

export function renderToSVGString(spec: DesignSpec): string {
  ensureDOM();
  const svgEl = renderDesign(spec);
  let raw = (serializer as { serializeToString(el: Node): string }).serializeToString(svgEl);
  // Remove duplicate xmlns added by jsdom serializer alongside the one in createSVGRoot
  raw = raw.replace(/(<svg[^>]*?) xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '$1');
  if (!raw.includes('xmlns=')) raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return raw;
}
