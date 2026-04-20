import { type StateManager, type EditorState } from '../../editor/state';
import type { EditorApp } from '../../editor/app';
import { exportDesign } from '../../export/exporter';
import { showToast } from '../../utils/toast';
import { batchExportDialog } from '../dialogs/batch-export';
import { exportAsTemplate } from '../../schema/template';

export class ToolbarManager {
  private container: HTMLElement;
  private state: StateManager;
  private app: EditorApp;

  constructor(container: HTMLElement, state: StateManager, app: EditorApp) {
    this.container = container;
    this.state = state;
    this.app = app;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="toolbar-left" style="display:flex;align-items:center;gap:12px;flex:1">
        <span style="display:flex;align-items:center;gap:6px;user-select:none">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0">
            <rect width="18" height="18" rx="4" fill="var(--color-primary)"/>
            <path d="M4 4h10v2.5H6.5v2H9v2.5H6.5V14H4V4z" fill="white"/>
          </svg>
          <strong style="color:var(--color-text);font-size:15px;letter-spacing:-0.02em">Folio</strong>
        </span>
        <span style="color:var(--color-border)">&#x2502;</span>
        <span class="toolbar-project-name" style="color:var(--color-text-muted);font-size:13px">Untitled</span>
      </div>

      <div class="toolbar-center" style="display:flex;align-items:center;gap:8px">
        <div class="mode-toggle">
          <button class="mode-btn active" data-mode="visual">Visual</button>
          <button class="mode-btn" data-mode="payload">Payload</button>
        </div>
      </div>

      <div class="toolbar-right" style="display:flex;align-items:center;gap:8px">
        <select class="toolbar-theme-select" title="Design theme"
          style="background:var(--color-surface-2);border:1px solid var(--color-border);
                 border-radius:var(--radius-sm);color:var(--color-text);font-size:12px;
                 padding:3px 6px;cursor:pointer">
          <option value="dark-tech">Dark Tech</option>
          <option value="light-clean">Light Clean</option>
          <option value="ocean-blue">Ocean Blue</option>
        </select>
        <button class="btn btn-sm" data-action="undo" title="Undo (Ctrl+Z)">&#8617;</button>
        <button class="btn btn-sm" data-action="redo" title="Redo (Ctrl+Shift+Z)">&#8618;</button>
        <div class="export-group" style="position:relative">
          <button class="btn btn-primary btn-sm" data-action="export" title="Export">Export &#x25BE;</button>
          <div class="export-menu" style="display:none;position:absolute;right:0;top:calc(100% + 4px);
            background:var(--color-surface-2);border:1px solid var(--color-border);
            border-radius:var(--radius-md);box-shadow:var(--shadow-md);
            min-width:140px;z-index:200;overflow:hidden">
            <button class="export-item" data-format="svg">SVG (vector)</button>
            <button class="export-item" data-format="png">PNG ×2</button>
            <button class="export-item" data-format="pdf">PDF</button>
            <button class="export-item" data-format="html">HTML (self-contained)</button>
            <div style="height:1px;background:var(--color-border);margin:2px 0"></div>
            <button class="export-item" data-format="batch">Batch Export…</button>
            <button class="export-item" data-format="template">Export as Template…</button>
          </div>
        </div>
      </div>
    `;

    this.container.addEventListener('click', this.onClick.bind(this));

    // Theme selector
    const themeSelect = this.container.querySelector('.toolbar-theme-select') as HTMLSelectElement;
    themeSelect.addEventListener('change', () => {
      this.app.applyTheme(themeSelect.value);
    });

    // Close export menu on outside click
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.export-group')) {
        this.closeExportMenu();
      }
    });
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    if (target.classList.contains('mode-btn')) {
      const mode = target.dataset.mode as 'visual' | 'payload';
      this.state.set('mode', mode, false);
      return;
    }

    const action = target.dataset.action;
    if (action === 'undo') { this.state.undo(); return; }
    if (action === 'redo') { this.state.redo(); return; }

    if (action === 'export') {
      e.stopPropagation();
      this.toggleExportMenu();
      return;
    }

    const format = target.dataset.format as 'svg' | 'png' | 'pdf' | 'html' | 'batch' | 'template' | undefined;
    if (format) {
      this.closeExportMenu();
      if (format === 'batch') {
        const { design, currentPageIndex } = this.state.get();
        if (design) batchExportDialog.open(design, currentPageIndex);
        return;
      }
      if (format === 'template') {
        this.triggerTemplateExport();
        return;
      }
      this.triggerExport(format as 'svg' | 'png' | 'pdf' | 'html');
    }
  }

  private toggleExportMenu(): void {
    const menu = this.container.querySelector('.export-menu') as HTMLElement;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }

  private closeExportMenu(): void {
    const menu = this.container.querySelector('.export-menu') as HTMLElement;
    if (menu) menu.style.display = 'none';
  }

  private triggerTemplateExport(): void {
    const { design } = this.state.get();
    if (!design) { showToast('No design open', 'error'); return; }
    const template = exportAsTemplate(design);
    const yaml = JSON.stringify(template, null, 2); // browser: download as JSON for now
    const blob = new Blob([yaml], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${design.meta.name ?? 'design'}.template.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Template exported (${template.slots.length} slots)`, 'success');
  }

  private async triggerExport(format: 'svg' | 'png' | 'pdf' | 'html'): Promise<void> {
    const { design, theme } = this.state.get();
    if (!design) return;
    try {
      await exportDesign(design, { format, theme: theme ?? undefined, scale: 2 });
      showToast(`Exported as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      showToast(msg, 'error');
    }
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('mode')) {
      const btns = this.container.querySelectorAll('.mode-btn');
      btns.forEach(btn => {
        const el = btn as HTMLElement;
        el.classList.toggle('active', el.dataset.mode === state.mode);
      });
    }

    if (changedKeys.includes('design') && state.design) {
      const nameEl = this.container.querySelector('.toolbar-project-name');
      if (nameEl) nameEl.textContent = state.design.meta.name;
    }
  }
}
