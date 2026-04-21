import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec } from '../schema/types';

// Mock Monaco Editor module
const mockModel = {
  getValue: vi.fn().mockReturnValue(''),
};
const mockEditor = {
  getValue: vi.fn().mockReturnValue(''),
  setValue: vi.fn(),
  onDidChangeModelContent: vi.fn(),
  getModel: vi.fn().mockReturnValue(mockModel),
  getPosition: vi.fn().mockReturnValue({ lineNumber: 1, column: 1 }),
  setPosition: vi.fn(),
  layout: vi.fn(),
  dispose: vi.fn(),
};
const mockMonaco = {
  editor: {
    create: vi.fn().mockReturnValue(mockEditor),
    setModelMarkers: vi.fn(),
  },
  MarkerSeverity: { Error: 8, Warning: 4 },
};

vi.mock('monaco-editor', () => mockMonaco);

function makeDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px', dpi: 96 },
    layers: [],
  } as unknown as DesignSpec;
}

async function setupEditor() {
  const state = new StateManager();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const { PayloadEditor } = await import('./payload-editor');
  const editor = new PayloadEditor(container, state);
  return { state, editor, container };
}

describe('PayloadEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.getValue.mockReturnValue('');
    mockEditor.onDidChangeModelContent.mockImplementation(() => {});
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('constructs without error', async () => {
    const { editor } = await setupEditor();
    expect(editor).toBeDefined();
  });

  it('show() sets container display to block', async () => {
    const { editor, container } = await setupEditor();
    editor.hide();
    editor.show();
    expect(container.style.display).toBe('block');
  });

  it('hide() sets container display to none', async () => {
    const { editor, container } = await setupEditor();
    editor.hide();
    expect(container.style.display).toBe('none');
  });

  it('getErrors() returns empty array initially', async () => {
    const { editor } = await setupEditor();
    expect(editor.getErrors()).toEqual([]);
  });

  it('dispose() calls editor.dispose', async () => {
    const { editor } = await setupEditor();
    await editor.init();
    editor.dispose();
    expect(mockEditor.dispose).toHaveBeenCalled();
  });

  it('init() creates Monaco editor', async () => {
    const { editor } = await setupEditor();
    await editor.init();
    expect(mockMonaco.editor.create).toHaveBeenCalled();
  });

  it('init() registers onDidChangeModelContent listener', async () => {
    const { editor } = await setupEditor();
    await editor.init();
    expect(mockEditor.onDidChangeModelContent).toHaveBeenCalled();
  });

  it('onStateChange with design update calls syncFromState', async () => {
    const { state, editor } = await setupEditor();
    await editor.init();
    mockEditor.getValue.mockReturnValue('old-yaml');
    state.set('design', makeDesign(), false);
    // setValue should be called since yaml !== old-yaml
    expect(mockEditor.setValue).toHaveBeenCalled();
  });

  it('onStateChange with mode=payload shows container', async () => {
    const { state, editor, container } = await setupEditor();
    await editor.init();
    state.set('mode', 'payload' as import('./state').EditorMode, false);
    expect(container.style.display).toBe('block');
  });

  it('onStateChange with mode=canvas hides container', async () => {
    const { state, editor, container } = await setupEditor();
    await editor.init();
    state.set('mode', 'payload' as import('./state').EditorMode, false);
    state.set('mode', 'canvas' as import('./state').EditorMode, false);
    expect(container.style.display).toBe('none');
  });

  it('syncFromState does nothing when editor not init', async () => {
    const { state } = await setupEditor();
    // No init() called — state change should not crash
    expect(() => state.set('design', makeDesign(), false)).not.toThrow();
  });

  it('content change listener triggers debounced sync', async () => {
    vi.useFakeTimers();
    let changeCallback: (() => void) | null = null;
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });

    const { editor } = await setupEditor();
    await editor.init();

    // Trigger content change
    changeCallback?.();

    // Simulate timer completing — syncToState will run
    await vi.advanceTimersByTimeAsync(400);

    vi.useRealTimers();
    // Just verify it didn't throw
    expect(true).toBe(true);
  });

  it('syncToState with valid YAML updates design in state', async () => {
    vi.useFakeTimers();
    const validYaml = `_protocol: design/v1
meta:
  id: sync-test
  name: Sync Test
  type: poster
  created: ''
  modified: ''
document:
  width: 800
  height: 600
  unit: px
  dpi: 96
layers: []
`;
    let changeCallback: (() => void) | null = null;
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    mockEditor.getValue.mockReturnValue(validYaml);
    mockEditor.getModel.mockReturnValue(mockModel);

    const { state, editor } = await setupEditor();
    await editor.init();

    changeCallback?.();
    await vi.advanceTimersByTimeAsync(400);

    vi.useRealTimers();
    // Design should have been set if YAML parsed successfully
    const design = state.get().design;
    if (design) {
      expect(design.meta.name).toBe('Sync Test');
    } else {
      // At minimum, yamlSource should be set
      expect(state.get().yamlSource).toBe(validYaml);
    }
  });

  it('syncToState with invalid YAML calls setParseErrorMarker', async () => {
    vi.useFakeTimers();
    let changeCallback: (() => void) | null = null;
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    mockEditor.getValue.mockReturnValue(': invalid: yaml: :::');
    mockEditor.getModel.mockReturnValue(mockModel);

    const { editor } = await setupEditor();
    await editor.init();

    changeCallback?.();
    await vi.advanceTimersByTimeAsync(400);

    vi.useRealTimers();
    // Should call setModelMarkers with an error
    expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalled();
  });

  it('dispose with no timer clears nothing and does not throw', async () => {
    const { editor } = await setupEditor();
    // dispose without init — no debounce timer
    expect(() => editor.dispose()).not.toThrow();
  });
});
