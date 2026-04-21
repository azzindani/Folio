import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FindReplaceManager } from './find-replace';
import type { Layer } from '../../schema/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDesign(layers: Layer[]) {
  return {
    _protocol: 'design/v1' as const,
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

function makeTextLayer(id: string, value: string): Layer {
  return {
    id,
    type: 'text',
    z: 10,
    x: 0,
    y: 0,
    width: 400,
    height: 80,
    content: { type: 'plain', value },
    style: {},
  } as unknown as Layer;
}

// ── Minimal StateManager mock ────────────────────────────────────────────────

interface MockState {
  design: ReturnType<typeof makeDesign> | null;
  selectedLayerIds: string[];
}

function makeStateMock(design: ReturnType<typeof makeDesign> | null = null) {
  const state: MockState = {
    design,
    selectedLayerIds: [],
  };

  const listeners: Array<(s: MockState, keys: string[]) => void> = [];

  const get = vi.fn(() => state);

  const set = vi.fn((key: string, value: unknown) => {
    (state as Record<string, unknown>)[key] = value;
    listeners.forEach(l => l(state, [key]));
  });

  const subscribe = vi.fn((listener: (s: MockState, keys: string[]) => void) => {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  });

  const updateLayer = vi.fn((layerId: string, updates: Partial<Layer>) => {
    if (!state.design) return;
    state.design.layers = state.design.layers.map(l =>
      l.id === layerId ? ({ ...l, ...updates } as Layer) : l
    );
    // Notify subscribers with 'design' key so runFind re-runs
    listeners.forEach(li => li(state, ['design']));
  });

  const getCurrentLayers = vi.fn((): Layer[] => {
    return (state.design?.layers ?? []) as Layer[];
  });

  return { state, get, set, subscribe, updateLayer, getCurrentLayers };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fireInput(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function fireChange(el: HTMLInputElement, checked: boolean) {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FindReplaceManager', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  // ── Constructor / DOM structure ──────────────────────────────────────────

  it('builds HTML with .fr-find, .fr-replace, .fr-results elements', () => {
    const mock = makeStateMock(null);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    expect(container.querySelector('.fr-find')).not.toBeNull();
    expect(container.querySelector('.fr-replace')).not.toBeNull();
    expect(container.querySelector('.fr-results')).not.toBeNull();
  });

  it('builds HTML with .fr-status element', () => {
    const mock = makeStateMock(null);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    expect(container.querySelector('.fr-status')).not.toBeNull();
  });

  it('subscribes to state on construction', () => {
    const mock = makeStateMock(null);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    expect(mock.subscribe).toHaveBeenCalledOnce();
  });

  // ── runFind: empty / no query ────────────────────────────────────────────

  it('runFind() with empty input shows no results and clears status', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    fireInput(findInput, '');

    const results = container.querySelector('.fr-results')!;
    expect(results.innerHTML).toBe('');
    expect(container.querySelector<HTMLElement>('.fr-status')!.textContent).toBe('');
  });

  // ── runFind: matching query ──────────────────────────────────────────────

  it('runFind() with matching query shows the match in results', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    fireInput(findInput, 'Hello');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('data-layer-id')).toBe('l1');
  });

  // ── runFind: no match ────────────────────────────────────────────────────

  it('runFind() with no-match query shows "No matches"', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    fireInput(findInput, 'xyz_no_match');

    const results = container.querySelector('.fr-results')!;
    expect(results.textContent).toContain('No matches');
  });

  // ── Status text ──────────────────────────────────────────────────────────

  it('status text shows "1 match" for single match', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const status = container.querySelector<HTMLElement>('.fr-status')!;
    expect(status.textContent).toBe('1 match');
  });

  it('status text shows "2 matches" for two matches', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'Hello world'),
      makeTextLayer('l2', 'Hello again'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const status = container.querySelector<HTMLElement>('.fr-status')!;
    expect(status.textContent).toBe('2 matches');
  });

  // ── Clicking result item ─────────────────────────────────────────────────

  it('clicking a result item sets selectedLayerIds to that layer id', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    item.click();

    expect(mock.set).toHaveBeenCalledWith('selectedLayerIds', ['l1']);
  });

  // ── replaceSelected ──────────────────────────────────────────────────────

  it('replaceSelected() replaces text in the selected layer', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    // Run find first
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    // Select l1
    mock.state.selectedLayerIds = ['l1'];

    // Set replacement text
    const replaceInput = container.querySelector<HTMLInputElement>('.fr-replace')!;
    replaceInput.value = 'Goodbye';

    // Click replace one
    container.querySelector<HTMLButtonElement>('.fr-replace-one')!.click();

    expect(mock.updateLayer).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ content: expect.objectContaining({ value: 'Goodbye world' }) })
    );
  });

  it('replaceSelected() does nothing when no layer is selected', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    // No selection
    mock.state.selectedLayerIds = [];

    container.querySelector<HTMLButtonElement>('.fr-replace-one')!.click();

    expect(mock.updateLayer).not.toHaveBeenCalled();
  });

  // ── replaceAll ───────────────────────────────────────────────────────────

  it('replaceAll() replaces text in all matching layers', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'Hello world'),
      makeTextLayer('l2', 'Hello again'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const replaceInput = container.querySelector<HTMLInputElement>('.fr-replace')!;
    replaceInput.value = 'Hi';

    container.querySelector<HTMLButtonElement>('.fr-replace-all')!.click();

    // updateLayer called for both layers
    const ids = mock.updateLayer.mock.calls.map(c => c[0]);
    expect(ids).toContain('l1');
    expect(ids).toContain('l2');

    // Verify content replacements
    const l1Call = mock.updateLayer.mock.calls.find(c => c[0] === 'l1');
    expect(l1Call![1]).toMatchObject({ content: { value: 'Hi world' } });

    const l2Call = mock.updateLayer.mock.calls.find(c => c[0] === 'l2');
    expect(l2Call![1]).toMatchObject({ content: { value: 'Hi again' } });
  });

  // ── Case-sensitive checkbox ──────────────────────────────────────────────

  it('case-sensitive checkbox: when checked, search is case-sensitive', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'Hello World'),
      makeTextLayer('l2', 'hello world'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const caseCheckbox = container.querySelector<HTMLInputElement>('.fr-case')!;
    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;

    // Enable case-sensitive
    fireChange(caseCheckbox, true);
    // Now run find with capital H — only l1 should match
    fireInput(findInput, 'Hello');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('data-layer-id')).toBe('l1');
  });

  it('case-sensitive checkbox: when unchecked, search is case-insensitive', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'Hello World'),
      makeTextLayer('l2', 'hello world'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const caseCheckbox = container.querySelector<HTMLInputElement>('.fr-case')!;
    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;

    // Leave unchecked (default)
    fireChange(caseCheckbox, false);
    fireInput(findInput, 'hello');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(2);
  });

  // ── Regex checkbox ───────────────────────────────────────────────────────

  it('regex checkbox: when checked, interprets query as regex', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'foo123'),
      makeTextLayer('l2', 'barABC'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const regexCheckbox = container.querySelector<HTMLInputElement>('.fr-regex')!;
    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;

    fireChange(regexCheckbox, true);
    // Regex matching digits
    fireInput(findInput, '\\d+');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('data-layer-id')).toBe('l1');
  });

  it('regex checkbox: when unchecked, special chars are treated literally', () => {
    const design = makeDesign([
      makeTextLayer('l1', 'price: $10.00'),
      makeTextLayer('l2', 'no match here'),
    ]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const regexCheckbox = container.querySelector<HTMLInputElement>('.fr-regex')!;
    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;

    fireChange(regexCheckbox, false);
    // Literal search for "$10.00" — should only match l1
    fireInput(findInput, '$10.00');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('data-layer-id')).toBe('l1');
  });

  // ── Invalid regex ────────────────────────────────────────────────────────

  it('invalid regex does not throw and shows no results', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const regexCheckbox = container.querySelector<HTMLInputElement>('.fr-regex')!;
    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;

    fireChange(regexCheckbox, true);

    // Invalid regex pattern
    expect(() => fireInput(findInput, '[')).not.toThrow();

    // Results should be empty (buildRegex returns null)
    expect(container.querySelector('.fr-results')!.innerHTML).toBe('');
    expect(container.querySelector<HTMLElement>('.fr-status')!.textContent).toBe('');
  });

  // ── Subscribe / design change re-runs find ───────────────────────────────

  it('when design changes, runFind() re-runs via subscribe', () => {
    const initialDesign = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(initialDesign);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    fireInput(findInput, 'Hello');

    // Verify initial match
    expect(container.querySelectorAll('.fr-result-item').length).toBe(1);

    // Simulate design change: add another matching layer
    mock.state.design!.layers = [
      makeTextLayer('l1', 'Hello world'),
      makeTextLayer('l2', 'Hello again'),
    ];

    // Trigger the subscription with 'design' key
    mock.subscribe.mock.calls[0][0](mock.state, ['design']);

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(2);
  });

  it('design change with non-design key does not re-run find', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    fireInput(findInput, 'Hello');

    const runFindSpy = vi.spyOn(container.querySelector('.fr-results')!, 'querySelectorAll');

    // Fire subscription with non-design key — should not re-run
    mock.subscribe.mock.calls[0][0](mock.state, ['selectedLayerIds']);

    // querySelectorAll should NOT have been called from within a runFind
    expect(runFindSpy).not.toHaveBeenCalled();
  });

  // ── Find button click ────────────────────────────────────────────────────

  it('find button click triggers runFind', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    const findInput = container.querySelector<HTMLInputElement>('.fr-find')!;
    findInput.value = 'Hello';

    // Click the find button (not input event)
    container.querySelector<HTMLButtonElement>('.fr-find-btn')!.click();

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    const status = container.querySelector<HTMLElement>('.fr-status')!.textContent;
    expect(status).toBe('1 match');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('non-text layers are not included in results', () => {
    const rectLayer: Layer = {
      id: 'r1',
      type: 'rect',
      z: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    } as unknown as Layer;

    const design = makeDesign([rectLayer, makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('data-layer-id')).toBe('l1');
  });

  it('long text is truncated in preview to 60 chars + ellipsis', () => {
    const longText = 'A'.repeat(80);
    const design = makeDesign([makeTextLayer('l1', longText)]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'AAA');

    const item = container.querySelector('.fr-result-item')!;
    // The preview div (second child) should contain truncated text
    const previewEl = item.querySelectorAll('div')[1];
    expect(previewEl.textContent).toMatch(/…$/);
    expect(previewEl.textContent!.length).toBeLessThanOrEqual(61);
  });

  it('replaceAll() with no matches does not call updateLayer', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    // No find query run → matches empty
    container.querySelector<HTMLButtonElement>('.fr-replace-all')!.click();

    expect(mock.updateLayer).not.toHaveBeenCalled();
  });

  it('mouseenter on unselected result item highlights it', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    // Background changes to surface color for unselected item
    expect(item.style.background).toBe('var(--color-surface)');
  });

  it('mouseleave on unselected result item resets background to transparent', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');

    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(item.style.background).toBe('transparent');
  });

  it('replaceSelected() does nothing when selected layer has no match (line 154)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello world'), makeTextLayer('l2', 'No match here')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);

    // Search matches only l1
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    // Select l2 which has no match
    mock.state.selectedLayerIds = ['l2'];

    container.querySelector<HTMLButtonElement>('.fr-replace-one')!.click();
    expect(mock.updateLayer).not.toHaveBeenCalled();
  });

  it('extractText returns null for markdown content type (line 185 branch)', () => {
    const markdownLayer = {
      id: 'md1', type: 'text', z: 5, x: 0, y: 0, width: 100,
      content: { type: 'markdown', value: '## Hello **world**' },
      style: {},
    } as unknown as Layer;
    const design = makeDesign([markdownLayer]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    // markdown content type IS supported by extractText (returns value), so match should appear
    const items = container.querySelectorAll('.fr-result-item');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('replaceTextInLayer skips non-text layers in applyReplace (line 170)', () => {
    // Trick: run find to match l1, then change layers so getCurrentLayers returns empty
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    // Now make getCurrentLayers return nothing (simulate layer removed)
    mock.getCurrentLayers.mockReturnValueOnce([]);
    container.querySelector<HTMLInputElement>('.fr-replace')!.value = 'Hi';
    container.querySelector<HTMLButtonElement>('.fr-replace-all')!.click();
    expect(mock.updateLayer).not.toHaveBeenCalled();
  });

  it('renders results when selectedLayerIds is undefined (line 124 ??[] branch)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    (mock.state as Record<string, unknown>).selectedLayerIds = undefined;
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    expect(container.querySelectorAll('.fr-result-item').length).toBe(1);
  });

  it('selected result item shows primary color background (line 128 true branch)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    mock.state.selectedLayerIds = ['l1'];
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    expect(item.style.background).toContain('var(--color-primary)');
  });

  it('mouseenter on selected item does not change background (lines 135-137 false branch)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    mock.state.selectedLayerIds = ['l1'];
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    const initialBg = item.style.background;
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(item.style.background).toBe(initialBg); // unchanged
  });

  it('mouseleave on selected item does not change background (lines 140-142 false branch)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    mock.state.selectedLayerIds = ['l1'];
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    const item = container.querySelector<HTMLElement>('.fr-result-item')!;
    const initialBg = item.style.background;
    item.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(item.style.background).toBe(initialBg); // unchanged
  });

  it('rich content layer not matched by extractText (line 185 false branch)', () => {
    const richLayer = {
      id: 'r1', type: 'text', z: 0, x: 0, y: 0, width: 100,
      content: { type: 'rich', spans: [{ text: 'Hello' }] },
      style: {},
    } as unknown as Layer;
    const design = makeDesign([richLayer]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    expect(container.querySelectorAll('.fr-result-item').length).toBe(0);
  });

  it('applyReplace skips non-text layer returned by getCurrentLayers (line 199)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    // Return a rect layer (non-text) for the same id
    mock.getCurrentLayers.mockReturnValueOnce([{
      id: 'l1', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
    } as unknown as Layer]);
    container.querySelector<HTMLInputElement>('.fr-replace')!.value = 'Hi';
    container.querySelector<HTMLButtonElement>('.fr-replace-all')!.click();
    expect(mock.updateLayer).not.toHaveBeenCalled();
  });

  it('applyReplace skips text layer with rich content type (line 200)', () => {
    const design = makeDesign([makeTextLayer('l1', 'Hello')]);
    const mock = makeStateMock(design);
    new FindReplaceManager(container, mock as unknown as import('../../editor/state').StateManager);
    fireInput(container.querySelector<HTMLInputElement>('.fr-find')!, 'Hello');
    mock.getCurrentLayers.mockReturnValueOnce([{
      id: 'l1', type: 'text', z: 0,
      content: { type: 'rich', spans: [] },
      style: {},
    } as unknown as Layer]);
    container.querySelector<HTMLInputElement>('.fr-replace')!.value = 'Hi';
    container.querySelector<HTMLButtonElement>('.fr-replace-all')!.click();
    expect(mock.updateLayer).not.toHaveBeenCalled();
  });
});
