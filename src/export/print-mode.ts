import { type StateManager } from '../editor/state';
import { renderDesign, renderPage } from '../renderer/renderer';
import type { DesignSpec } from '../schema/types';

export interface PrintOptions {
  bleed?: number;        // bleed margin in px (default 0)
  cropMarks?: boolean;   // show crop/trim marks (default true)
  colorBars?: boolean;   // show color registration bars (default false)
  pageNumbers?: boolean; // show page numbers on multi-page (default false)
}

/**
 * Open a new browser window styled for printing,
 * with optional bleed marks and crop marks.
 */
export function openPrintWindow(state: StateManager, opts: PrintOptions = {}): void {
  const { design, theme } = state.get();
  if (!design) return;

  const bleed     = opts.bleed      ?? 0;
  const cropMarks = opts.cropMarks  ?? true;

  const pages = collectPages(design);
  const { width, height } = design.document;

  // Build HTML for each page
  const pageSVGs = pages.map((layers, i) => {
    let svg: SVGSVGElement;
    if (design.pages && design.pages.length > 0) {
      svg = renderPage(layers, width, height, { theme: theme ?? undefined });
    } else {
      svg = renderDesign(design, { theme: theme ?? undefined });
    }
    svg.setAttribute('width',  String(width));
    svg.setAttribute('height', String(height));

    const cropSVG = cropMarks
      ? buildCropMarksSVG(width, height, bleed)
      : '';

    const pageNum = opts.pageNumbers && pages.length > 1
      ? `<div style="text-align:center;font:10px sans-serif;color:#999;margin-top:4px">Page ${i + 1} of ${pages.length}</div>`
      : '';

    return `
      <div class="print-page" style="
        position:relative;
        width:${width + bleed * 2}px;
        height:${height + bleed * 2}px;
        margin: 32px auto;
        page-break-after: always;
      ">
        ${cropSVG}
        <div style="position:absolute;left:${bleed}px;top:${bleed}px">
          ${svg.outerHTML}
        </div>
      </div>
      ${pageNum}`;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${design.meta.name} — Print</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #e8e8e8; font-family: sans-serif; }
    @media print {
      body { background: white; }
      .no-print { display: none !important; }
      .print-page { margin: 0 !important; page-break-after: always; }
    }
    .toolbar {
      position: fixed; top: 0; left: 0; right: 0;
      background: #333; color: #fff; padding: 8px 16px;
      display: flex; align-items: center; gap: 12px; z-index: 99;
      font-size: 13px;
    }
    .toolbar button {
      padding: 4px 14px; border-radius: 4px; border: none; cursor: pointer;
      background: #6c5ce7; color: #fff; font-size: 12px;
    }
    .content { padding-top: 48px; }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <span>${design.meta.name}</span>
    <button onclick="window.print()">🖨 Print</button>
    <button onclick="window.close()">✕ Close</button>
    <span style="margin-left:auto;font-size:11px;opacity:.6">
      ${width}×${height}px${bleed ? ` + ${bleed}px bleed` : ''}
    </span>
  </div>
  <div class="content">
    ${pageSVGs.join('\n')}
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function collectPages(design: DesignSpec): Array<import('../schema/types').Layer[]> {
  if (design.pages && design.pages.length > 0) {
    return design.pages.map(p => p.layers ?? []);
  }
  return [design.layers ?? []];
}

function buildCropMarksSVG(w: number, h: number, bleed: number): string {
  const total_w = w + bleed * 2;
  const total_h = h + bleed * 2;
  const markLen = 14;
  const gap     = 4;

  const lines: string[] = [];
  const mark = (x1: number, y1: number, x2: number, y2: number) => {
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.5"/>`);
  };

  // Top-left corner
  mark(bleed - gap - markLen, bleed, bleed - gap, bleed);
  mark(bleed, bleed - gap - markLen, bleed, bleed - gap);
  // Top-right corner
  mark(bleed + w + gap, bleed, bleed + w + gap + markLen, bleed);
  mark(bleed + w, bleed - gap - markLen, bleed + w, bleed - gap);
  // Bottom-left corner
  mark(bleed - gap - markLen, bleed + h, bleed - gap, bleed + h);
  mark(bleed, bleed + h + gap, bleed, bleed + h + gap + markLen);
  // Bottom-right corner
  mark(bleed + w + gap, bleed + h, bleed + w + gap + markLen, bleed + h);
  mark(bleed + w, bleed + h + gap, bleed + w, bleed + h + gap + markLen);

  return `<svg xmlns="http://www.w3.org/2000/svg"
    style="position:absolute;top:0;left:0;pointer-events:none"
    width="${total_w}" height="${total_h}" viewBox="0 0 ${total_w} ${total_h}">
    ${lines.join('\n')}
  </svg>`;
}
