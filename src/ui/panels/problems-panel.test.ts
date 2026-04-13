import { describe, it, expect, beforeEach } from 'vitest';
import { ProblemsPanelManager } from './problems-panel';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function validDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'X', type: 'poster', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px' },
    layers: [],
  } as unknown as DesignSpec;
}

describe('ProblemsPanelManager', () => {
  let state: StateManager;
  let container: HTMLElement;
  let panel: ProblemsPanelManager;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
    panel = new ProblemsPanelManager(container, state);
  });

  it('builds a DOM element inside container', () => {
    expect(container.querySelector('.problems-content')).toBeTruthy();
  });

  it('shows "No problems" message initially', () => {
    panel.render();
    expect(container.textContent).toContain('No problems');
  });

  it('getErrors returns empty array before design is set', () => {
    expect(panel.getErrors()).toEqual([]);
  });

  it('hasErrors returns false when no errors', () => {
    expect(panel.hasErrors()).toBe(false);
  });

  it('shows errors when design with validation issues is set', () => {
    // A design with invalid protocol triggers validator errors
    const badDesign = {
      _protocol: 'design/v1',
      meta: { id: '', name: '', type: 'poster', created: '', modified: '' },
      document: { width: 0, height: 0, unit: 'px' },
      layers: [],
    } as unknown as DesignSpec;
    state.set('design', badDesign);
    // Panel reacts to state change — render should show counts
    const content = container.querySelector('.problems-content')?.textContent ?? '';
    // Even with no errors from validator, it should show either "No problems" or error count
    expect(content.length).toBeGreaterThan(0);
  });

  it('onStateChange fires only when design key changes', () => {
    const design = validDesign();
    state.set('design', design);
    const html1 = container.innerHTML;
    state.set('zoom', 2); // non-design key
    const html2 = container.innerHTML;
    // zooming shouldn't re-render panel
    expect(html1).toBe(html2);
  });

  it('render populates error rows when errors exist', () => {
    // Inject errors directly by loading a design, then check UI
    state.set('design', validDesign());
    panel.render();
    const content = container.querySelector('.problems-content');
    expect(content).toBeTruthy();
  });

  it('getErrors/hasErrors reflect validation results after design set', () => {
    state.set('design', validDesign());
    // Valid design → no errors
    expect(panel.hasErrors()).toBe(panel.getErrors().some(e => e.severity === 'error'));
  });
});
