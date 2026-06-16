// Shared vector-text drawing for jsPDF, used by BOTH the server (mcp/engine/
// pdf-build) and the browser (export/pdf-vector-browser) so a run renders
// identically whichever path produced the PDF. Browser-safe (no Node imports).

import type { VectorTextRun } from './pdf-vector-text';

/** px → pt at 96 dpi (PDF user space is points). */
export const PX2PT = 72 / 96;

/** The slice of the jsPDF text/font API the drawer touches. */
export interface PdfTextDoc {
  addFileToVFS(file: string, b64: string): void;
  addFont(file: string, family: string, style: string): void;
  setFont(family: string, style?: string): void;
  setFontSize(pt: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(text: string, x: number, y: number, opts?: Record<string, unknown>): void;
}

export function alignOf(anchor: VectorTextRun['anchor']): 'left' | 'center' | 'right' {
  return anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
}

/** Draw one resolved run as selectable vector text at its SVG-derived position. */
export function drawVectorRun(
  pdf: PdfTextDoc,
  run: VectorTextRun,
  pick: { alias: string; fauxBold: boolean },
): void {
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
