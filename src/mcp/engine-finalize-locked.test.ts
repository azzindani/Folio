import { describe, it, expect } from 'vitest';
import { decollideHandPlaced, setMeasuredTextHeights } from './engine-finalize-text';
import { fixInvisibleText } from './engine-finalize-legibility';
import type { Layer } from '../schema/types';

const W = 1080, H = 1350;
// A wrapping text (≈2 lines at 40px/600px) so the geometry passes WANT to act on it.
const txt = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'text', z: 1, x, y, width: 600, height: 40,
     content: { type: 'plain', value: 'Some words that wrap across a couple of lines here' },
     style: { font_size: 40, line_height: 1.4 }, ...extra } as unknown as Layer);
const yOf = (l: Layer): number => (l as unknown as Record<string, number>)['y'];
const hOf = (l: Layer): number => (l as unknown as Record<string, number>)['height'];
const colOf = (l: Layer): string => ((l as unknown as Record<string, unknown>)['style'] as Record<string, string>)['color'];

describe('locked layers are exempt from the auto-rescue passes', () => {
  it('decollideHandPlaced does NOT move locked overlappers', () => {
    const a = txt('a', 80, 100, { locked: true });
    const b = txt('b', 80, 110, { locked: true });
    expect(decollideHandPlaced([a, b], W, H)).toBe(0);
    expect(yOf(b)).toBe(110);
  });

  it('decollideHandPlaced STILL moves unlocked overlappers (rescue intact)', () => {
    const a = txt('a', 80, 100);
    const b = txt('b', 80, 110);
    expect(decollideHandPlaced([a, b], W, H)).toBeGreaterThan(0);
    expect(yOf(b)).toBeGreaterThan(110);
  });

  it('setMeasuredTextHeights leaves a locked text box untouched', () => {
    const a = txt('a', 80, 100, { height: 40, locked: true });
    setMeasuredTextHeights([a], W);
    expect(hOf(a)).toBe(40);                 // not grown to the wrapped height
  });

  it('fixInvisibleText does NOT re-light a locked invisible text', () => {
    const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#0A0A0A' } } as unknown as Layer;
    const t = txt('t', 80, 100, { locked: true, style: { color: '#111111', font_size: 40 } });
    expect(fixInvisibleText([bg, t], W, H)).toBe(0);
    expect(colOf(t)).toBe('#111111');        // dark-on-dark, but authored → left alone
  });

  it('a locked GROUP exempts its whole subtree from re-lighting', () => {
    const inner = txt('i', 80, 100, { style: { color: '#111111', font_size: 40 } });
    const group = { id: 'g', type: 'group', z: 1, locked: true, layers: [inner] } as unknown as Layer;
    const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#0A0A0A' } } as unknown as Layer;
    expect(fixInvisibleText([bg, group], W, H)).toBe(0);
    expect(colOf(inner)).toBe('#111111');
  });
});

describe('fixInvisibleText reads a STRING-fill backdrop (suite-103 teal / suite-111 brown)', () => {
  it('re-lights dark text on a string-fill dark canvas', () => {
    // the blind-model brown scrapbook: `fill: '#8B4513'` (a STRING, not {type,color})
    // — was read as "no backdrop" so #555 body stayed invisible on brown.
    const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: '#8B4513' } as unknown as Layer;
    const t = txt('t', 80, 400, { style: { color: '#555555', font_size: 16 } });
    expect(fixInvisibleText([bg, t], W, H)).toBe(1);
    expect(colOf(t)).not.toBe('#555555');     // re-lit to clear the brown
  });
  it('leaves legible text on a string-fill canvas alone', () => {
    const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: '#8B4513' } as unknown as Layer;
    const t = txt('t', 80, 400, { style: { color: '#FFFFFF', font_size: 16 } });
    expect(fixInvisibleText([bg, t], W, H)).toBe(0);
    expect(colOf(t)).toBe('#FFFFFF');
  });
});

describe('decollide measures text to its TRUE wrapped height — a generous reservation is not a phantom box', () => {
  // The two-column editorial spread: each paragraph reserved 300px of layout height
  // but wraps to ~112px. The old Math.max(given,measured) floor treated the 300px
  // reservation as the collision box and shoved the row below it down by the full
  // reservation; setMeasuredTextHeights then shrank the box and never reclaimed the
  // gap → a dead band mid-column.
  it('does NOT push the row below when it clears the TRUE measured bottom', () => {
    const a = txt('a', 80, 100, { height: 300 });   // reserves 300, wraps to ~112
    const b = txt('b', 80, 240, { height: 300 });    // clear of a's real text bottom (~212)
    expect(decollideHandPlaced([a, b], W, H)).toBe(0);
    expect(yOf(b)).toBe(240);                          // not shoved by the phantom reservation
  });

  it('STILL pushes a row that overlaps the TRUE measured box (rescue intact)', () => {
    const a = txt('a', 80, 100, { height: 300 });   // true text bottom ≈ 212
    const b = txt('b', 80, 150);                       // sits inside a's real text → overlaps
    expect(decollideHandPlaced([a, b], W, H)).toBeGreaterThan(0);
    expect(yOf(b)).toBeGreaterThan(150);
  });
});

describe('decollide leaves structural wires (connector/line) where the model anchored them', () => {
  // A connector joins two anchors the model placed deliberately; moving it orphans
  // the join. It must be neither a movable flow row nor a collision floor.
  const wire = (id: string, y: number): Layer =>
    ({ id, type: 'connector', z: 1, x: 80, y, width: 1, height: 200, from: [80, y], to: [80, y + 200] }) as unknown as Layer;

  it('never moves a connector even when a text sits across it', () => {
    const c = wire('c', 100);
    const t = txt('t', 80, 120);                       // overlaps the wire's bbox
    decollideHandPlaced([c, t], W, H);
    expect(yOf(c)).toBe(100);                          // wire stayed put
  });

  it('a connector is not a floor — a node beside it is not pushed down', () => {
    const c = wire('c', 100);
    const node = txt('node', 80, 110);                 // shares the wire's column
    decollideHandPlaced([c, node], W, H);
    expect(yOf(node)).toBe(110);                       // not shoved by the wire
  });
});
