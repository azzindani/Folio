import type { DesignSpec, ThemeSpec, Layer } from '../schema/types';
import type { AnimationSpec } from '../animation/types';
import { generateDesignAnimationCSS } from '../animation/css-generator';
import { renderDesign, renderPage } from '../renderer/renderer';
import type { LoadedDataset } from '../report/data-loader';

export type ExportFormat = 'svg' | 'png' | 'html' | 'html-animated' | 'html-report' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  scale?: number;
  theme?: ThemeSpec;
  pageIndex?: number;
  animations?: Map<string, AnimationSpec>;
}

export function exportToSVG(spec: DesignSpec, options: ExportOptions): string {
  const svg = renderForExport(spec, options);
  return new XMLSerializer().serializeToString(svg);
}

export async function exportToPNG(spec: DesignSpec, options: ExportOptions): Promise<Blob> {
  const scale = options.scale ?? 2;
  const svg = renderForExport(spec, options);
  const svgString = new XMLSerializer().serializeToString(svg);

  const { width, height } = spec.document;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
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

export async function exportToPDF(spec: DesignSpec, options: ExportOptions): Promise<Blob> {
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

function renderForExport(spec: DesignSpec, options: ExportOptions): SVGSVGElement {
  const { width, height } = spec.document;

  if (spec.pages && options.pageIndex !== undefined) {
    const page = spec.pages[options.pageIndex];
    return renderPage(page?.layers ?? [], width, height, { theme: options.theme });
  }

  return renderDesign(spec, { theme: options.theme });
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
      const svg = exportToSVG(spec, options);
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
