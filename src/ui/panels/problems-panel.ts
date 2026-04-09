import { type StateManager, type EditorState } from '../../editor/state';
import { validateDesignSpec, type ValidationError } from '../../schema/validator';

export class ProblemsPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private content!: HTMLElement;
  private errors: ValidationError[] = [];

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.content = document.createElement('div');
    this.content.className = 'problems-content';
    this.container.appendChild(this.content);
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('design') && state.design) {
      this.errors = validateDesignSpec(state.design);
      this.render();
    }
  }

  render(): void {
    const errorCount = this.errors.filter(e => e.severity === 'error').length;
    const warnCount = this.errors.filter(e => e.severity === 'warning').length;

    if (this.errors.length === 0) {
      this.content.innerHTML = `
        <div style="padding:12px;color:var(--color-success);font-size:12px">
          No problems detected
        </div>`;
      return;
    }

    let html = `<div style="padding:4px 8px;font-size:11px;color:var(--color-text-muted);
      border-bottom:1px solid var(--color-border)">
      ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warnCount} warning${warnCount !== 1 ? 's' : ''}
    </div>`;

    for (const error of this.errors) {
      const icon = error.severity === 'error' ? '\u2716' : '\u26A0';
      const color = error.severity === 'error' ? 'var(--color-error)' : 'var(--color-warning)';

      html += `<div style="padding:4px 8px;font-size:12px;display:flex;gap:6px;align-items:flex-start;
        border-bottom:1px solid var(--color-border);cursor:pointer"
        class="problem-row" data-path="${error.path}">
        <span style="color:${color};flex-shrink:0">${icon}</span>
        <div>
          <div style="color:var(--color-text)">${error.message}</div>
          <div style="color:var(--color-text-muted);font-size:10px;font-family:var(--font-mono)">${error.path}</div>
        </div>
      </div>`;
    }

    this.content.innerHTML = html;

    // Click to select layer referenced by error
    this.content.querySelectorAll('.problem-row').forEach(row => {
      row.addEventListener('click', () => {
        const path = (row as HTMLElement).dataset.path ?? '';
        const layerIdMatch = path.match(/layers\[\d+\]\.id/);
        if (layerIdMatch) {
          // Try to extract layer id from the path
        }
      });
    });
  }

  getErrors(): ValidationError[] {
    return this.errors;
  }

  hasErrors(): boolean {
    return this.errors.some(e => e.severity === 'error');
  }
}
