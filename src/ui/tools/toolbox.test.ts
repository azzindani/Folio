import { describe, it, expect, beforeEach } from 'vitest';
import { ToolboxManager } from './toolbox';
import { StateManager } from '../../editor/state';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('ToolboxManager', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
  });

  it('builds tool buttons inside container', () => {
    new ToolboxManager(container, state);
    const btns = container.querySelectorAll('.tool-btn');
    expect(btns.length).toBeGreaterThan(0);
  });

  it('creates group separators between tool groups', () => {
    new ToolboxManager(container, state);
    const seps = container.querySelectorAll('.tool-section-sep');
    expect(seps.length).toBeGreaterThan(0);
  });

  it('first button has select tool data attribute', () => {
    new ToolboxManager(container, state);
    const first = container.querySelector<HTMLButtonElement>('[data-tool="select"]');
    expect(first).toBeTruthy();
  });

  it('clicking a tool button updates activeTool in state', () => {
    new ToolboxManager(container, state);
    const rectBtn = container.querySelector<HTMLButtonElement>('[data-tool="rect"]');
    expect(rectBtn).toBeTruthy();
    rectBtn!.click();
    expect(state.get().activeTool).toBe('rect');
  });

  it('active button has "active" class matching current activeTool', () => {
    new ToolboxManager(container, state);
    state.set('activeTool', 'text', false);
    const textBtn = container.querySelector<HTMLButtonElement>('[data-tool="text"]');
    expect(textBtn?.classList.contains('active')).toBe(true);
  });

  it('only the active tool button has "active" class', () => {
    new ToolboxManager(container, state);
    state.set('activeTool', 'circle', false);
    const activeBtns = container.querySelectorAll('.tool-btn.active');
    expect(activeBtns.length).toBe(1);
    expect((activeBtns[0] as HTMLButtonElement).dataset.tool).toBe('circle');
  });

  it('deactivates previous tool when new tool selected', () => {
    new ToolboxManager(container, state);
    state.set('activeTool', 'rect', false);
    state.set('activeTool', 'circle', false);
    const rectBtn = container.querySelector<HTMLButtonElement>('[data-tool="rect"]');
    expect(rectBtn?.classList.contains('active')).toBe(false);
  });
});
