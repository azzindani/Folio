import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ColorPaletteManager, addToRecent } from './color-palette';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

function makeState(layers: DesignSpec['layers'] = []): StateManager {
  const sm = new StateManager();
  sm.set('design', {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers,
  });
  return sm;
}

describe('ColorPaletteManager', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localStorage.clear();
  });

  it('renders preset swatches', () => {
    const sm = makeState();
    new ColorPaletteManager(container, sm, vi.fn());
    const swatches = container.querySelectorAll('.palette-swatch');
    expect(swatches.length).toBeGreaterThan(10);
  });

  it('shows document colors when design has solid fills', () => {
    const sm = makeState([{
      id: 'bg', type: 'rect', z: 0,
      fill: { type: 'solid', color: '#aabbcc' },
    }]);
    new ColorPaletteManager(container, sm, vi.fn());
    const labels = [...container.querySelectorAll('.palette-group-label')].map(el => el.textContent);
    expect(labels).toContain('Document Colors');
    const swatches = [...container.querySelectorAll('.palette-swatch')] as HTMLElement[];
    expect(swatches.some(s => s.dataset.color === '#aabbcc')).toBe(true);
  });

  it('calls onPick with hex when swatch clicked', () => {
    const onPick = vi.fn();
    const sm = makeState();
    new ColorPaletteManager(container, sm, onPick);
    const swatch = container.querySelector<HTMLElement>('.palette-swatch')!;
    swatch.click();
    expect(onPick).toHaveBeenCalledWith(swatch.dataset.color);
  });

  it('re-renders on design state change', () => {
    const sm = makeState();
    const mgr = new ColorPaletteManager(container, sm, vi.fn());
    const before = container.innerHTML;
    sm.set('design', {
      _protocol: 'design/v1',
      meta: { id: 't2', name: 'T2', type: 'poster', created: '', modified: '' },
      document: { width: 200, height: 200, unit: 'px', dpi: 96 },
      layers: [{ id: 'x', type: 'rect', z: 0, fill: { type: 'solid', color: '#ff0000' } }],
    });
    expect(container.innerHTML).not.toBe(before);
    void mgr;
  });

  it('shows Recent group after a color is picked', () => {
    const sm = makeState();
    new ColorPaletteManager(container, sm, vi.fn());
    // Simulate adding to recent externally
    addToRecent('#112233');
    const mgr2 = new ColorPaletteManager(container, sm, vi.fn());
    const labels = [...container.querySelectorAll('.palette-group-label')].map(el => el.textContent);
    expect(labels).toContain('Recent');
    void mgr2;
  });
});

describe('ColorPaletteManager — edge cases', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localStorage.clear();
  });
  afterEach(() => { container.remove(); });

  it('shows doc colors from stroke color (line 64)', () => {
    const sm = makeState([{
      id: 'line1', type: 'line', z: 0,
      stroke: { color: '#ff1234', width: 2 },
    } as unknown as DesignSpec['layers'][0]]);
    new ColorPaletteManager(container, sm, vi.fn());
    const swatches = [...container.querySelectorAll('.palette-swatch')] as HTMLElement[];
    expect(swatches.some(s => s.dataset.color === '#ff1234')).toBe(true);
  });

  it('loadRecent returns [] on malformed localStorage (line 35)', () => {
    localStorage.setItem('folio:recent-colors', '{INVALID}');
    const sm = makeState();
    // Should not throw; renders without crashing
    expect(() => new ColorPaletteManager(container, sm, vi.fn())).not.toThrow();
  });

  it('extractDocColors returns no Document Colors when no design set (line 53)', () => {
    const sm = new StateManager(); // design is undefined
    new ColorPaletteManager(container, sm, vi.fn());
    const labels = [...container.querySelectorAll('.palette-group-label')].map(el => el.textContent);
    expect(labels).not.toContain('Document Colors');
  });

  it('extracts colors from paged design via pages.flatMap (line 55)', () => {
    const sm = new StateManager();
    sm.set('design', {
      _protocol: 'design/v1',
      meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
      document: { width: 100, height: 100, unit: 'px', dpi: 96 },
      pages: [{
        id: 'p1', label: 'P1',
        layers: [{ id: 'r', type: 'rect', z: 0, fill: { type: 'solid', color: '#123456' } }],
      }],
    } as unknown as DesignSpec);
    new ColorPaletteManager(container, sm, vi.fn());
    const swatches = [...container.querySelectorAll('.palette-swatch')] as HTMLElement[];
    expect(swatches.some(s => s.dataset.color === '#123456')).toBe(true);
  });

  it('visits nested group layers recursively (line 66)', () => {
    const sm = makeState([{
      id: 'grp', type: 'group', z: 0,
      layers: [{ id: 'inner', type: 'rect', z: 0, fill: { type: 'solid', color: '#abcdef' } }],
    } as unknown as DesignSpec['layers'][0]]);
    new ColorPaletteManager(container, sm, vi.fn());
    const swatches = [...container.querySelectorAll('.palette-swatch')] as HTMLElement[];
    expect(swatches.some(s => s.dataset.color === '#abcdef')).toBe(true);
  });
});

describe('addToRecent', () => {
  beforeEach(() => { localStorage.clear(); });

  it('adds color to front', () => {
    addToRecent('#aaaaaa');
    addToRecent('#bbbbbb');
    const stored = JSON.parse(localStorage.getItem('folio:recent-colors') ?? '[]') as string[];
    expect(stored[0]).toBe('#bbbbbb');
    expect(stored[1]).toBe('#aaaaaa');
  });

  it('deduplicates', () => {
    addToRecent('#aaaaaa');
    addToRecent('#aaaaaa');
    const stored = JSON.parse(localStorage.getItem('folio:recent-colors') ?? '[]') as string[];
    expect(stored.filter(c => c === '#aaaaaa').length).toBe(1);
  });

  it('caps at 16 entries', () => {
    for (let i = 0; i < 20; i++) addToRecent(`#${i.toString(16).padStart(6, '0')}`);
    const stored = JSON.parse(localStorage.getItem('folio:recent-colors') ?? '[]') as string[];
    expect(stored.length).toBeLessThanOrEqual(16);
  });
});
