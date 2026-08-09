import { describe, it, expect } from 'vitest';
import { colorOf, colorPatch, designColors } from './quick-edit';
import type { Layer } from '../schema/types';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;

describe('colorOf', () => {
  it('reads the object fill the properties panel writes', () => {
    expect(colorOf(L({ id: 'a', type: 'rect', z: 1, fill: { type: 'solid', color: '#123456' } }))).toBe('#123456');
  });

  it('reads a bare string fill — shorthand payloads use it constantly', () => {
    expect(colorOf(L({ id: 'a', type: 'rect', z: 1, fill: '#abcdef' }))).toBe('#abcdef');
  });

  it('reads text colour off style, where text actually keeps it', () => {
    expect(colorOf(L({ id: 't', type: 'text', z: 1, style: { color: '#ff0000' } }))).toBe('#ff0000');
  });

  it('is undefined when a layer has no colour at all', () => {
    expect(colorOf(L({ id: 'g', type: 'group', z: 1, layers: [] }))).toBeUndefined();
  });
});

describe('colorPatch', () => {
  it('keeps an object fill an object, and keeps its other keys', () => {
    const patch = colorPatch(L({ id: 'a', type: 'rect', z: 1, fill: { type: 'solid', color: '#000', opacity: 0.5 } }), '#fff');
    expect(patch).toEqual({ fill: { type: 'solid', color: '#fff', opacity: 0.5 } });
  });

  it('keeps a string fill a string, rather than rewriting the payload shape', () => {
    expect(colorPatch(L({ id: 'a', type: 'rect', z: 1, fill: '#000000' }), '#ffffff'))
      .toEqual({ fill: '#ffffff' });
  });

  it('gives an uncoloured shape a solid fill', () => {
    expect(colorPatch(L({ id: 'a', type: 'rect', z: 1 }), '#0a0a0a'))
      .toEqual({ fill: { type: 'solid', color: '#0a0a0a' } });
  });

  it('routes text through style.color and preserves the rest of the style', () => {
    const patch = colorPatch(L({ id: 't', type: 'text', z: 1, style: { font_size: 32, color: '#111' } }), '#eee');
    expect(patch).toEqual({ style: { font_size: 32, color: '#eee' } });
  });
});

describe('designColors', () => {
  it('collects the colours already in the design, deduped and lowercased', () => {
    const out = designColors([
      L({ id: 'a', type: 'rect', z: 1, fill: '#AABBCC' }),
      L({ id: 'b', type: 'rect', z: 2, fill: { color: '#aabbcc' } }),
      L({ id: 'c', type: 'text', z: 3, style: { color: '#123456' } }),
    ]);
    expect(out).toEqual(['#aabbcc', '#123456']);
  });

  it('reaches inside groups — MCP posters are one big group', () => {
    const out = designColors([
      L({ id: 'g', type: 'group', z: 1, layers: [L({ id: 'k', type: 'rect', z: 1, fill: '#0f2233' })] }),
    ]);
    expect(out).toEqual(['#0f2233']);
  });

  it('ignores non-hex values (tokens, gradients, "none")', () => {
    const out = designColors([
      L({ id: 'a', type: 'rect', z: 1, fill: 'none' }),
      L({ id: 'b', type: 'rect', z: 2, fill: '{color.brand}' }),
      L({ id: 'c', type: 'rect', z: 3, fill: '#00ff00' }),
    ]);
    expect(out).toEqual(['#00ff00']);
  });

  it('stops at eight, so the row never outgrows the popover', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      L({ id: `l${i}`, type: 'rect', z: i, fill: `#${i.toString(16).padStart(6, '0')}` }));
    expect(designColors(many)).toHaveLength(8);
  });
});
