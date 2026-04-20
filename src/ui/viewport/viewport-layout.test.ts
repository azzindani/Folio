import { describe, it, expect, beforeEach } from 'vitest';
import { ViewportLayoutManager, type ViewportMode } from './viewport-layout';

function makeManager(): { mgr: ViewportLayoutManager; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const mgr = new ViewportLayoutManager(container);
  return { mgr, container };
}

describe('ViewportLayoutManager', () => {
  it('defaults to single mode', () => {
    const { mgr, container } = makeManager();
    expect(mgr.getMode()).toBe('single');
    expect(container.querySelectorAll('.viewport-pane').length).toBe(1);
  });

  const modePaneCount: [ViewportMode, number][] = [
    ['single', 1],
    ['split-h', 2],
    ['split-v', 2],
    ['grid22', 4],
    ['cols3', 3],
  ];

  for (const [mode, count] of modePaneCount) {
    it(`${mode} mode creates ${count} pane(s)`, () => {
      const { mgr, container } = makeManager();
      mgr.setMode(mode);
      expect(container.querySelectorAll('.viewport-pane').length).toBe(count);
    });
  }

  it('applies correct CSS class for each mode', () => {
    const { mgr, container } = makeManager();
    const modes: ViewportMode[] = ['single', 'split-h', 'split-v', 'grid22', 'cols3'];
    for (const mode of modes) {
      mgr.setMode(mode);
      // container IS the viewport-layout element
      expect(container.classList.contains(`viewport-layout--${mode}`)).toBe(true);
    }
  });

  it('getActivePaneEl returns inner canvas-area of active pane', () => {
    const { mgr } = makeManager();
    const el = mgr.getActivePaneEl();
    expect(el).not.toBeNull();
    expect(el?.classList.contains('canvas-area')).toBe(true);
  });

  it('getPanes returns all pane descriptors', () => {
    const { mgr } = makeManager();
    mgr.setMode('grid22');
    const panes = mgr.getPanes();
    expect(panes.length).toBe(4);
    expect(panes[0].id).toBe('pane-0');
    expect(panes[3].id).toBe('pane-3');
  });

  it('setActivePaneById updates active pane', () => {
    const { mgr, container } = makeManager();
    mgr.setMode('split-h');
    mgr.setActivePaneById('pane-1');
    const active = container.querySelectorAll('.viewport-pane.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.paneId).toBe('pane-1');
  });

  it('setActivePaneById ignores unknown id', () => {
    const { mgr, container } = makeManager();
    mgr.setMode('split-h');
    mgr.setActivePaneById('pane-99');
    // First pane should still be active
    const active = container.querySelectorAll('.viewport-pane.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.paneId).toBe('pane-0');
  });

  it('switching modes resets panes', () => {
    const { mgr, container } = makeManager();
    mgr.setMode('grid22');
    mgr.setMode('single');
    expect(container.querySelectorAll('.viewport-pane').length).toBe(1);
    expect(mgr.getMode()).toBe('single');
  });

  it('clicking a pane makes it active', () => {
    const { mgr, container } = makeManager();
    mgr.setMode('cols3');
    const panes = container.querySelectorAll<HTMLElement>('.viewport-pane');
    panes[2].click();
    expect(container.querySelectorAll('.viewport-pane.active')[0] === panes[2]).toBe(true);
    expect(mgr.getActivePaneEl()?.closest('.viewport-pane') === panes[2]).toBe(true);
  });
});
