import { type StateManager, type EditorState } from '../../editor/state';
import { openFile, saveFile } from '../../fs/file-access';

const RECENT_KEY = 'folio:recentFiles';
const MAX_RECENT = 8;

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch { return []; }
}

function pushRecent(name: string): void {
  const list = [name, ...getRecent().filter(n => n !== name)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

export class FileTreeManager {
  private container: HTMLElement;
  private state: StateManager;
  private onOpen: (yaml: string, name: string, handle: unknown) => void;
  private onSave: () => string;

  constructor(
    container: HTMLElement,
    state: StateManager,
    callbacks: {
      onOpen: (yaml: string, name: string, handle: unknown) => void;
      onSave: () => string;
    },
  ) {
    this.container = container;
    this.state = state;
    this.onOpen = callbacks.onOpen;
    this.onSave = callbacks.onSave;
    this.build();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private build(): void {
    this.container.innerHTML = '';

    // Action buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;padding:4px 0 8px';

    const openBtn = this.makeBtn('Open', 'Ctrl+O', () => this.triggerOpen());
    const saveBtn = this.makeBtn('Save', 'Ctrl+S', () => this.triggerSave());

    actions.appendChild(openBtn);
    actions.appendChild(saveBtn);
    this.container.appendChild(actions);

    // Current file
    const current = document.createElement('div');
    current.className = 'filetree-current';
    current.style.cssText = 'margin-bottom:8px';
    this.container.appendChild(current);

    // Recent files
    const recentHeader = document.createElement('div');
    recentHeader.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);padding:4px 0;margin-top:4px;border-top:1px solid var(--color-border)';
    recentHeader.textContent = 'Recent';
    this.container.appendChild(recentHeader);

    const recentList = document.createElement('div');
    recentList.className = 'filetree-recent';
    this.container.appendChild(recentList);

    this.refreshCurrent();
    this.refreshRecent();
  }

  private makeBtn(label: string, hint: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.title = hint;
    btn.textContent = label;
    btn.style.cssText = 'flex:1;font-size:11px;padding:4px 6px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  private onStateChange(_s: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('design') || changedKeys.includes('dirty')) {
      this.refreshCurrent();
    }
  }

  private refreshCurrent(): void {
    const el = this.container.querySelector('.filetree-current');
    if (!el) return;
    const { design, dirty } = this.state.get();
    if (!design) {
      el.innerHTML = '<div style="font-size:11px;color:var(--color-text-muted);padding:2px 0">No file open</div>';
      return;
    }
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:var(--color-surface-2);border-radius:4px">
        <span style="font-size:14px">&#x1F4C4;</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${design.meta.name}</div>
          <div style="font-size:10px;color:var(--color-text-muted)">${design.meta.type} · ${(design.layers ?? design.pages ?? []).length} ${design.pages ? 'pages' : 'layers'}</div>
        </div>
        ${dirty ? '<span style="color:var(--color-warning);font-size:10px" title="Unsaved changes">&#x25CF;</span>' : ''}
      </div>`;
  }

  private refreshRecent(): void {
    const el = this.container.querySelector('.filetree-recent');
    if (!el) return;
    const recent = getRecent();
    if (recent.length === 0) {
      el.innerHTML = '<div style="font-size:11px;color:var(--color-text-muted);padding:4px 0">None</div>';
      return;
    }
    el.innerHTML = recent.map(name => `
      <div class="filetree-recent-item" style="display:flex;align-items:center;gap:6px;padding:4px 6px;
        border-radius:4px;cursor:pointer;font-size:11px;color:var(--color-text-muted)"
        data-name="${name}">
        <span style="font-size:11px">&#x1F4C4;</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      </div>`).join('');

    el.querySelectorAll('.filetree-recent-item').forEach(item => {
      (item as HTMLElement).addEventListener('mouseenter', () => {
        (item as HTMLElement).style.background = 'var(--color-surface-2)';
      });
      (item as HTMLElement).addEventListener('mouseleave', () => {
        (item as HTMLElement).style.background = '';
      });
    });
  }

  async triggerOpen(): Promise<void> {
    try {
      const { content, name, handle } = await openFile('.yaml,.yml,.design.yaml');
      pushRecent(name);
      this.onOpen(content, name, handle);
      this.refreshRecent();
    } catch {
      // User cancelled picker — no-op
    }
  }

  triggerSave(): void {
    const yaml = this.onSave();
    const name = (this.state.get().design?.meta.name ?? 'design').replace(/\s+/g, '-').toLowerCase() + '.design.yaml';
    saveFile(yaml, name).catch(() => {});
    this.state.set('dirty', false);
  }
}
