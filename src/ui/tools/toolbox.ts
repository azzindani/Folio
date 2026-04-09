import { type StateManager, type EditorState, type ToolId } from '../../editor/state';

interface ToolDef {
  id: ToolId;
  icon: string;
  label: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: '&#x2B0C;', label: 'Select',    key: 'V' },
  { id: 'rect',   icon: '&#x25A1;', label: 'Rectangle', key: 'R' },
  { id: 'circle', icon: '&#x25CB;', label: 'Circle',    key: 'C' },
  { id: 'text',   icon: 'T',        label: 'Text',      key: 'T' },
  { id: 'line',   icon: '&#x2014;', label: 'Line',      key: 'L' },
];

export class ToolboxManager {
  private container: HTMLElement;
  private state: StateManager;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.container.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;';

    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.dataset.tool = tool.id;
      btn.title = `${tool.label} (${tool.key})`;
      btn.innerHTML = tool.icon;
      btn.style.cssText = `
        width: 36px; height: 36px; border: 1px solid transparent;
        border-radius: var(--radius-sm); background: transparent;
        color: var(--color-text-muted); font-size: 16px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.1s, border-color 0.1s, color 0.1s;
      `;
      btn.addEventListener('click', () => {
        this.state.set('activeTool', tool.id as ToolId, false);
      });
      this.container.appendChild(btn);
    }

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText =
      'width:24px;height:1px;background:var(--color-border);margin:4px 0;';
    this.container.appendChild(sep);

    this.updateActive(this.state.get().activeTool);
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('activeTool')) {
      this.updateActive(state.activeTool);
    }
  }

  private updateActive(activeTool: ToolId): void {
    this.container.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(btn => {
      const isActive = btn.dataset.tool === activeTool;
      btn.style.background = isActive ? 'var(--color-primary)' : '';
      btn.style.borderColor = isActive ? 'var(--color-primary)' : 'transparent';
      btn.style.color = isActive ? 'white' : 'var(--color-text-muted)';
    });
  }
}
