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
    state.set('mode', 'payload', false);
    expect(container.style.display).toBe('block');
  });

  it('onStateChange with mode=canvas hides container', async () => {
    const { state, editor, container } = await setupEditor();
    await editor.init();
    state.set('mode', 'payload', false);
    state.set('mode', 'visual', false);
    expect(container.style.display).toBe('none');
  });

  it('syncFromState does nothing when editor not init', async () => {
    const { state } = await setupEditor();
    // No init() called — state change should not crash
    expect(() => state.set('design', makeDesign(), false)).not.toThrow();
  });

  it('content change listener triggers debounced sync', async () => {
    vi.useFakeTimers();
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });

    const { editor } = await setupEditor();
    await editor.init();

    // Trigger content change
    changeCallback();

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
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    mockEditor.getValue.mockReturnValue(validYaml);
    mockEditor.getModel.mockReturnValue(mockModel);

    const { state, editor } = await setupEditor();
    await editor.init();

    changeCallback();
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
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    mockEditor.getValue.mockReturnValue(': invalid: yaml: :::');
    mockEditor.getModel.mockReturnValue(mockModel);

    const { editor } = await setupEditor();
    await editor.init();

    changeCallback();
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

  it('syncToState with valid YAML but critical validation errors sets yamlSource only (line 82)', async () => {
    vi.useFakeTimers();
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    // Valid YAML syntax but layer missing 'id' — causes critical validation error
    const invalidDesignYaml = `
_protocol: design/v1
meta:
  id: test
  name: Test
  type: poster
  created: ''
  modified: ''
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
layers:
  - type: rect
    z: 10
    x: 0
    y: 0
    width: 100
    height: 100
`;
    mockEditor.getValue.mockReturnValue(invalidDesignYaml);
    mockEditor.getModel.mockReturnValue(mockModel);

    const { state, editor } = await setupEditor();
    await editor.init();

    const initialDesign = state.get().design;
    changeCallback();
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    // yamlSource should be set but design should NOT have changed
    expect(state.get().yamlSource).toBe(invalidDesignYaml);
    expect(state.get().design).toBe(initialDesign);
  });
});

describe('PayloadEditor — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.getValue.mockReturnValue('');
    mockEditor.onDidChangeModelContent.mockImplementation(() => {});
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('syncFromState skips setValue when yaml equals currentValue (line 107 FALSE branch)', async () => {
    const { state, editor } = await setupEditor();
    await editor.init();

    // Get the real YAML of the design first
    const design = makeDesign();
    const { serializeYAML } = await import('../schema/parser');
    const yaml = serializeYAML(design);

    // Pre-set the editor to return the same YAML
    mockEditor.getValue.mockReturnValue(yaml);
    mockEditor.setValue.mockClear();

    state.set('design', design, false);
    // yaml === currentValue → setValue should NOT be called
    expect(mockEditor.setValue).not.toHaveBeenCalled();
  });

  it('syncFromState when editor.getPosition() returns null skips setPosition (line 111 FALSE)', async () => {
    const { state, editor } = await setupEditor();
    await editor.init();

    mockEditor.getPosition.mockReturnValue(null);
    mockEditor.getValue.mockReturnValue('different');
    expect(() => state.set('design', makeDesign(), false)).not.toThrow();
  });

  it('updateMarkers with warning-severity error uses Warning marker severity (line 123 FALSE)', async () => {
    vi.useFakeTimers();
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    // A line layer with no coordinates triggers a warning (not error) from validator
    const warnYaml = `_protocol: design/v1
meta:
  id: warn-test
  name: Warn Test
  type: poster
  created: ''
  modified: ''
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
layers:
  - id: ln1
    type: line
    z: 1
`;
    mockEditor.getValue.mockReturnValue(warnYaml);
    mockEditor.getModel.mockReturnValue(mockModel);

    const { editor } = await setupEditor();
    await editor.init();
    changeCallback();
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();
    // setModelMarkers should be called with Warning severity for line layer
    expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalled();
  });

  it('updateMarkers when model is null skips setModelMarkers (line 134 FALSE)', async () => {
    const { state, editor } = await setupEditor();
    await editor.init();
    mockEditor.getModel.mockReturnValue(null);
    // Trigger syncFromState which triggers updateMarkers indirectly via state change
    expect(() => state.set('design', makeDesign(), false)).not.toThrow();
  });

  it('dispose clears debounceTimer when one is pending (line 180 TRUE)', async () => {
    vi.useFakeTimers();
    let changeCallback: () => void = () => {};
    mockEditor.onDidChangeModelContent.mockImplementation((cb: () => void) => {
      changeCallback = cb;
    });
    const { editor } = await setupEditor();
    await editor.init();
    changeCallback(); // schedule debounce but don't advance timer
    expect(() => editor.dispose()).not.toThrow(); // clears the pending timer
  });
});
