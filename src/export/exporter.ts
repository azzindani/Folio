import type { DesignSpec, ThemeSpec, Layer } from '../schema/types';
import type { AnimationSpec } from '../animation/types';
import { generateDesignAnimationCSS } from '../animation/css-generator';
import { renderEntry } from '../renderer/render-entry';
import type { RenderEntryResult } from '../renderer/render-entry';
import { PX2PT } from './pdf-draw';
import type { LoadedDataset } from '../report/data-loader';
import { checkCanvasScale } from './canvas-limit';
import { buildEmbeddedFontStyle } from './font-embed';
// @ts-expect-error — dom-to-image-more ships no types
import domtoimage from 'dom-to-image-more';

export type ExportFormat = 'svg' | 'png' | 'html' | 'html-animated' | 'html-report' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  scale?: number;
  theme?: ThemeSpec;
  pageIndex?: number;
  animations?: Map<string, AnimationSpec>;
  /**
   * The LIVE canvas container node from the editor. When provided, PNG/PDF
   * export captures this HTML node via dom-to-image — preserving charts, tables
   * and KPIs that JavaScript drew into foreignObjects (a static re-render or
   * SVG→`<img>` raster loses all of it). Must be an HTML element, not a bare
   * `<svg>` (that fails to load as an `<img>` and taints the canvas). Omit for
   * headless/programmatic export.
   */
  liveElement?: HTMLElement;
}

/**
 * Rasterize the live editor canvas with dom-to-image-more. Unlike SVG→`<img>`,
 * this clones the rendered DOM — reading each chart/vega `<svg>`/`<canvas>` and
 * KPI HTML — so the PNG matches what's on screen. Capturing an HTML container
 * (not a bare `<svg>`) is what makes this load reliably without tainting.
 */
async function liveCanvasToPNG(node: HTMLElement, width: number, height: number, scale: number): Promise<Blob> {
  return domtoimage.toBlob(node, {
    width: width * scale,
    height: height * scale,
    style: { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${width}px`, height: `${height}px` },
    bgcolor: '#ffffff',
  }) as Promise<Blob>;
}

export function exportToSVG(spec: DesignSpec, options: ExportOptions): string {
  const { svg } = renderForExport(spec, options);
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Serialize a rendered SVG with its web fonts inlined as `@font-face` data
 * URIs, so the file (and any `<img>`→canvas raster of it) renders the real
 * fonts instead of a serif fallback. Falls back to plain serialization if
 * font embedding yields nothing (no web fonts / offline).
 */
async function serializeWithFonts(svg: SVGSVGElement): Promise<string> {
  const style = await buildEmbeddedFontStyle(svg);
  if (style) svg.insertAdjacentHTML('afterbegin', style);
  return new XMLSerializer().serializeToString(svg);
}

/** Async SVG export with fonts embedded — used by the download path. */
export async function exportToSVGEmbedded(spec: DesignSpec, options: ExportOptions): Promise<string> {
  return serializeWithFonts(renderForExport(spec, options).svg);
}

export async function exportToPNG(spec: DesignSpec, options: ExportOptions): Promise<Blob> {
  const scale = options.scale ?? 2;

  // Capture the LIVE canvas ONLY when the design has interactive widgets
  // (charts/tables/KPIs) that JS drew into foreignObjects — a static re-render
  // loses those. For everything else (posters, static reports) the canonical
  // SVG render below is byte-identical to the editor preview, so we use it
  // instead of dom-to-image: the DOM screenshot is non-deterministic (font
  // races, partial CSS) and was the root cause of "preview ≠ export".
  // pageIndex set ⇒ carousel page; the live element is only the current page.
  if (options.liveElement && options.pageIndex === undefined && hasInteractiveContent(spec)) {
    const { width, height } = spec.document;
    const guard = checkCanvasScale(width, height, scale);
    if (guard.ok) {
      try {
        return await liveCanvasToPNG(options.liveElement, width, height, scale);
      } catch {
        // fall through to the static path
      }
    }
  }

  const { svg, width, height } = renderForExport(spec, options);

  // Guard against the browser canvas dimension ceiling. Without this,
  // canvas silently produces a blank image when W×scale or H×scale
  // exceeds ~16384px — there's no platform error to catch downstream.
  const guard = checkCanvasScale(width, height, scale);
  if (!guard.ok) throw new Error(guard.reason);

  const svgString = await serializeWithFonts(svg);

  const canvas = document.createElement('canvas');
  canvas.width  = guard.width;
  canvas.height = guard.height;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 15_000;
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('PNG export timed out — SVG image failed to load'));
    }, TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('PNG export failed: canvas.toBlob returned null'));
      }, 'image/png');
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('SVG to PNG conversion failed'));
    };
    img.src = url;
  });
}

/**
 * Overlay an INVISIBLE, selectable text layer onto a PDF page, aligned to the
 * live editor DOM. The visible pixels come from the raster image (so charts,
 * gradients and exact type are preserved); this adds the real text on top with
 * rendering mode "invisible" so it's selectable & copyable — the standard
 * searchable-PDF technique. Works for SVG <text> AND foreignObject HTML text,
 * since positions are measured from the rendered DOM via getBoundingClientRect.
 */
function addSelectableTextLayer(
  pdf: { setFontSize(n: number): void; text(t: string, x: number, y: number, o?: Record<string, unknown>): void },
  liveNode: HTMLElement,
  designWidth: number,
  pxToMm: (px: number) => number,
): void {
  const box = liveNode.getBoundingClientRect();
  if (box.width === 0) return;
  const zoom = box.width / designWidth; // editor zoom — DOM rects are on-screen px
  const walker = document.createTreeWalker(liveNode, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || !node.parentElement) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // getComputedStyle font-size is unaffected by ancestor zoom → design px.
    const fontPx = parseFloat(getComputedStyle(node.parentElement).fontSize) || r.height * 0.8;
    const dx = (r.left - box.left) / zoom;
    const baseline = (r.top - box.top) / zoom + fontPx * 0.8; // approx alphabetic baseline
    pdf.setFontSize(fontPx * (72 / 96)); // px → pt
    pdf.text(text, pxToMm(dx), pxToMm(baseline), { renderingMode: 'invisible', maxWidth: pxToMm(r.width / zoom) });
  }
}

/**
 * Add clickable PDF link annotations over every hyperlink in the live editor
 * DOM. Layer `href`s render as SVG/HTML `<a href>` (and rich-text markdown links
 * too), so measuring each `<a>` from the rendered DOM covers them all. Returns
 * the number of links added.
 */
function addLinkAnnotations(
  pdf: { link(x: number, y: number, w: number, h: number, o: { url: string }): void },
  liveNode: HTMLElement,
  designWidth: number,
  pxToMm: (px: number) => number,
): number {
  const box = liveNode.getBoundingClientRect();
  if (box.width === 0) return 0;
  const zoom = box.width / designWidth;
  let n = 0;
  for (const a of Array.from(liveNode.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href')
      ?? a.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || !/^(https?:|mailto:|tel:)/i.test(href)) continue;
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    pdf.link(
      pxToMm((r.left - box.left) / zoom),
      pxToMm((r.top - box.top) / zoom),
      pxToMm(r.width / zoom),
      pxToMm(r.height / zoom),
      { url: href },
    );
    n++;
  }
  return n;
}

/**
 * Hybrid VECTOR PDF in the browser: vectorizable text → real selectable jsPDF
 * glyphs (crisp at any zoom) with TTFs fetched from /fonts/, over a high-DPI
 * raster of the rest. Returns null when nothing could be vectorized (no bundled
 * fonts reachable / all gradient text) so the caller falls back to the raster +
 * invisible-text PDF, which keeps text selectable in that case. Skipped for
 * interactive designs (charts/tables live only in the DOM → raster path).
 */
async function exportToVectorPDF(spec: DesignSpec, options: ExportOptions): Promise<Blob | null> {
  const { jsPDF } = await import('jspdf');
  const { addBrowserVectorPdfPage } = await import('./pdf-vector-browser');
  const scale = options.scale ?? 2;
  const pages = spec.pages && spec.pages.length > 0 ? spec.pages : null;
  const targets: (number | undefined)[] = pages ? pages.map((_, i) => i) : [undefined];

  const registered = new Set<string>();
  let pdf: InstanceType<typeof jsPDF> | null = null;
  let totalRuns = 0;
  for (const pageIndex of targets) {
    const { svg, width, height } = renderEntry(spec, { theme: options.theme, pageIndex });
    const wPt = width * PX2PT, hPt = height * PX2PT;
    const orient = width >= height ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [wPt, hPt], compress: true });
    else pdf.addPage([wPt, hPt], orient);
    totalRuns += await addBrowserVectorPdfPage(pdf as unknown as import('./pdf-vector-browser').BrowserPdfDoc, svg, width, height, scale, registered);
  }
  // Nothing vectorized → let the raster+invisible-text path handle it (so text
  // stays selectable). Otherwise the vector PDF is the better artifact.
  if (!pdf || totalRuns === 0) return null;
  return pdf.output('blob');
}

export async function exportToPDF(spec: DesignSpec, options: ExportOptions): Promise<Blob> {
  // Prefer the true-vector PDF for non-interactive designs (selectable text,
  // infinite-zoom crispness). Charts/tables only exist in the live DOM, so
  // those designs go straight to the raster path. Any failure (offline fonts,
  // canvas limits) falls back too — never worse than the raster PDF.
  if (!hasInteractiveContent(spec)) {
    try {
      const vec = await exportToVectorPDF(spec, options);
      if (vec) return vec;
    } catch {
      // fall through to raster + invisible selectable text
    }
  }
  return exportToRasterPDF(spec, options);
}

async function exportToRasterPDF(spec: DesignSpec, options: ExportOptions): Promise<Blob> {
  // Lazy load jsPDF — kept out of initial bundle
  const { jsPDF } = await import('jspdf');
  const scale = options.scale ?? 2;

  const { width, height } = spec.document;

  // Convert px → mm (at 96 dpi: 1px = 25.4/96 mm)
  const pxToMm = (px: number): number => (px / 96) * 25.4;
  const pdfW = pxToMm(width);
  const pdfH = pxToMm(height);

  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pdfW, pdfH],
    compress: true,
  });

  if (spec.pages && spec.pages.length > 0) {
    // Carousel: one PDF page per design page
    for (let i = 0; i < spec.pages.length; i++) {
      if (i > 0) pdf.addPage([pdfW, pdfH], width >= height ? 'landscape' : 'portrait');
      const blob = await exportToPNG(spec, { ...options, pageIndex: i, scale });
      const dataUrl = await blobToDataURL(blob);
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH, undefined, 'FAST');
    }
  } else {
    // Single poster
    const blob = await exportToPNG(spec, { ...options, scale });
    const dataUrl = await blobToDataURL(blob);
    pdf.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH, undefined, 'FAST');
    // Overlay selectable text + clickable link annotations aligned to the live
    // editor DOM (raster stays the visible layer). Only with a live element.
    if (options.liveElement) {
      try { addSelectableTextLayer(pdf, options.liveElement, width, pxToMm); }
      catch { /* non-fatal — keep the raster-only PDF */ }
      try { addLinkAnnotations(pdf, options.liveElement, width, pxToMm); }
      catch { /* non-fatal — keep the PDF without link annotations */ }
    }
  }

  return pdf.output('blob');
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function exportToInteractiveHTML(
  spec: DesignSpec,
  datasets?: Map<string, LoadedDataset>,
  opts?: { theme?: 'light' | 'dark'; title?: string },
): Promise<string> {
  // Lazy-load the assembler so the interactive-report runtime (Chart.js wiring,
  // table runtime, etc.) is code-split into its own chunk and not shipped in
  // the main editor bundle.
  const { assembleReportHTML } = await import('./html-assembler');
  return assembleReportHTML(spec, datasets ?? new Map(), {
    title: opts?.title ?? spec.meta.name,
    theme: opts?.theme,
  });
}

const INTERACTIVE_TYPES = new Set<Layer['type']>([
  'interactive_chart', 'interactive_table', 'kpi_card', 'rich_text', 'embed_code',
]);

function hasInteractiveLayers(layers: Layer[] | undefined): boolean {
  if (!layers) return false;
  return layers.some(l => INTERACTIVE_TYPES.has(l.type)
    || hasInteractiveLayers((l as { layers?: Layer[] }).layers));
}

/** True if the spec contains layers that benefit from interactive HTML output. */
export function hasInteractiveContent(spec: DesignSpec): boolean {
  if (spec.pages && spec.pages.some(p => hasInteractiveLayers(p.layers))) return true;
  return hasInteractiveLayers(spec.layers);
}

export async function exportToHTML(spec: DesignSpec, options: ExportOptions): Promise<string> {
  // If the design has interactive widgets (charts/tables/KPIs), emit a full
  // interactive report instead of a static SVG-in-HTML wrapper.
  if (hasInteractiveContent(spec) || options.format === 'html-report') {
    // Auto-load any inline data sources so the report has data to render.
    let datasets: Map<string, LoadedDataset> | undefined;
    const sources = spec.report?.data?.sources;
    if (sources && sources.length > 0) {
      const { loadAllSources } = await import('../report/data-loader');
      datasets = await loadAllSources(sources);
    }
    return exportToInteractiveHTML(spec, datasets, {
      theme: options.theme && (options.theme as { mode?: 'light' | 'dark' }).mode === 'light' ? 'light' : 'dark',
    });
  }

  const svgString = exportToSVG(spec, options);

  const animationCSS = options.animations
    ? generateDesignAnimationCSS(options.animations)
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${spec.meta.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; display: flex; align-items: center; justify-content: center; background: #111; }
    svg { max-width: 100vw; max-height: 100vh; }
${animationCSS ? `    /* Design Animations */\n${animationCSS}` : ''}
  </style>
</head>
<body>
  ${svgString}
  <script type="application/yaml" id="design-data">
${JSON.stringify(spec, null, 2)}
  </script>
</body>
</html>`;
}

/**
 * The canonical export render — the SAME path the editor canvas and the MCP
 * server use (renderEntry), so a flow report lays out on its responsive grid
 * and a poster matches the preview pixel-for-pixel. Returns the SVG plus the
 * final artboard dimensions (which differ from document size for flow reports).
 */
function renderForExport(spec: DesignSpec, options: ExportOptions): RenderEntryResult {
  return renderEntry(spec, { theme: options.theme, pageIndex: options.pageIndex });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

/** Save blob via native file-save dialog when available; falls back to anchor download. */
async function saveBlob(blob: Blob, suggestedName: string, mimeType: string, ext: string): Promise<void> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as Window & typeof globalThis & {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>
      }).showSaveFilePicker({
        suggestedName,
        types: [{ description: ext.toUpperCase(), accept: { [mimeType]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled or API unavailable — fall through to download anchor
      if ((err as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(blob, suggestedName);
}

/** Save text via native file-save dialog when available; falls back to anchor download. */
async function saveText(content: string, suggestedName: string, mimeType: string, ext: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  await saveBlob(blob, suggestedName, mimeType, ext);
}

export async function exportDesign(spec: DesignSpec, options: ExportOptions): Promise<void> {
  const name = spec.meta.name.replace(/\s+/g, '-').toLowerCase();

  switch (options.format) {
    case 'svg': {
      const svg = await exportToSVGEmbedded(spec, options);
      await saveText(svg, `${name}.svg`, 'image/svg+xml', 'svg');
      break;
    }
    case 'png': {
      const blob = await exportToPNG(spec, options);
      await saveBlob(blob, `${name}.png`, 'image/png', 'png');
      break;
    }
    case 'html':
    case 'html-animated':
    case 'html-report': {
      const html = await exportToHTML(spec, options);
      await saveText(html, `${name}.html`, 'text/html', 'html');
      break;
    }
    case 'pdf': {
      const blob = await exportToPDF(spec, options);
      await saveBlob(blob, `${name}.pdf`, 'application/pdf', 'pdf');
      break;
    }
  }
}
