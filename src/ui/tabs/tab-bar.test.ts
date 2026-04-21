import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBarManager, type TabEntry } from './tab-bar';
import { StateManager } from '../../editor/state';

function makeTab(id: string, name = `file-${id}.yaml`): TabEntry {
  return { id, name, dirty: false, yamlSource: `# ${id}` };
}

function makeTabBar(
  onChange = vi.fn(),
  onClose = vi.fn(),
): { manager: TabBarManager; container: HTMLElement; state: StateManager } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const state = new StateManager();
  const manager = new TabBarManager(container, state, onChange, onClose);
  return { manager, container, state };
}

describe('TabBarManager', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders empty tab bar with no tabs', () => {
    const state = new StateManager();
    new TabBarManager(container, state, vi.fn(), vi.fn());
    // No tab-item elements
    expect(container.querySelectorAll('.tab-item').length).toBe(0);
  });

  it('openTab adds a tab and renders it', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
    expect(c.querySelector('.tab-label')?.textContent).toContain('file-a.yaml');
  });

  it('openTab with same id updates existing tab', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab({ id: 'a', name: 'renamed.yaml', dirty: false, yamlSource: '' });
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
    expect(c.querySelector('.tab-label')?.textContent).toContain('renamed.yaml');
  });

  it('openTab with different id adds second tab', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    expect(c.querySelectorAll('.tab-item').length).toBe(2);
  });

  it('active tab has .active class', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    const activeItems = c.querySelectorAll('.tab-item.active');
    expect(activeItems.length).toBe(1);
    expect(activeItems[0].querySelector('.tab-label')?.textContent).toContain('file-b.yaml');
  });

  it('clicking a tab calls onTabChange', () => {
    const onChange = vi.fn();
    const { manager, container: c } = makeTabBar(onChange);
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    // Click first tab
    (c.querySelectorAll('.tab-item')[0] as HTMLElement).click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('closeTab removes the tab', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    manager.closeTab('a');
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
    expect(c.querySelector('.tab-label')?.textContent).toContain('file-b.yaml');
  });

  it('closeTab on active tab switches to adjacent', () => {
    const onChange = vi.fn();
    const { manager } = makeTabBar(onChange);
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    manager.openTab(makeTab('c'));
    // Active is 'c'; close it → should switch to 'b'
    manager.closeTab('c');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('getActiveTab returns currently active tab', () => {
    const { manager } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    expect(manager.getActiveTab()?.id).toBe('b');
  });

  it('markDirty shows dot prefix in label', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.markDirty('a', true);
    expect(c.querySelector('.tab-label')?.textContent).toContain('●');
  });

  it('markDirty false removes dot', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.markDirty('a', true);
    manager.markDirty('a', false);
    expect(c.querySelector('.tab-label')?.textContent).not.toContain('●');
  });

  it('getTabs returns copy of tabs array', () => {
    const { manager } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    const tabs = manager.getTabs();
    expect(tabs.length).toBe(2);
    // Ensure it's a copy
    tabs.length = 0;
    expect(manager.getTabs().length).toBe(2);
  });

  it('syncs dirty state from StateManager', () => {
    const { manager, container: c, state } = makeTabBar();
    manager.openTab(makeTab('x'));
    state.set('dirty', true, false);
    expect(c.querySelector('.tab-label')?.textContent).toContain('●');
  });

  it('clicking close button (×) closes the tab via e.stopPropagation path', () => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    const { manager, container: c } = makeTabBar(onChange, onClose);
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    const closeBtn = c.querySelector<HTMLButtonElement>('.tab-close')!;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    // One tab should be removed
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
  });

  it('middle-click (auxclick button=1) on a tab closes it', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    const tabEl = c.querySelectorAll<HTMLElement>('.tab-item')[0];
    tabEl.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
  });

  it('auxclick with button != 1 does not close the tab', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    const tabEl = c.querySelector<HTMLElement>('.tab-item')!;
    tabEl.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
  });

  it('closeTab with non-existent id is a no-op', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    manager.closeTab('nonexistent');
    expect(c.querySelectorAll('.tab-item').length).toBe(1);
  });

  it('closeTab the only tab leaves no active tab', () => {
    const onChange = vi.fn();
    const { manager, container: c } = makeTabBar(onChange);
    manager.openTab(makeTab('only'));
    manager.closeTab('only');
    expect(c.querySelectorAll('.tab-item').length).toBe(0);
    expect(manager.getActiveTab()).toBeNull();
    // onTabChange not called when no adjacent tab
    expect(onChange).not.toHaveBeenCalled();
  });

  it('syncDirty does nothing when no active tab', () => {
    const { state, container: c } = makeTabBar();
    // No tabs → no activeTabId → syncDirty is a no-op
    state.set('dirty', true, false);
    // No label → no crash
    expect(c.querySelector('.tab-label')).toBeNull();
  });

  it('clicking tab item fires onTabChange', () => {
    const onChange = vi.fn();
    const { manager, container: c } = makeTabBar(onChange);
    manager.openTab(makeTab('a'));
    manager.openTab(makeTab('b'));
    const firstTab = c.querySelectorAll<HTMLElement>('.tab-item')[0];
    firstTab.click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('markDirty with non-existent tab id is a no-op (line 87 false branch)', () => {
    const { manager, container: c } = makeTabBar();
    manager.openTab(makeTab('a'));
    // Call markDirty with an id that doesn't exist
    expect(() => manager.markDirty('nonexistent', true)).not.toThrow();
    // Label should not have ● since the real tab was not dirtied
    expect(c.querySelector('.tab-label')?.textContent).not.toContain('●');
  });

  it('setting design key triggers syncDirty (line 40 || branch)', () => {
    const { manager, container: c, state } = makeTabBar();
    manager.openTab(makeTab('a'));
    // Trigger subscribe with 'design' key (not 'dirty')
    // This exercises the || keys.includes('design') path
    state.set('design', null as unknown as Parameters<typeof state.set>[1], false);
    // syncDirty should run: dirty is undefined → ?? false → markDirty('a', false)
    expect(c.querySelector('.tab-label')?.textContent).not.toContain('●');
  });

  it('syncDirty uses ?? false when state.dirty is undefined (line 95 branch)', () => {
    const { manager, container: c, state } = makeTabBar();
    manager.openTab(makeTab('a'));
    // state.dirty was never set (undefined) → ?? false fallback
    // Trigger syncDirty via design change
    state.set('design', null as unknown as Parameters<typeof state.set>[1], false);
    // markDirty called with false → no ● indicator
    expect(c.querySelector('.tab-label')?.textContent).not.toContain('●');
  });
});
