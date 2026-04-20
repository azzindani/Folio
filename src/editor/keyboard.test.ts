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

describe('KeyboardManager — group / ungroup', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Ctrl+G groups selected layers into a group', () => {
    state.set('design', makeDesign([makeRect('a', 0, 0, 20), makeRect('b', 50, 50, 25)]));
    state.set('selectedLayerIds', ['a', 'b']);
    fireKey('g', { ctrl: true });

    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('group');
    expect(state.get().selectedLayerIds).toEqual([layers[0].id]);
  });

  it('Ctrl+G with single selection is a no-op', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', ['a']);
    fireKey('g', { ctrl: true });
    expect(state.getCurrentLayers()).toHaveLength(1);
    expect(state.getCurrentLayers()[0].type).toBe('rect');
  });

  it('Ctrl+Shift+G ungroups a group layer', () => {
    // First group two layers
    state.set('design', makeDesign([makeRect('a', 0, 0, 20), makeRect('b', 50, 50, 25)]));
    state.set('selectedLayerIds', ['a', 'b']);
    fireKey('g', { ctrl: true });

    // Verify grouped
    const grouped = state.getCurrentLayers();
    expect(grouped).toHaveLength(1);
    const groupId = grouped[0].id;
    state.set('selectedLayerIds', [groupId]);

    // Ungroup
    fireKey('g', { ctrl: true, shift: true });

    const ungrouped = state.getCurrentLayers();
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped.map(l => l.type)).not.toContain('group');
  });
});

describe('KeyboardManager — copy (no clipboard API in jsdom)', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Ctrl+C does not throw when no layers selected', () => {
    state.set('design', makeDesign([]));
    state.set('selectedLayerIds', []);
    expect(() => fireKey('c', { ctrl: true })).not.toThrow();
  });

  it('Ctrl+C does not throw with layers selected', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', ['a']);
    expect(() => fireKey('c', { ctrl: true })).not.toThrow();
  });
});

describe('KeyboardManager — tool shortcuts', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('v sets activeTool to select', () => {
    state.set('activeTool', 'rect', false);
    fireKey('v');
    expect(state.get().activeTool).toBe('select');
  });

  it('r sets activeTool to rect', () => {
    fireKey('r');
    expect(state.get().activeTool).toBe('rect');
  });

  it('t sets activeTool to text', () => {
    fireKey('t');
    expect(state.get().activeTool).toBe('text');
  });

  it('l sets activeTool to line', () => {
    fireKey('l');
    expect(state.get().activeTool).toBe('line');
  });

  it('c (no ctrl) sets activeTool to circle', () => {
    fireKey('c');
    expect(state.get().activeTool).toBe('circle');
  });

  it('Ctrl+0 calls fitToScreen', () => {
    fireKey('0', { ctrl: true });
    expect(mockApp.canvas.fitToScreen).toHaveBeenCalled();
  });
});

describe('KeyboardManager — paste', () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    new KeyboardManager(state, mockApp);
  });

  it('Ctrl+V does not throw when clipboard is unavailable', () => {
    state.set('design', makeDesign([]));
    expect(() => fireKey('v', { ctrl: true })).not.toThrow();
  });
});

describe('KeyboardManager — getShortcuts', () => {
  it('returns the registered shortcuts list', async () => {
    vi.resetModules();
    const { KeyboardManager } = await import('./keyboard');
    const state = new StateManager();
    const km = new KeyboardManager(state, mockApp);
    const shortcuts = km.getShortcuts();
    expect(Array.isArray(shortcuts)).toBe(true);
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(shortcuts.every(s => typeof s.key === 'string' && typeof s.action === 'function')).toBe(true);
  });
});
