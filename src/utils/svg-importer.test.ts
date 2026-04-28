import { describe, it, expect } from 'vitest';
import { parseSVGString, extractSVGColors, recolorSVG } from './svg-importer';

const simpleSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">
  <rect fill="#ff0000" stroke="#0000ff" width="50" height="50"/>
</svg>`;

const viewboxSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">
  <circle fill="#00ff00" r="40"/>
</svg>`;

describe('parseSVGString', () => {
  it('parses width and height from attributes', () => {
    const result = parseSVGString(simpleSVG, 'test');
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
    expect(result.name).toBe('test');
  });

  it('falls back to viewBox dimensions when no width/height attrs', () => {
    const result = parseSVGString(viewboxSVG, 'vb');
    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
  });

  it('returns a data URL', () => {
    const result = parseSVGString(simpleSVG);
    expect(result.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('extracts colors', () => {
    const result = parseSVGString(simpleSVG);
    expect(result.colors).toContain('#ff0000');
    expect(result.colors).toContain('#0000ff');
  });

  it('uses default name "icon"', () => {
    const result = parseSVGString(simpleSVG);
    expect(result.name).toBe('icon');
  });

  it('throws on invalid SVG', () => {
    expect(() => parseSVGString('<not-svg><broken')).toThrow();
  });

  it('defaults dimensions to 100 when neither width/height nor viewBox present', () => {
    const svgNoSize = `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
    const result = parseSVGString(svgNoSize);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });
});

describe('extractSVGColors', () => {
  it('extracts hex fill and stroke colors', () => {
    const doc = new DOMParser().parseFromString(simpleSVG, 'image/svg+xml');
    const colors = extractSVGColors(doc.documentElement);
    expect(colors).toContain('#ff0000');
    expect(colors).toContain('#0000ff');
  });

  it('skips "none", "currentColor", "inherit"', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="none" stroke="currentColor"/>
      <circle fill="inherit"/>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const colors = extractSVGColors(doc.documentElement);
    expect(colors).not.toContain('none');
    expect(colors).not.toContain('currentcolor');
    expect(colors.length).toBe(0);
  });

  it('converts rgb() values to hex', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="rgb(255, 128, 0)"/>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const colors = extractSVGColors(doc.documentElement);
    expect(colors).toContain('#ff8000');
  });

  it('extracts colors from style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect style="fill:#aabbcc;stroke:#112233"/>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const colors = extractSVGColors(doc.documentElement);
    expect(colors).toContain('#aabbcc');
    expect(colors).toContain('#112233');
  });

  it('deduplicates colors', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#ff0000"/>
      <circle fill="#ff0000"/>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const colors = extractSVGColors(doc.documentElement);
    expect(colors.filter(c => c === '#ff0000').length).toBe(1);
  });
});

describe('recolorSVG', () => {
  it('replaces color in SVG data URL', () => {
    const original = parseSVGString(simpleSVG);
    const colorMap = new Map([['#ff0000', '#00ff00']]);
    const recolored = recolorSVG(original.dataUrl, colorMap);
    expect(recolored).toMatch(/^data:image\/svg\+xml;base64,/);
    // Decode and check the color was replaced
    const decoded = atob(recolored.replace('data:image/svg+xml;base64,', ''));
    expect(decoded).toContain('#00ff00');
  });

  it('handles empty colorMap without crashing', () => {
    const original = parseSVGString(simpleSVG);
    const result = recolorSVG(original.dataUrl, new Map());
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
