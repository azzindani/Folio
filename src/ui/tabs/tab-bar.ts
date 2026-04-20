/**
 * TabBarManager — IDE-style file tab bar.
 *
 * Manages multiple open files as tabs. Each tab represents an open design file.
 * Tabs can be closed, reordered, and show a dirty (unsaved) indicator.
 */

import type { StateManager } from '../../editor/state';

export interface TabEntry {
  id: string;
  name: string;
  dirty: boolean;
  yamlSource: string;
}

export type TabChangeCallback = (tab: TabEntry) => void;
export type TabCloseCallback = (tabId: string) => void;

export class TabBarManager {
  private container: HTMLElement;
  private state: StateManager;
  private tabs: TabEntry[] = [];
  private activeTabId: string | null = null;
  private onTabChange: TabChangeCallback;
  private onTabClose: TabCloseCallback;

  constructor(
    container: HTMLElement,
    state: StateManager,
    onTabChange: TabChangeCallback,
    onTabClose: TabCloseCallback,
  ) {
    this.container = container;
    this.state = state;
    this.onTabChange = onTabChange;
    this.onTabClose = onTabClose;
    this.build();
    this.state.subscribe((s, keys) => {
      if (keys.includes('dirty') || keys.includes('design')) {
        this.syncDirty();
      }
    });
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.className = 'tab-bar';
    this.render();
  }

  openTab(entry: TabEntry): void {
    const existing = this.tabs.findIndex(t => t.id === entry.id);
    if (existing >= 0) {
      this.tabs[existing] = entry;
    } else {
      this.tabs.push(entry);
    }
    this.activeTabId = entry.id;
    this.render();
  }

  closeTab(tabId: string): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);

    if (this.activeTabId === tabId) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeTabId = next?.id ?? null;
      if (next) this.onTabChange(next);
    }
    this.render();
    this.onTabClose(tabId);
  }

  getActiveTab(): TabEntry | null {
    return this.tabs.find(t => t.id === this.activeTabId) ?? null;
  }

  getTabs(): TabEntry[] {
    return [...this.tabs];
  }

  markDirty(tabId: string, dirty: boolean): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.dirty = dirty;
      this.render();
    }
  }

  private syncDirty(): void {
    if (!this.activeTabId) return;
    const dirty = this.state.get().dirty ?? false;
    this.markDirty(this.activeTabId, dirty);
  }

  private render(): void {
    this.container.innerHTML = '';
    if (this.tabs.length === 0) return;

    for (const tab of this.tabs) {
      const el = document.createElement('div');
      el.className = `tab-item${tab.id === this.activeTabId ? ' active' : ''}`;
      el.dataset.tabId = tab.id;
      el.title = tab.name;

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.dirty ? `● ${tab.name}` : tab.name;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '&#215;';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      el.appendChild(label);
      el.appendChild(closeBtn);
      el.addEventListener('click', () => {
        this.activeTabId = tab.id;
        this.render();
        this.onTabChange(tab);
      });

      // Middle-click to close
      el.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) this.closeTab(tab.id);
      });

      this.container.appendChild(el);
    }

    // "+ New" button
    const newBtn = document.createElement('button');
    newBtn.className = 'tab-new-btn';
    newBtn.title = 'New file (Ctrl+N)';
    newBtn.innerHTML = '+';
    this.container.appendChild(newBtn);
  }
}
