import { describe, it, expect } from 'vitest';
import { columnWidths } from './shorthand-presets-columns';
import { expandShorthandLayers } from './shorthand-expand';

interface Box { id?: string; type?: string; x?: number; y?: number; width?: number; height?: number; layers?: Box[] }

const expand = (sh: unknown): Box => (expandShorthandLayers([sh as never])[0] as unknown) as Box;

describe('columnWidths', () => {
  it('splits evenly and fills the box exactly, leaving no gutter to rounding', () => {
    const w = columnWidths(1000, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1);
  });

  it('honours weights, so a 2:1 row is actually 2:1', () => {
    const [a, b] = columnWidths(900, 2, [2, 1]);
    expect(a).toBe(600);
    expect(b).toBe(300);
  });

  it('falls back to equal shares rather than collapsing a column on junk weights', () => {
    expect(columnWidths(900, 3, [1, 0, 2])).toEqual(columnWidths(900, 3));
    expect(columnWidths(900, 2, 'nonsense')).toEqual([450, 450]);
    expect(columnWidths(900, 2, [1])).toEqual([450, 450]);        // wrong length
  });
});

describe('columns container', () => {
  // The review's exact failure: a portrait-first preset on a 1920×1080 slide.
  it('hands each child a PORTRAIT box on a 16:9 slide — the whole point', () => {
    const g = expand({
      type: 'columns', pos: [0, 0, 1920, 1080], gap: 60,
      cols: [
        { type: 'rect', fill: '#111' },
        { type: 'rect', fill: '#222' },
      ],
    });
    const kids = g.layers ?? [];
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect(k.height).toBe(1080);
      expect(k.width).toBe(930);
      // Taller than it is wide — the shape every preset was built for.
      expect((k.height ?? 0) > (k.width ?? 0)).toBe(true);
    }
    expect(kids[0]?.x).toBe(0);
    expect(kids[1]?.x).toBe(990);
  });

  it('applies pad to both axes and keeps the row inside its box', () => {
    const g = expand({
      type: 'columns', pos: [100, 50, 1000, 600], pad: 40, gap: 20,
      cols: [{ type: 'rect' }, { type: 'rect' }],
    });
    const kids = g.layers ?? [];
    expect(kids[0]?.x).toBe(140);
    expect(kids[0]?.y).toBe(90);
    expect(kids[0]?.height).toBe(520);
    const last = kids[1];
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(100 + 1000 - 40);
  });

  it('leaves a child that positioned itself alone — the escape hatch wins', () => {
    const g = expand({
      type: 'columns', pos: [0, 0, 1000, 500],
      cols: [{ type: 'rect', pos: [7, 9, 11, 13] }, { type: 'rect' }],
    });
    const first = (g.layers ?? [])[0];
    expect([first?.x, first?.y, first?.width, first?.height]).toEqual([7, 9, 11, 13]);
  });

  it('accepts children under cols, columns, items or layers', () => {
    for (const key of ['cols', 'columns', 'items', 'layers']) {
      const g = expand({ type: 'columns', pos: [0, 0, 800, 400], [key]: [{ type: 'rect' }, { type: 'rect' }] });
      expect(g.layers).toHaveLength(2);
    }
  });

  it('is an empty group, not a crash, when given no children', () => {
    const g = expand({ type: 'columns', pos: [0, 0, 800, 400] });
    expect(g.type).toBe('group');
    expect(g.layers).toEqual([]);
  });

  it('nests — a column can hold another columns container', () => {
    const g = expand({
      type: 'columns', pos: [0, 0, 1200, 600],
      cols: [
        { type: 'rect' },
        { type: 'columns', cols: [{ type: 'rect' }, { type: 'rect' }] },
      ],
    });
    const inner = (g.layers ?? [])[1];
    expect(inner?.layers).toHaveLength(2);
    // The inner row is confined to its own column, not the whole slide.
    expect((inner?.layers?.[0]?.width ?? 0)).toBeLessThan(600);
  });

  it('gives a real preset a portrait box instead of a squeezed landscape one', () => {
    const g = expand({
      type: 'columns', pos: [0, 0, 1920, 1080],
      cols: [
        { type: 'stat', value: '7.97M', label: 'tons' },
        { type: 'list', items: ['one', 'two', 'three'] },
      ],
    });
    const kids = g.layers ?? [];
    expect(kids).toHaveLength(2);
    // Each preset expanded into real content inside its own column.
    for (const k of kids) expect((k.layers?.length ?? 0)).toBeGreaterThan(0);
  });
});
