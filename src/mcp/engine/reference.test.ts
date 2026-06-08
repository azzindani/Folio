import { describe, it, expect } from 'vitest';
import {
  hexToRgb, toHex, luminance, saturation, dedupeColors,
  parseDimensions, parseSvg, classifyPalette, recommendCanvas, extractReference,
} from './reference';

describe('color math', () => {
  it('parses 3- and 6-digit hex and drops alpha', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#FF3D00')).toEqual([255, 61, 0]);
    expect(hexToRgb('#FF3D00CC')).toEqual([255, 61, 0]);
    expect(hexToRgb('nope')).toBeNull();
  });
  it('roundtrips toHex', () => {
    expect(toHex([10, 10, 10])).toBe('#0a0a0a');
    expect(toHex([300, -5, 128])).toBe('#ff0080'); // clamps
  });
  it('ranks luminance and saturation', () => {
    expect(luminance([0, 0, 0])).toBeLessThan(luminance([255, 255, 255]));
    expect(saturation([128, 128, 128])).toBeCloseTo(0, 5);
    expect(saturation([255, 0, 0])).toBeGreaterThan(0.9);
  });
  it('dedupes near-identical colors, preserving order', () => {
    const out = dedupeColors(['#000000', '#010101', '#ffffff']);
    expect(out.length).toBe(2);
    expect(toHex(out[0])).toBe('#000000');
  });
});

describe('parseDimensions', () => {
  it('reads PNG IHDR', () => {
    const b = Buffer.alloc(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(1200, 16); b.writeUInt32BE(900, 20);
    expect(parseDimensions(b)).toEqual({ w: 1200, h: 900 });
  });
  it('reads GIF screen descriptor', () => {
    const b = Buffer.alloc(10);
    b.write('GIF89a', 0, 'ascii');
    b.writeUInt16LE(640, 6); b.writeUInt16LE(480, 8);
    expect(parseDimensions(b)).toEqual({ w: 640, h: 480 });
  });
  it('reads JPEG SOF0', () => {
    const b = Buffer.alloc(20);
    b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
    b.writeUInt16BE(1080, 7); b.writeUInt16BE(1920, 9);
    expect(parseDimensions(b)).toEqual({ w: 1920, h: 1080 });
  });
  it('returns null on junk', () => {
    expect(parseDimensions(Buffer.from('not an image'))).toBeNull();
  });
});

describe('parseSvg', () => {
  it('reads width/height + hex colors', () => {
    const r = parseSvg('<svg width="800" height="600"><rect fill="#0A0A0A"/><text fill="#ff3d00"/></svg>');
    expect(r.dims).toEqual({ w: 800, h: 600 });
    expect(r.colors).toContain('#0A0A0A');
    expect(r.colors).toContain('#ff3d00');
  });
  it('falls back to viewBox', () => {
    expect(parseSvg('<svg viewBox="0 0 1080 1350"></svg>').dims).toEqual({ w: 1080, h: 1350 });
  });
});

describe('classifyPalette', () => {
  it('maps a dark set: dark bg, light text, saturated accent', () => {
    const p = classifyPalette(dedupeColors(['#0A0A0A', '#FAFAFA', '#FF3D00', '#3D9EE4']));
    expect(p).not.toBeNull();
    expect(luminance(hexToRgb(p!.background)!)).toBeLessThan(0.5);
    expect(luminance(hexToRgb(p!.text)!)).toBeGreaterThan(0.5);
    expect(saturation(hexToRgb(p!.accent)!)).toBeGreaterThan(0.5);
  });
  it('maps a light set: light bg, dark text', () => {
    const p = classifyPalette(dedupeColors(['#FAF5EC', '#2A2218', '#B8543C']));
    expect(luminance(hexToRgb(p!.background)!)).toBeGreaterThan(0.5);
    expect(luminance(hexToRgb(p!.text)!)).toBeLessThan(0.5);
  });
  it('returns null with no colors', () => {
    expect(classifyPalette([])).toBeNull();
  });
});

describe('recommendCanvas', () => {
  it('maps ratios to nearest Folio canvas', () => {
    expect(recommendCanvas({ w: 1000, h: 1000 })).toMatchObject({ width: 1080, height: 1080 });
    expect(recommendCanvas({ w: 1080, h: 1350 }).type).toContain('portrait');
    expect(recommendCanvas({ w: 1920, h: 1080 }).type).toContain('landscape');
    expect(recommendCanvas({ w: 1080, h: 1920 }).type).toContain('story');
  });
});

describe('extractReference', () => {
  it('builds palette + canvas + create_design baton from an SVG data URL', () => {
    const svg = '<svg width="1080" height="1350"><rect fill="#0A0A0A"/><text fill="#FF3D00"/><text fill="#FAFAFA"/></svg>';
    const r = extractReference({ image: 'data:image/svg+xml,' + encodeURIComponent(svg), project_path: 'demo', name: 'hero' });
    expect(r.success).toBe(true);
    expect((r.canvas as { type: string }).type).toContain('portrait');
    expect((r.palette as { background: string }).background).toBeTruthy();
    expect((r.next_action as { tool: string }).tool).toBe('create_design');
    expect(typeof r.brief).toBe('string');
    // hardening: mandates the background as the first layer + ships a starter bg layer
    expect(r.brief as string).toMatch(/MANDATORY FIRST LAYER/);
    const starter = r.starter_layers as { id: string; type: string; fill: string }[];
    expect(starter[0]).toMatchObject({ id: 'bg', type: 'rect' });
    expect(starter[0].fill).toBe((r.palette as { background: string }).background);
  });
  it('works from observed colors alone (no image)', () => {
    const r = extractReference({ colors: ['#FAF5EC', '#FFFBEB', '#2A2218', '#B8543C'] });
    expect(r.success).toBe(true);
    expect((r.next_action as { tool: string }).tool).toBe('create_project');
    expect(r.mood).toBe('light');
    expect(luminance(hexToRgb((r.palette as { background: string }).background)!)).toBeGreaterThan(0.5);
  });
  it('degrades gracefully for remote URLs', () => {
    const r = extractReference({ image: 'https://example.com/x.png', colors: ['#000', '#fff'] });
    expect(r.success).toBe(true);
    expect(r.source).toBe('url');
  });
  it('errors when given neither colors nor a readable image', () => {
    const r = extractReference({});
    expect(r.success).toBe(false);
  });
});
