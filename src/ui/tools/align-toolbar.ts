import { type StateManager, type EditorState } from '../../editor/state';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCenterH, alignCenterV, distributeH, distributeV,
  flipHorizontal, flipVertical,
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
  // Single-selection transforms
  { icon: '&#x21C6;', title: 'Flip horizontal (Shift+H)', fn: flipHorizontal, minSelect: 1 },
  { icon: '&#x21C5;', title: 'Flip vertical (Shift+V)',   fn: flipVertical,   minSelect: 1 },
];

export class AlignToolbar {
  private container: HTMLElement;
  private state: StateManager;
  private toolbar: HTMLElement;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.toolbar = this.build();
    this.refresh(0);
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(_state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('selectedLayerIds')) {
      this.refresh(this.state.get().selectedLayerIds.length);
    }
  }

  private refresh(count: number): void {
    // Hide entire toolbar unless at least 1 layer is selected (flip works on 1).
    this.toolbar.classList.toggle('align-toolbar--hidden', count < 1);
    this.toolbar.querySelectorAll<HTMLButtonElement>('.align-btn').forEach((btn, i) => {
      const minSel = ACTIONS[i]?.minSelect ?? 2;
      btn.classList.toggle('inactive', count < minSel);
    });
  }

  private build(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'align-toolbar';

    const labels = ['⬤▏', '⬤┃', '▕⬤', '▔⬤', '⬤━', '⬤▁', '⇐⇒', '⇑⇓', '⇄', '⇅'];

    ACTIONS.forEach((action, i) => {
      const btn = document.createElement('button');
      btn.className = 'align-btn';
      btn.title = action.title;
      btn.textContent = labels[i] ?? '·';
      btn.style.fontFamily = 'var(--font-mono)';
      btn.style.fontSize = '10px';
      btn.addEventListener('click', () => {
        const count = this.state.get().selectedLayerIds.length;
        if (count < action.minSelect) return;
        action.fn(this.state);
      });
      toolbar.appendChild(btn);
    });

    this.container.appendChild(toolbar);
    return toolbar;
  }
}
