/**
 * Unit tests for CommandPalette.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { CommandPalette } from './command-palette';
import type { EditorApp } from '../../editor/app';
import type { DesignSpec } from '../../schema/types';

const mockApp = {
  canvas: { fitToScreen: vi.fn(), exportSVG: vi.fn().mockReturnValue('<svg></svg>') },
  exportSVG: vi.fn().mockReturnValue('<svg></svg>'),
  fileTree: { triggerOpen: vi.fn(), triggerSave: vi.fn() },
} as unknown as EditorApp;

let container: HTMLElement;

function setup(): { state: StateManager; palette: CommandPalette; container: HTMLElement } {
  const state = new StateManager();
  const palette = new CommandPalette(container, state, mockApp);
  return { state, palette, container };
}

describe('CommandPalette — open/close', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('overlay is hidden initially', () => {
    setup();
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('none');
  });

  it('open() shows the overlay', () => {
    const { palette } = setup();
    palette.open();
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('flex');
  });

  it('close() hides the overlay', () => {
    const { palette } = setup();
    palette.open();
    palette.close();
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('none');
  });

  it('Ctrl+K triggers open', () => {
    setup();
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
    document.dispatchEvent(e);
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('flex');
  });

  it('Escape closes the palette', () => {
    const { palette } = setup();
    palette.open();
    const input = container.querySelector('.command-palette-overlay input') as HTMLInputElement;
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input.dispatchEvent(e);
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('none');
  });
});

describe('CommandPalette — commands', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('renders command rows when open', () => {
    const { palette } = setup();
    palette.open();
    const rows = container.querySelectorAll('.cmd-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('filters commands by search query', () => {
    const { palette } = setup();
    palette.open();
    const input = container.querySelector('.command-palette-overlay input') as HTMLInputElement;
    input.value = 'grid';
    input.dispatchEvent(new Event('input'));
    const rows = container.querySelectorAll('.cmd-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].textContent).toContain('Grid');
  });

  it('shows "No matching commands" when no results', () => {
    const { palette } = setup();
    palette.open();
    const input = container.querySelector('.command-palette-overlay input') as HTMLInputElement;
    input.value = 'xyznonexistent99';
    input.dispatchEvent(new Event('input'));
    const list = container.querySelector('.command-palette-overlay div[style*="overflow"]');
    expect(list?.textContent).toContain('No matching commands');
  });

  it('toggle-grid command toggles gridVisible state', () => {
    const { state, palette } = setup();
    expect(state.get().gridVisible).toBe(false);
    palette.open();
    const input = container.querySelector('.command-palette-overlay input') as HTMLInputElement;
    input.value = 'grid';
    input.dispatchEvent(new Event('input'));
    const row = container.querySelector('.cmd-row') as HTMLElement;
    row.click();
    expect(state.get().gridVisible).toBe(true);
  });

  it('undo command calls state.undo', () => {
    const { state, palette } = setup();
    const undoSpy = vi.spyOn(state, 'undo');
    const design: DesignSpec = {
      _protocol: 'design/v1',
      _mode: 'complete',
      meta: { id: 'x', name: 'x', type: 'poster', created: '2026-01-01', modified: '2026-01-01', generator: 'human' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      layers: [],
    } as unknown as DesignSpec;
    state.set('design', design);

    palette.open();
    const input = container.querySelector('.command-palette-overlay input') as HTMLInputElement;
    input.value = 'Undo';
    input.dispatchEvent(new Event('input'));
    const row = container.querySelector('.cmd-row') as HTMLElement;
    row.click();
    expect(undoSpy).toHaveBeenCalled();
  });

  it('add-rect command adds a rect layer', () => {
    const { state, palette } = setup();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [] } as unknown as DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Rectangle';
    input.dispatchEvent(new Event('input'));
    const row = container.querySelector<HTMLElement>('.cmd-row')!;
    row.click();
    expect(state.getCurrentLayers().some(l => l.type === 'rect')).toBe(true);
  });

  it('add-circle command adds a circle layer', () => {
    const { state, palette } = setup();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [] } as unknown as DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Circle';
    input.dispatchEvent(new Event('input'));
    const row = container.querySelector<HTMLElement>('.cmd-row')!;
    row.click();
    expect(state.getCurrentLayers().some(l => l.type === 'circle')).toBe(true);
  });

  it('add-text command adds a text layer', () => {
    const { state, palette } = setup();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [] } as unknown as DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Add Text';
    input.dispatchEvent(new Event('input'));
    const row = container.querySelector<HTMLElement>('.cmd-row')!;
    row.click();
    expect(state.getCurrentLayers().some(l => l.type === 'text')).toBe(true);
  });

  it('select-all selects all layers', () => {
    const { state, palette } = setup();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [{ id: 'a', type: 'rect', z: 1 }, { id: 'b', type: 'rect', z: 2 }] } as unknown as DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Select All';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().selectedLayerIds).toHaveLength(2);
  });

  it('zoom-in command increases zoom', () => {
    const { state, palette } = setup();
    state.set('zoom', 1, false);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Zoom In';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().zoom).toBeGreaterThan(1);
  });

  it('zoom-out command decreases zoom', () => {
    const { state, palette } = setup();
    state.set('zoom', 1, false);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Zoom Out';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().zoom).toBeLessThan(1);
  });
});

describe('CommandPalette — keyboard navigation', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  function getInput(): HTMLInputElement {
    return container.querySelector('.command-palette-overlay input') as HTMLInputElement;
  }
  function dispatchKey(key: string): void {
    getInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('ArrowDown moves selection forward', () => {
    const { palette } = setup();
    palette.open();
    const rowsBefore = container.querySelectorAll('.cmd-row');
    const selected0 = rowsBefore[0];
    dispatchKey('ArrowDown');
    const rowsAfter = container.querySelectorAll('.cmd-row');
    // Second row should now have the selection background
    expect(rowsAfter[1].getAttribute('style')).toContain('background');
    void selected0;
  });

  it('ArrowUp clamps at 0', () => {
    const { palette } = setup();
    palette.open();
    dispatchKey('ArrowUp');
    // Should not throw and selected index stays at 0
    const rows = container.querySelectorAll('.cmd-row');
    expect(rows[0].getAttribute('style')).toContain('background');
  });

  it('Enter executes selected command and closes palette', () => {
    const { state, palette } = setup();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster', created: '', modified: '' }, document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [] } as unknown as DesignSpec);
    palette.open();
    // Filter to a specific command
    getInput().value = 'Toggle Grid';
    getInput().dispatchEvent(new Event('input'));
    dispatchKey('Enter');
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('none');
    expect(state.get().gridVisible).toBe(true);
  });

  it('clicking overlay background closes palette', () => {
    const { palette } = setup();
    palette.open();
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.style.display).toBe('none');
  });

  it('/ key opens palette when not in input', () => {
    setup();
    const e = new KeyboardEvent('keydown', { key: '/', bubbles: true });
    document.dispatchEvent(e);
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('flex');
  });
});

describe('CommandPalette — more commands', () => {
  function makeDesign() {
    return {
      _protocol: 'design/v1' as const,
      meta: { id: 'x', name: 'x', type: 'poster' as const, created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' as const, dpi: 96 },
      layers: [] as import('../../schema/types').Layer[],
    };
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('add-line command adds a line layer', () => {
    const { state, palette } = setup();
    state.set('design', makeDesign() as unknown as import('../../schema/types').DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Add Line';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.getCurrentLayers().some(l => l.type === 'line')).toBe(true);
  });

  it('delete-selected command removes selected layers', () => {
    const { state, palette } = setup();
    const design = makeDesign();
    design.layers = [{ id: 'del-me', type: 'rect' as const, z: 1 }] as unknown as import('../../schema/types').Layer[];
    state.set('design', design as unknown as import('../../schema/types').DesignSpec);
    state.set('selectedLayerIds', ['del-me']);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Delete Selected';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.getCurrentLayers()).toHaveLength(0);
  });

  it('align-left command runs without crash', () => {
    const { state, palette } = setup();
    state.set('design', makeDesign() as unknown as import('../../schema/types').DesignSpec);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Align Left';
    input.dispatchEvent(new Event('input'));
    expect(() => container.querySelector<HTMLElement>('.cmd-row')!.click()).not.toThrow();
  });

  it('next-page command advances page index', () => {
    const { state, palette } = setup();
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 'c', name: 'c', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      pages: [{ id: 'p1', label: 'P1', layers: [] }, { id: 'p2', label: 'P2', layers: [] }],
    } as unknown as import('../../schema/types').DesignSpec);
    state.set('currentPageIndex', 0, false);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Next Page';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().currentPageIndex).toBe(1);
  });

  it('prev-page command decrements page index', () => {
    const { state, palette } = setup();
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 'c', name: 'c', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      pages: [{ id: 'p1', label: 'P1', layers: [] }, { id: 'p2', label: 'P2', layers: [] }],
    } as unknown as import('../../schema/types').DesignSpec);
    state.set('currentPageIndex', 1, false);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Previous Page';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().currentPageIndex).toBe(0);
  });

  it('mode-payload command switches mode', () => {
    const { state, palette } = setup();
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Payload Mode';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().mode).toBe('payload');
  });

  it('zoom-100 command sets zoom to 1', () => {
    const { state, palette } = setup();
    state.set('zoom', 2, false);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Zoom to 100';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().zoom).toBe(1);
  });

  it('deselect command clears selectedLayerIds', () => {
    const { state, palette } = setup();
    state.set('selectedLayerIds', ['some-id']);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Deselect';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(state.get().selectedLayerIds).toHaveLength(0);
  });

  it('redo command calls state.redo', () => {
    const { state, palette } = setup();
    const redoSpy = vi.spyOn(state, 'redo');
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette-overlay input')!;
    input.value = 'Redo';
    input.dispatchEvent(new Event('input'));
    container.querySelector<HTMLElement>('.cmd-row')!.click();
    expect(redoSpy).toHaveBeenCalled();
  });
});
