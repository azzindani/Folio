// Single render entry shared by the editor canvas, the browser exporter, and
// the MCP/server export path. Before this existed, each path branched on
// pages-vs-poster and flow-layout independently — so a flow report laid out in
// the editor canvas but stacked every layer at the origin when exported, and
// the studio preview never matched the rendered file. Routing all three through
// renderEntry makes "what you see" === "what you export" by construction.
//
// The function is deliberately free of any editor/MCP imports (renderer layer
// only) so it can run in the browser and under jsdom alike.

import type { DesignSpec, Layer } from '../schema/types';
import { computeFlowLayout } from './flow-layout';
import { renderDesign, renderPage } from './renderer';
import type { RenderOptions } from './renderer';

export interface RenderEntryOptions extends RenderOptions {
  /** Which page to render for paged designs (carousel/report). Defaults to 0. */
  pageIndex?: number;
  /** Override the flow-layout container width (else report.max_width → document width → 1200). */
  containerWidth?: number;
}

export interface RenderEntryResult {
  svg: SVGSVGElement;
  /** Final artboard width — equals the computed grid width for flow reports. */
  width: number;
  /** Final artboard height — equals the computed grid height for flow reports. */
  height: number;
  /** True when the design rendered through the responsive flow-grid layout. */
  isFlow: boolean;
}

/** True when the design is a responsive flow/scroll report (12-col grid, no fixed canvas). */
export function isFlowReport(spec: DesignSpec): boolean {
  const report = spec.report;
  return !!report && (report.layout === 'flow' || report.flow === true);
}

/** Flow-layout container width: explicit override → report.max_width → document width → 1200. */
function flowContainerWidth(spec: DesignSpec, override?: number): number {
  if (typeof override === 'number' && override > 0) return override;
  const mw = spec.report?.max_width;
  return (typeof mw === 'number' ? mw : 0) || spec.document.width || 1200;
}

/**
 * Render a design exactly as the editor canvas would: select the active page
 * (or poster root), apply the responsive flow-grid layout when the design is a
 * flow report, and return the SVG plus the final artboard dimensions. Every
 * consumer (canvas, PNG/PDF/SVG export, MCP) calls this so they cannot drift.
 */
export function renderEntry(spec: DesignSpec, opts: RenderEntryOptions = {}): RenderEntryResult {
  const { width, height } = spec.document;
  const { pageIndex, containerWidth, ...renderOpts } = opts;
  const flow = isFlowReport(spec);

  // renderDesign reads spec.theme.overrides itself; renderPage doesn't, so
  // forward them here (design overrides win, matching renderDesign) — otherwise
  // a paged design's theme overrides would silently vanish on the page path.
  const pageOpts: RenderOptions = { ...renderOpts, themeOverrides: spec.theme?.overrides ?? renderOpts.themeOverrides };

  const renderFlow = (layers: Layer[]): RenderEntryResult => {
    const cw = flowContainerWidth(spec, containerWidth);
    const fl = computeFlowLayout(layers, { containerWidth: cw });
    // Flow grids own their geometry — the editorial grid overlay (fixed columns)
    // would be meaningless here, so force it off to match the canvas.
    const svg = renderPage(layers, fl.width, fl.height, { ...pageOpts, showGrid: false });
    return { svg, width: fl.width, height: fl.height, isFlow: true };
  };

  const pages = spec.pages;
  if (pages && pages.length > 0) {
    const idx = Math.min(Math.max(pageIndex ?? 0, 0), pages.length - 1);
    const layers = pages[idx]?.layers ?? [];
    if (flow) return renderFlow(layers);
    return { svg: renderPage(layers, width, height, pageOpts), width, height, isFlow: false };
  }

  // No pages → poster (or a flow report authored at the root).
  if (flow && spec.layers) return renderFlow(spec.layers);

  return { svg: renderDesign(spec, renderOpts), width, height, isFlow: false };
}
