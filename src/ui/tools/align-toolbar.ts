import { type StateManager, type EditorState } from '../../editor/state';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCenterH, alignCenterV, distributeH, distributeV,
} from '../../editor/interactions';

interface AlignAction {
  icon: string;
  title: string;
  fn: (state: StateManager) => void;
  minSelect: number;
}

const ACTIONS: AlignAction[] = [
  { icon: '&#x2194;', title: 'Align left edges',   fn: alignLeft,    minSelect: 2 },
  { icon: '&#x21C6;', title: 'Center horizontal',  fn: alignCenterH, minSelect: 2 },
  { icon: '&#x2194;', title: 'Align right edges',  fn: alignRight,   minSelect: 2 },
  { icon: '&#x2195;', title: 'Align top edges',    fn: alignTop,     minSelect: 2 },
  { icon: '&#x21C5;', title: 'Center vertical',    fn: alignCenterV, minSelect: 2 },
  { icon: '&#x2195;', title: 'Align bottom edges', fn: alignBottom,  minSelect: 2 },
  { icon: '&#x2194;', title: 'Distribute horizontally', fn: distributeH, minSelect: 3 },
  { icon: '&#x2195;', title: 'Distribute vertically',   fn: distributeV, minSelect: 3 },
];

export class AlignToolbar {
  private container: HTMLElement;
  private state: StateManager;
  private toolbar: HTMLElement | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(_state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('selectedLayerIds')) {
      this.update();
    }
  }

  private update(): void {
    const count = this.state.get().selectedLayerIds.length;

    if (count < 2) {
      this.hide();
      return;
    }

    if (!this.toolbar) {
      this.build();
    }

    // Update disabled state per button
    this.toolbar!.querySelectorAll<HTMLButtonElement>('.align-btn').forEach((btn, i) => {
      const minSel = ACTIONS[i]?.minSelect ?? 2;
      btn.disabled = count < minSel;
      btn.style.opacity = count < minSel ? '0.3' : '1';
    });

    this.toolbar!.style.display = 'flex';
  }

  private build(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'align-toolbar';

    // Use clear text glyphs instead of hard-to-read unicode
    const labels = ['⬤▏', '⬤┃', '▕⬤', '▔⬤', '⬤━', '⬤▁', '⇐⇒', '⇑⇓'];

    ACTIONS.forEach((action, i) => {
      const btn = document.createElement('button');
      btn.className = 'align-btn';
      btn.title = action.title;
      btn.textContent = labels[i] ?? '·';
      btn.style.fontFamily = 'var(--font-mono)';
      btn.style.fontSize = '10px';
      btn.addEventListener('click', () => action.fn(this.state));
      this.toolbar!.appendChild(btn);
    });

    this.container.appendChild(this.toolbar);
  }

  private hide(): void {
    if (this.toolbar) {
      this.toolbar.style.display = 'none';
    }
  }
}
