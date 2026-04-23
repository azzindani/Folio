// SVG import: parse dimensions + colors, return data URL. No dependencies.

export interface SVGImportResult {
  dataUrl: string;
  width: number;
  height: number;
  colors: string[];     // unique fill/stroke hex colors found in SVG
  name: string;
}

export async function importSVGFile(file: File): Promise<SVGImportResult> {
  const text = await file.text();
  return parseSVGString(text, file.name.replace(/\.svg$/i, ''));
}

export function parseSVGString(svgText: string, name = 'icon'): SVGImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('Invalid SVG: ' + parseErr.textContent?.slice(0, 80));

  const root = doc.documentElement;

  // Dimensions: prefer viewBox, fall back to width/height attrs
  const vbParts = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [];
  const width  = parseFloat(root.getAttribute('width')  ?? '') || vbParts[2] || 100;
  const height = parseFloat(root.getAttribute('height') ?? '') || vbParts[3] || 100;

  const colors = extractSVGColors(root);
  const dataUrl = svgToDataUrl(doc);

  return { dataUrl, width, height, colors, name };
}

// Replace colors in an SVG data URL. colorMap: oldHex → newHex
export function recolorSVG(svgDataUrl: string, colorMap: Map<string, string>): string {
  const raw = atob(svgDataUrl.replace(/^data:image\/svg\+xml;base64,/, ''));
  let text = decodeURIComponent(escape(raw));
  for (const [from, to] of colorMap) {
    // Case-insensitive replacement of hex color in attribute values
    text = text.split(from.toLowerCase()).join(to)
               .split(from.toUpperCase()).join(to);
  }
  return svgTextToDataUrl(text);
}

// ── Internal helpers ────────────────────────────────────────────

function extractSVGColors(root: Element): string[] {
  const seen = new Set<string>();

  const push = (val: string | null) => {
    if (!val || val === 'none' || val === 'currentColor' || val === 'inherit') return;
    if (val.startsWith('#')) { seen.add(val.toLowerCase()); return; }
    if (val.startsWith('rgb')) {
      const m = val.match(/\d+/g);
      if (m && m.length >= 3) {
        seen.add('#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join(''));
      }
    }
  };

  root.querySelectorAll('*').forEach(el => {
    push(el.getAttribute('fill'));
    push(el.getAttribute('stroke'));
    const style = el.getAttribute('style') ?? '';
    push(style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/)?.[1]?.trim() ?? null);
    push(style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/)?.[1]?.trim() ?? null);
  });

  return [...seen];
}

function svgToDataUrl(doc: Document): string {
  const ser = new XMLSerializer().serializeToString(doc);
  return svgTextToDataUrl(ser);
}

function svgTextToDataUrl(text: string): string {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
}
