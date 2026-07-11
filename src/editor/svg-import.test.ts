// jsdom has no getCTM → ctmOf falls back to identity, so shapes import at their
// raw coordinates. That still exercises the element walk, type mapping, and
// paint extraction (the transform math is covered in svg-path-transform.test).
import { describe, it, expect } from 'vitest';
import { svgToLayers } from './svg-import';

describe('svgToLayers', () => {
  it('imports each primitive as its native layer type', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
      <rect x="10" y="20" width="60" height="40" fill="#3b82f6" rx="4"/>
      <circle cx="100" cy="75" r="25" fill="#ef4444"/>
      <path d="M0 0L10 10Z" fill="#111"/>
      <line x1="0" y1="0" x2="50" y2="50" stroke="#000"/>
      <polygon points="0,0 10,0 5,10" fill="#0a0"/>
    </svg>`;
    const { layers, width, height } = svgToLayers(svg);
    expect(width).toBe(200);
    expect(height).toBe(150);
    const types = layers.map(l => l.type);
    expect(types).toEqual(['rect', 'ellipse', 'path', 'line', 'polygon']);
    const rect = layers[0] as unknown as { x: number; y: number; width: number; radius?: number; fill?: { color?: string } };
    expect(rect.x).toBe(10); expect(rect.width).toBe(60); expect(rect.radius).toBe(4);
    expect(rect.fill?.color).toBe('#3b82f6');
  });

  it('reads fill from inline style too', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect x="0" y="0" width="5" height="5" style="fill:#abcdef"/></svg>`;
    const l = svgToLayers(svg).layers[0] as unknown as { fill?: { color?: string } };
    expect(l.fill?.color).toBe('#abcdef');
  });

  it('skips elements inside <defs>', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <defs><rect x="0" y="0" width="1" height="1"/></defs>
      <rect x="2" y="2" width="3" height="3" fill="#000"/>
    </svg>`;
    expect(svgToLayers(svg).layers).toHaveLength(1);
  });

  it('rejects invalid SVG', () => {
    expect(() => svgToLayers('<svg><rect')).toThrow();
  });
});
