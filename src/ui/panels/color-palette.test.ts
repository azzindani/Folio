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
