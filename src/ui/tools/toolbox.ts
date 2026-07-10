import { type StateManager, type EditorState, type ToolId } from '../../editor/state';
import { chromeIcon } from '../../editor/chrome-icons';

interface ToolDef {
  id: ToolId;
  icon: string;
  label: string;
  key: string;
  group?: string;   // separator before this item within a group
}

const TOOLS: ToolDef[] = [
  // Selection
  { id: 'select',     icon: chromeIcon('cursor'),  label: 'Select',      key: 'V' },
  { id: 'hand',       icon: chromeIcon('hand'),    label: 'Pan',         key: 'H' },

  // Shapes
  { id: 'rect',       icon: chromeIcon('square'),  label: 'Rectangle',   key: 'R', group: 'shapes' },
  { id: 'circle',     icon: chromeIcon('circle'),  label: 'Circle',      key: 'C' },
  { id: 'polygon',    icon: chromeIcon('hexagon'), label: 'Polygon',     key: 'P' },
  { id: 'star',       icon: chromeIcon('star'),    label: 'Star',        key: '' },
  { id: 'line',       icon: chromeIcon('line'),    label: 'Line',        key: 'L' },
  { id: 'arrow',      icon: chromeIcon('arrow'),   label: 'Arrow',       key: '' },

  // Drawing
  { id: 'pen',        icon: chromeIcon('pen'),     label: 'Pen',         key: 'P', group: 'draw' },

  // Content
  { id: 'frame',      icon: chromeIcon('frame'),   label: 'Frame',       key: 'F', group: 'content' },
  { id: 'text',       icon: 'T',                   label: 'Text',        key: 'T' },
  { id: 'image',      icon: chromeIcon('image'),   label: 'Image',       key: '' },

  // Color
  { id: 'eyedropper', icon: chromeIcon('eyedropper'), label: 'Eyedropper', key: 'I', group: 'color' },
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
    this.container.innerHTML = '';
    let lastGroup: string | undefined;

    for (const tool of TOOLS) {
      // Separator between groups
      if (tool.group && tool.group !== lastGroup) {
        lastGroup = tool.group;
        const sep = document.createElement('div');
        sep.className = 'tool-section-sep';
        this.container.appendChild(sep);
      }

      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.dataset.tool = tool.id;
      btn.title = tool.key ? `${tool.label} (${tool.key})` : tool.label;
      btn.innerHTML = tool.icon;
      btn.addEventListener('click', () => {
        this.state.set('activeTool', tool.id, false);
      });
      this.container.appendChild(btn);
    }

    this.updateActive(this.state.get().activeTool);
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('activeTool')) {
      this.updateActive(state.activeTool);
    }
  }

  private updateActive(activeTool: ToolId): void {
    this.container.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === activeTool);
    });
  }
}
