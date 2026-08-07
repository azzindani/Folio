// One-shot loader for the canvas context menu.
//
// The menu is a real command surface (selection actions, ordering, alignment,
// plus a separate empty-canvas menu), and none of it is needed until someone
// right-clicks. Keeping it out of the main entry chunk is worth the six lines
// below, because the main bundle sits against a hard CI budget.
import type { StateManager } from './state';

export function wireContextMenuLazily(pane: HTMLElement, state: StateManager): void {
  const onFirst = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    if (t.closest('textarea, input, [contenteditable="true"]')) return;
    pane.removeEventListener('contextmenu', onFirst);
    e.preventDefault();
    void import('./context-menu').then(({ CanvasContextMenu }) => {
      new CanvasContextMenu(state, pane);
      // The module's own listener missed THIS event, so replay it — otherwise
      // the very first right-click silently does nothing.
      pane.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY,
      }));
    });
  };
  pane.addEventListener('contextmenu', onFirst);
}
