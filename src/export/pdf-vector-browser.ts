// Browser hybrid vector-PDF page builder — the editor counterpart to the MCP's
// mcp/engine/pdf-build. Same shape: vectorizable text → real jsPDF glyphs
// (selectable, crisp at any zoom) over a high-DPI raster of everything else
// (backgrounds/gradients/effects), so the editor's "Download PDF" matches the
// server's PDF. The raster here is a browser `<img>`→canvas render of the
// text-stripped SVG (no resvg/Chromium).

import { extractVectorTextCandidates } from './pdf-vector-text';
import { drawVectorRun, PX2PT, type PdfTextDoc } from './pdf-draw';
import { loadVectorFont, type BrowserFontPick } from './pdf-fonts-browser';
import { buildEmbeddedFontStyle } from './font-embed';
import { inlineExternalImages } from './image-embed';
import { checkCanvasScale } from './canvas-limit';

export interface BrowserPdfDoc extends PdfTextDoc {
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string): void;
}

/** Rasterize an SVG element to a PNG data URL via `<img>`→canvas, embedding web
 *  fonts so any text left in the raster renders correctly (not a serif fallback). */
async function svgToPngDataURL(svg: SVGSVGElement, width: number, height: number, scale: number): Promise<string> {
  const guard = checkCanvasScale(width, height, scale);
  if (!guard.ok) throw new Error(guard.reason);
  // Assets first: this raster goes through the same SVG-in-`<img>` restriction
  // that drops every external href (see image-embed.ts).
  await inlineExternalImages(svg);
  const style = await buildEmbeddedFontStyle(svg);
  if (style) svg.insertAdjacentHTML('afterbegin', style);
  const svgString = new XMLSerializer().serializeToString(svg);

  const canvas = document.createElement('canvas');
  canvas.width = guard.width;
  canvas.height = guard.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.scale(scale, scale);

  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('SVG image load timed out')), 15_000);
      img.onload = () => { clearTimeout(timer); ctx.drawImage(img, 0, 0); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('SVG image failed to load')); };
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas.toDataURL('image/png');
}

/**
 * Render one page into `pdf`: load fonts + collect vectorizable text, strip
 * those nodes, raster the rest, place the raster, then draw the text as vector.
 * Returns the number of vector runs drawn (0 ⇒ nothing vectorizable on this page).
 */
export async function addBrowserVectorPdfPage(
  pdf: BrowserPdfDoc,
  svg: SVGSVGElement,
  width: number,
  height: number,
  scale: number,
  registered: Set<string>,
): Promise<number> {
  const draw: { run: import('./pdf-vector-text').VectorTextRun; pick: BrowserFontPick }[] = [];
  for (const cand of extractVectorTextCandidates(svg)) {
    const picks: (BrowserFontPick | null)[] = [];
    for (const run of cand.runs) {
      picks.push(await loadVectorFont(pdf, run.family, run.weight, registered));
    }
    if (picks.some(p => p === null)) continue; // unbundled/unreachable font → keep in raster
    cand.el.remove();
    cand.runs.forEach((run, i) => draw.push({ run, pick: picks[i] as BrowserFontPick }));
  }

  const dataURL = await svgToPngDataURL(svg, width, height, scale);
  pdf.addImage(dataURL, 'PNG', 0, 0, width * PX2PT, height * PX2PT, undefined, 'FAST');
  for (const { run, pick } of draw) drawVectorRun(pdf, run, pick);
  return draw.length;
}
