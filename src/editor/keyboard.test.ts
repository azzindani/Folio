import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec, Layer } from '../schema/types';

// KeyboardManager depends on EditorApp (canvas.fitToScreen). Stub it.
const mockApp = {
  canvas: { fitToScreen: vi.fn() },
} as unknown as import('./app').EditorApp;

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

function makeRect(id: string, x = 0, y = 0, z = 20): Layer {
  return { id, type: 'rect', z, x, y, width: 100, height: 100 } as Layer;
}

// Helper to fire a keydown on document and process it through KeyboardManager
function fireKey(key: string, opts: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('KeyboardManager — shortcut dispatch', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    // Import fresh to reset module-level duplicateCounter
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Escape clears selectedLayerIds', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', ['a']);
    fireKey('Escape');
    expect(state.get().selectedLayerIds).toEqual([]);
  });

  it('g toggles gridVisible', () => {
    expect(state.get().gridVisible).toBe(false);
    fireKey('g');
    expect(state.get().gridVisible).toBe(true);
    fireKey('g');
    expect(state.get().gridVisible).toBe(false);
  });

  it('Ctrl+Z calls undo', () => {
    const undoSpy = vi.spyOn(state, 'undo');
    fireKey('z', { ctrl: true });
    expect(undoSpy).toHaveBeenCalledOnce();
  });

  it('Ctrl+Shift+Z calls redo', () => {
    const redoSpy = vi.spyOn(state, 'redo');
    fireKey('z', { ctrl: true, shift: true });
    expect(redoSpy).toHaveBeenCalledOnce();
  });

  it('shortcuts do not fire when target is an input', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', ['a']);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input.dispatchEvent(ev);

    // selectedLayerIds should still contain 'a' (shortcut was suppressed)
    expect(state.get().selectedLayerIds).toEqual(['a']);
    document.body.removeChild(input);
  });

  it('Ctrl+1 sets zoom to 1', () => {
    state.set('zoom', 0.5, false);
    fireKey('1', { ctrl: true });
    expect(state.get().zoom).toBe(1);
  });
});

describe('KeyboardManager — deleteSelected', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Delete removes all selected layers', () => {
    state.set('design', makeDesign([makeRect('a'), makeRect('b'), makeRect('c')]));
    state.set('selectedLayerIds', ['a', 'c']);
    fireKey('Delete');
    const ids = state.getCurrentLayers().map(l => l.id);
    expect(ids).toEqual(['b']);
    expect(state.get().selectedLayerIds).toEqual([]);
  });

  it('Backspace removes selected layers', () => {
    state.set('design', makeDesign([makeRect('x')]));
    state.set('selectedLayerIds', ['x']);
    fireKey('Backspace');
    expect(state.getCurrentLayers()).toHaveLength(0);
  });

  it('Delete with no selection is a no-op', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', []);
    fireKey('Delete');
    expect(state.getCurrentLayers()).toHaveLength(1);
  });
});

describe('KeyboardManager — duplicateSelected', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Ctrl+D duplicates selected layer with offset position', () => {
    state.set('design', makeDesign([makeRect('a', 100, 100)]));
    state.set('selectedLayerIds', ['a']);
    fireKey('d', { ctrl: true });

    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(2);
    const clone = layers.find(l => l.id !== 'a')!;
    expect(clone.x).toBe(120);
    expect(clone.y).toBe(120);
  });

  it('duplicated layer id does not use Date.now() (deterministic)', () => {
    state.set('design', makeDesign([makeRect('btn')]));
    state.set('selectedLayerIds', ['btn']);
    fireKey('d', { ctrl: true });
    const clone = state.getCurrentLayers().find(l => l.id !== 'btn')!;
    // ID should not contain a timestamp (13-digit number)
    expect(clone.id).not.toMatch(/\d{13}/);
    expect(clone.id).toContain('btn-copy-');
  });

  it('Ctrl+D with no selection is a no-op', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', []);
    fireKey('d', { ctrl: true });
    expect(state.getCurrentLayers()).toHaveLength(1);
  });
});

describe('KeyboardManager — adjustZ', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Ctrl+] brings layer forward by 10', () => {
    state.set('design', makeDesign([makeRect('a', 0, 0, 20)]));
    state.set('selectedLayerIds', ['a']);
    fireKey(']', { ctrl: true });
    expect(state.getCurrentLayers()[0].z).toBe(30);
  });

  it('Ctrl+[ sends layer backward by 10', () => {
    state.set('design', makeDesign([makeRect('a', 0, 0, 30)]));
    state.set('selectedLayerIds', ['a']);
    fireKey('[', { ctrl: true });
    expect(state.getCurrentLayers()[0].z).toBe(20);
  });
});
