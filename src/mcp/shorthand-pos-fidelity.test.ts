import { describe, it, expect } from 'vitest';
import { expandShorthandLayers } from './shorthand-expand';
import type { ShorthandLayer } from './shorthand-helpers';

// Every layer type must end up reporting the box it was handed.
//
// `line` was the one type whose RENDER used different fields than its box: it
// read the raw sh.x/sh.width, which `pos:[…]` never sets, so it drew at the
// origin while still reporting the right box — and every geometry consumer
// (inspect, diagnose, heal, align) reads the box, so nothing could see it.
// This is the cheap breadth check for the box half; the endpoint half lives in
// shorthand-parser-6.test.ts.
const one = (sh: Record<string, unknown>): Record<string, unknown> =>
  expandShorthandLayers([sh] as unknown as ShorthandLayer[])[0] as unknown as Record<string, unknown>;

const BOX = [120, 340, 500, 260];
const types: Record<string, unknown>[] = [
  { id: 'a', type: 'rect', pos: BOX, fill: '#111' },
  { id: 'b', type: 'circle', pos: BOX, fill: '#111' },
  { id: 'c', type: 'ellipse', pos: BOX, fill: '#111' },
  { id: 'd', type: 'line', pos: BOX, stroke: '#111' },
  { id: 'e', type: 'text', pos: BOX, text: 'hello', size: 30 },
  { id: 'f', type: 'icon', pos: BOX, icon: 'star' },
  { id: 'g', type: 'image', pos: BOX, src: 'assets/images/x.png' },
  { id: 'h', type: 'polygon', pos: BOX, sides: 6, fill: '#111' },
  { id: 'i', type: 'group', pos: BOX, layers: [] },
];

describe('every layer type reports the box it was given', () => {
  for (const sh of types) {
    it(`${String(sh['type'])} keeps pos`, () => {
      const l = one(sh);
      expect([l['x'], l['y'], l['width'], l['height']], JSON.stringify(l).slice(0, 200)).toEqual(BOX);
    });
  }
});
