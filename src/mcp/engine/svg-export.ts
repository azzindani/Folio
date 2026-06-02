// Server-side DOM shim. Importing this module sets up jsdom globals so any
// later code (renderer, html-assembler) can call document/XMLSerializer.
import { JSDOM } from 'jsdom';
import { renderDesign } from '../../renderer/renderer';
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

export function renderToSVGString(spec: DesignSpec, formulaContext?: import('../../scripting/formula').FormulaContext, theme?: ThemeSpec, componentRegistry?: Map<string, ComponentSpec>): string {
  ensureDOM();
  // Resolve the design's theme so color/typography tokens ($surface, $text…)
  // render with real values. Without a theme, renderDesign leaves tokens
  // unresolved and they fall back to black — invisible content. Default to the
  // referenced builtin theme; callers can pass a custom ThemeSpec to override.
  const resolvedTheme = theme ?? (spec.theme?.ref ? BUILTIN_THEMES[spec.theme.ref] : undefined);
  const svgEl = renderDesign(spec, { formulaContext, theme: resolvedTheme, componentRegistry });
  let raw = (serializer as { serializeToString(el: Node): string }).serializeToString(svgEl);
  raw = raw.replace(/(<svg[^>]*?) xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '$1');
  if (!raw.includes('xmlns=')) raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return raw;
}
