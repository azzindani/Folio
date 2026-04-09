import type { DesignSpec, ThemeSpec } from '../schema/types';
import { renderDesign, renderPage } from '../renderer/renderer';

export type ExportFormat = 'svg' | 'png' | 'html' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  scale?: number;
  theme?: ThemeSpec;
  pageIndex?: number;
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
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('PNG export failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG to PNG conversion failed'));
    };
    img.src = url;
  });
}

export function exportToHTML(spec: DesignSpec, options: ExportOptions): string {
  const svgString = exportToSVG(spec, options);
  const { width, height } = spec.document;

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

export async function exportDesign(spec: DesignSpec, options: ExportOptions): Promise<void> {
  const name = spec.meta.name.replace(/\s+/g, '-').toLowerCase();

  switch (options.format) {
    case 'svg': {
      const svg = exportToSVG(spec, options);
      downloadText(svg, `${name}.svg`, 'image/svg+xml');
      break;
    }
    case 'png': {
      const blob = await exportToPNG(spec, options);
      downloadBlob(blob, `${name}.png`);
      break;
    }
    case 'html': {
      const html = exportToHTML(spec, options);
      downloadText(html, `${name}.html`, 'text/html');
      break;
    }
    case 'pdf': {
      // PDF export uses the PNG pipeline + jsPDF (lazy loaded)
      const blob = await exportToPNG(spec, { ...options, scale: options.scale ?? 2 });
      downloadBlob(blob, `${name}-print.png`);
      break;
    }
  }
}
