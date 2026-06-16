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
import { pickFont, fontFileBase64, type FontPick } from './pdf-fonts';

const PX2PT = 72 / 96;

/** Minimal slice of the jsPDF surface the builder touches. */
export interface PdfDoc {
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string): void;
  addFileToVFS(file: string, b64: string): void;
  addFont(file: string, family: string, style: string): void;
  setFont(family: string, style?: string): void;
  setFontSize(pt: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(text: string, x: number, y: number, opts?: Record<string, unknown>): void;
}

export interface PdfPageInput {
  /** Live rendered SVG element for this page (walked + mutated in place). */
  svg: SVGSVGElement;
  width: number;
  height: number;
}

function alignOf(anchor: VectorTextRun['anchor']): 'left' | 'center' | 'right' {
  return anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
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
): number {
  const svgEl = page.svg;

  // Decide which text to vectorize; strip those nodes so the raster doesn't
  // paint them too (double text / fuzzy ghosting otherwise).
  const draw: { run: VectorTextRun; pick: FontPick }[] = [];
  for (const cand of extractVectorTextCandidates(svgEl)) {
    const picks = cand.runs.map(r => pickFont(r.family, r.weight));
    if (picks.some(p => p === null)) continue; // unbundled font → keep in raster
    cand.el.remove();
    cand.runs.forEach((run, i) => draw.push({ run, pick: picks[i] as FontPick }));
  }

  const stripped = serializeSVGElement(svgEl);
  const png = Buffer.from(new Resvg(stripped, {
    fitTo: { mode: 'zoom', value: scale },
    background: 'rgba(255,255,255,1)',
    font: resvgFontOption(),
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
    pdf.setFont(pick.alias, 'normal');
    pdf.setFontSize(run.fontSize * PX2PT);
    pdf.setTextColor(run.color[0], run.color[1], run.color[2]);
    const opts: Record<string, unknown> = { align: alignOf(run.anchor), baseline: 'alphabetic' };
    if (run.letterSpacing) opts.charSpace = run.letterSpacing * PX2PT;
    if (pick.fauxBold) {
      // Variable family with no dedicated bold file → thicken with a hairline
      // stroke so a 700/900 heading doesn't render at the 400 default instance.
      pdf.setDrawColor(run.color[0], run.color[1], run.color[2]);
      pdf.setLineWidth(run.fontSize * PX2PT * 0.022);
      opts.renderingMode = 'fillThenStroke';
    } else {
      opts.renderingMode = 'fill';
    }
    pdf.text(run.text, run.x * PX2PT, run.baseline * PX2PT, opts);
  }

  return draw.length;
}
