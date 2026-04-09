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
});
