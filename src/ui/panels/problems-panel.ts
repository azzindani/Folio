import { type StateManager, type EditorState } from '../../editor/state';
import { validateDesignSpec, type ValidationError } from '../../schema/validator';
import { lintDesign, type LintIssue } from '../../utils/design-lint';

interface UnifiedIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  detail?: string;
  layerId?: string;
}

export class ProblemsPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private content!: HTMLElement;
  private errors: ValidationError[] = [];
  private lintIssues: LintIssue[] = [];

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
      const layers = this.state.getCurrentLayers();
      this.lintIssues = lintDesign(layers);
      this.render();
    }
  }

  render(): void {
    const unified: UnifiedIssue[] = [
      ...this.errors.map(e => ({
        severity: e.severity,
        message: e.message,
        detail: e.path,
      })),
      ...this.lintIssues.map(i => ({
        severity: i.severity,
        message: i.message,
        layerId: i.layerId,
      })),
    ];

    if (unified.length === 0) {
      this.content.innerHTML = `
        <div style="padding:12px;color:var(--color-success);font-size:12px">
          No problems detected
        </div>`;
      return;
    }

    const errorCount = unified.filter(e => e.severity === 'error').length;
    const warnCount  = unified.filter(e => e.severity === 'warning').length;
    const infoCount  = unified.filter(e => e.severity === 'info').length;

    let html = `<div style="padding:4px 8px;font-size:11px;color:var(--color-text-muted);
      border-bottom:1px solid var(--color-border)">
      ${errorCount} error${errorCount !== 1 ? 's' : ''},
      ${warnCount} warning${warnCount !== 1 ? 's' : ''},
      ${infoCount} info
    </div>`;

    for (const issue of unified) {
      const icon  = issue.severity === 'error' ? '✖'
                  : issue.severity === 'warning' ? '⚠'
                  : 'ℹ';
      const color = issue.severity === 'error' ? 'var(--color-error)'
                  : issue.severity === 'warning' ? 'var(--color-warning)'
                  : 'var(--color-text-muted)';

      html += `<div style="padding:4px 8px;font-size:12px;display:flex;gap:6px;align-items:flex-start;
        border-bottom:1px solid var(--color-border);cursor:pointer"
        class="problem-row" data-layer-id="${issue.layerId ?? ''}">
        <span style="color:${color};flex-shrink:0">${icon}</span>
        <div>
          <div style="color:var(--color-text)">${issue.message}</div>
          ${issue.detail ? `<div style="color:var(--color-text-muted);font-size:10px;font-family:var(--font-mono)">${issue.detail}</div>` : ''}
          ${issue.layerId ? `<div style="color:var(--color-text-muted);font-size:10px;font-family:var(--font-mono)">${issue.layerId}</div>` : ''}
        </div>
      </div>`;
    }

    this.content.innerHTML = html;

    this.content.querySelectorAll<HTMLElement>('.problem-row').forEach(row => {
      row.addEventListener('click', () => {
        const layerId = row.dataset.layerId;
        if (layerId) this.state.set('selectedLayerIds', [layerId]);
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
