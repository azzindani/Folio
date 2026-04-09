import type { StateManager } from '../../editor/state';
import type { EditorApp } from '../../editor/app';
import { alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV, distributeH, distributeV } from '../../editor/interactions';

export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

export class CommandPalette {
  private container: HTMLElement;
  private overlay!: HTMLDivElement;
  private input!: HTMLInputElement;
  private list!: HTMLDivElement;
  private commands: Command[] = [];
  private filtered: Command[] = [];
  private selectedIndex = 0;
  private visible = false;

  constructor(container: HTMLElement, state: StateManager, app: EditorApp) {
    this.container = container;
    this.registerCommands(state, app);
    this.build();
    this.bindGlobalShortcut();
  }

  private registerCommands(state: StateManager, app: EditorApp): void {
    this.commands = [
      // View
      { id: 'toggle-grid', label: 'Toggle Grid', category: 'View', shortcut: 'G', action: () => state.set('gridVisible', !state.get().gridVisible, false) },
      { id: 'zoom-fit', label: 'Fit Canvas to Screen', category: 'View', shortcut: 'Ctrl+0', action: () => app.canvas.fitToScreen() },
      { id: 'zoom-100', label: 'Zoom to 100%', category: 'View', shortcut: 'Ctrl+1', action: () => state.set('zoom', 1, false) },
      { id: 'zoom-in', label: 'Zoom In', category: 'View', action: () => state.set('zoom', Math.min(5, state.get().zoom * 1.25), false) },
      { id: 'zoom-out', label: 'Zoom Out', category: 'View', action: () => state.set('zoom', Math.max(0.1, state.get().zoom / 1.25), false) },

      // Mode
      { id: 'mode-visual', label: 'Switch to Visual Mode', category: 'Mode', action: () => state.set('mode', 'visual', false) },
      { id: 'mode-payload', label: 'Switch to Payload Mode', category: 'Mode', action: () => state.set('mode', 'payload', false) },

      // Edit
      { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: () => state.undo() },
      { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: () => state.redo() },
      { id: 'select-all', label: 'Select All Layers', category: 'Edit', action: () => state.set('selectedLayerIds', state.getCurrentLayers().map(l => l.id)) },
      { id: 'deselect', label: 'Deselect All', category: 'Edit', shortcut: 'Esc', action: () => state.set('selectedLayerIds', []) },

      // Layer
      { id: 'add-rect', label: 'Add Rectangle', category: 'Layer', shortcut: 'R', action: () => {
        state.addLayer({ id: `rect-${Date.now()}`, type: 'rect', z: 20, x: 100, y: 100, width: 200, height: 150, fill: { type: 'solid', color: '#3D9EE4' }, radius: 8 });
      }},
      { id: 'add-circle', label: 'Add Circle', category: 'Layer', shortcut: 'C', action: () => {
        state.addLayer({ id: `circle-${Date.now()}`, type: 'circle', z: 20, x: 200, y: 200, width: 150, height: 150, fill: { type: 'solid', color: '#E94560' } });
      }},
      { id: 'add-text', label: 'Add Text', category: 'Layer', shortcut: 'T', action: () => {
        state.addLayer({ id: `text-${Date.now()}`, type: 'text', z: 25, x: 100, y: 100, width: 400, height: 'auto', content: { type: 'plain', value: 'New text' }, style: { font_size: 24, font_weight: 400, color: '#FFFFFF' } });
      }},
      { id: 'add-line', label: 'Add Line', category: 'Layer', shortcut: 'L', action: () => {
        state.addLayer({ id: `line-${Date.now()}`, type: 'line', z: 15, x1: 100, y1: 300, x2: 500, y2: 300, stroke: { color: '#E94560', width: 2 } });
      }},
      { id: 'delete-selected', label: 'Delete Selected Layers', category: 'Layer', shortcut: 'Del', action: () => {
        for (const id of state.get().selectedLayerIds) state.removeLayer(id);
        state.set('selectedLayerIds', []);
      }},

      // Align
      { id: 'align-left', label: 'Align Left', category: 'Align', action: () => alignLeft(state) },
      { id: 'align-right', label: 'Align Right', category: 'Align', action: () => alignRight(state) },
      { id: 'align-top', label: 'Align Top', category: 'Align', action: () => alignTop(state) },
      { id: 'align-bottom', label: 'Align Bottom', category: 'Align', action: () => alignBottom(state) },
      { id: 'align-center-h', label: 'Align Center Horizontal', category: 'Align', action: () => alignCenterH(state) },
      { id: 'align-center-v', label: 'Align Center Vertical', category: 'Align', action: () => alignCenterV(state) },
      { id: 'distribute-h', label: 'Distribute Horizontally', category: 'Align', action: () => distributeH(state) },
      { id: 'distribute-v', label: 'Distribute Vertically', category: 'Align', action: () => distributeV(state) },

      // Export
      { id: 'export-svg', label: 'Export as SVG', category: 'Export', action: () => {
        const svg = app.exportSVG();
        if (svg) {
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${state.get().design?.meta?.name ?? 'design'}.svg`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }},
      { id: 'export-html', label: 'Export as HTML', category: 'Export', action: async () => {
        const { exportToHTML } = await import('../../export/exporter');
        const design = state.get().design;
        const theme = state.get().theme;
        if (design) {
          const html = exportToHTML(design, { format: 'html', theme: theme ?? undefined });
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${design.meta.name}.html`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }},

      // Page
      { id: 'next-page', label: 'Next Page', category: 'Page', action: () => {
        const pages = state.get().design?.pages;
        if (pages && state.get().currentPageIndex < pages.length - 1) {
          state.set('currentPageIndex', state.get().currentPageIndex + 1, false);
        }
      }},
      { id: 'prev-page', label: 'Previous Page', category: 'Page', action: () => {
        if (state.get().currentPageIndex > 0) {
          state.set('currentPageIndex', state.get().currentPageIndex - 1, false);
        }
      }},
    ];
  }

  private build(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'command-palette-overlay';
    this.overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 300; display: none; align-items: flex-start; justify-content: center;
      padding-top: 15vh;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 500px; max-height: 400px; background: var(--color-surface);
      border: 1px solid var(--color-border); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg); overflow: hidden; display: flex; flex-direction: column;
    `;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Type a command...';
    this.input.style.cssText = `
      width: 100%; padding: 12px 16px; border: none; border-bottom: 1px solid var(--color-border);
      background: transparent; color: var(--color-text); font-size: 15px; outline: none;
      font-family: var(--font-sans);
    `;

    this.list = document.createElement('div');
    this.list.style.cssText = 'overflow-y: auto; flex: 1;';

    dialog.appendChild(this.input);
    dialog.appendChild(this.list);
    this.overlay.appendChild(dialog);
    this.container.appendChild(this.overlay);

    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  private bindGlobalShortcut(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !this.visible) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        this.open();
      }
    });
  }

  open(): void {
    this.visible = true;
    this.overlay.style.display = 'flex';
    this.input.value = '';
    this.selectedIndex = 0;
    this.filter();
    this.input.focus();
  }

  close(): void {
    this.visible = false;
    this.overlay.style.display = 'none';
  }

  private filter(): void {
    const query = this.input.value.toLowerCase().trim();
    this.filtered = query
      ? this.commands.filter(c =>
          c.label.toLowerCase().includes(query) || c.category.toLowerCase().includes(query))
      : this.commands;
    this.selectedIndex = 0;
    this.renderList();
  }

  private renderList(): void {
    let html = '';
    let lastCategory = '';

    for (let i = 0; i < this.filtered.length; i++) {
      const cmd = this.filtered[i];
      if (cmd.category !== lastCategory) {
        lastCategory = cmd.category;
        html += `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;
                  color:var(--color-text-muted);padding:8px 16px 4px">${cmd.category}</div>`;
      }
      html += `<div class="cmd-row" data-index="${i}"
        style="padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;
               font-size:13px;${i === this.selectedIndex ? 'background:var(--color-primary);color:white;border-radius:4px;margin:0 4px' : ''}">
        <span style="flex:1">${cmd.label}</span>
        ${cmd.shortcut ? `<span style="font-size:11px;opacity:0.6;font-family:var(--font-mono)">${cmd.shortcut}</span>` : ''}
      </div>`;
    }

    this.list.innerHTML = html || '<div style="padding:16px;color:var(--color-text-muted);text-align:center">No matching commands</div>';

    this.list.querySelectorAll('.cmd-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt((row as HTMLElement).dataset.index!, 10);
        this.executeCommand(idx);
      });
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
      this.renderList();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderList();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.executeCommand(this.selectedIndex);
      return;
    }
  }

  private executeCommand(index: number): void {
    const cmd = this.filtered[index];
    if (cmd) {
      this.close();
      cmd.action();
    }
  }
}
