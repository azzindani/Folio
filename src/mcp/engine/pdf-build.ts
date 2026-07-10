// Hybrid vector PDF page builder (server-side, no browser/Chromium).
//
// A page becomes: a high-DPI resvg raster of everything EXCEPT the vectorizable
// text (backgrounds, gradients, shapes, effects, charts) + the text drawn as
// real jsPDF glyphs on top. Result: text is selectable/copyable AND stays sharp
// at any zoom, while the visual fidelity of gradients/effects is preserved by
// the raster. Text we can't place exactly (gradient fill, rotation, curved
// paths, unbundled fonts) is simply left in the raster — never worse than the
// old all-raster PDF.

import { Resvg } from '@resvg/resvg-js';
import { resvgFontOption } from './fonts';
import { serializeSVGElement } from './svg-export';
import { extractVectorTextCandidates, type VectorTextRun } from '../../export/pdf-vector-text';
import { PX2PT, drawVectorRun, type PdfTextDoc } from '../../export/pdf-draw';
import { pickFont, fontFileBase64, type FontPick } from './pdf-fonts';

/** Minimal slice of the jsPDF surface the builder touches (draw + raster). */
export interface PdfDoc extends PdfTextDoc {
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string): void;
}

export interface PdfPageInput {
  /** Live rendered SVG element for this page (walked + mutated in place). */
  svg: SVGSVGElement;
  width: number;
  height: number;
}

/**
 * Render one page into `pdf` as a vector-text PDF. `registered` tracks fonts
 * already embedded in this document so each TTF is added once. Returns the
 * number of vector text runs drawn (0 ⇒ fully raster, e.g. a chart-only page).
 */
export function addVectorPdfPage(
  pdf: PdfDoc,
  page: PdfPageInput,
  scale: number,
  registered: Set<string>,
  projectDir?: string,
): number {
  const svgEl = page.svg;

  // Decide which text to vectorize; strip those nodes so the raster doesn't
  // paint them too (double text / fuzzy ghosting otherwise).
  const draw: { run: VectorTextRun; pick: FontPick }[] = [];
  for (const cand of extractVectorTextCandidates(svgEl)) {
    const picks = cand.runs.map(r => pickFont(r.family, r.weight, projectDir));
    if (picks.some(p => p === null)) continue; // unbundled font → keep in raster
    cand.el.remove();
    cand.runs.forEach((run, i) => draw.push({ run, pick: picks[i] as FontPick }));
  }

  const stripped = serializeSVGElement(svgEl);
  const png = Buffer.from(new Resvg(stripped, {
    fitTo: { mode: 'zoom', value: scale },
    background: 'rgba(255,255,255,1)',
    font: resvgFontOption(projectDir),
  }).render().asPng());

  const wPt = page.width * PX2PT;
  const hPt = page.height * PX2PT;
  pdf.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 0, 0, wPt, hPt, undefined, 'FAST');

  for (const { run, pick } of draw) {
    if (!registered.has(pick.alias)) {
      pdf.addFileToVFS(pick.file, fontFileBase64(pick.file));
      pdf.addFont(pick.file, pick.alias, 'normal');
      registered.add(pick.alias);
    }
    drawVectorRun(pdf, run, pick);
  }

  return draw.length;
}
