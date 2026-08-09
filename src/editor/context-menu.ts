// Folio editor — right-click context menu on the canvas.
//
// Two menus, not one. Right-clicking a LAYER offers what you can do to it;
// right-clicking empty canvas offers what you can do to the document. Serving
// a selection menu with everything greyed out — which is what a single menu
// does on an empty click — tells the user nothing and wastes the gesture.
//
// Every entry runs the SAME shared action the keyboard and the panels use, so
// the menu can never drift from the shortcut printed beside it.
import { StateManager } from './state';
import {
  flipHorizontal, flipVertical,
  alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV,
  distributeH, distributeV,
} from './interactions';
import * as actions from './layer-actions';
import { sc } from '../utils/shortcut';

interface MenuItem {
  label: string;
  hint?: string;
  enabled: boolean;
  run: () => void;
}

const SEP = null;
type Entry = MenuItem | typeof SEP;

export class CanvasContextMenu {
  private state: StateManager;
  private menu: HTMLElement | null = null;
  /** Where the click landed, in design coords — "paste here" needs it. */
  private at: { x: number; y: number } = { x: 0, y: 0 };

  constructor(state: StateManager, canvasSection: HTMLElement) {
    this.state = state;
    canvasSection.addEventListener('contextmenu', (e) => {
      // Let inline text editing keep the native menu (spellcheck etc.)
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, [contenteditable="true"]')) return;
      e.preventDefault();
      const onLayer = !!t.closest('[data-layer-id]');
      // canvas-interactions selects the layer under the cursor on right-click
      // before this listener runs; give it a tick to settle the selection.
      setTimeout(() => this.open(e.clientX, e.clientY, onLayer), 0);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  /** Actions on the current selection. */
  private layerItems(): Entry[] {
    const sel = this.state.getSelectedLayers();
    const n = sel.length;
    const hasGroup = sel.some(l => l.type === 'group');
    const anyUnlocked = sel.some(l => !(l as { locked?: boolean }).locked);
    const allHidden = n > 0 && sel.every(l => (l as { visible?: boolean }).visible === false);
    const multi = n >= 2;
    const s = this.state;
    return [
      { label: 'Cut', hint: sc('⌘X'), enabled: n > 0, run: () => actions.cutSelected(s) },
      { label: 'Copy', hint: sc('⌘C'), enabled: n > 0, run: () => actions.copySelected(s) },
      { label: 'Paste', hint: sc('⌘V'), enabled: true, run: () => actions.pasteFromClipboard(s) },
      { label: 'Duplicate', hint: sc('⌘D'), enabled: n > 0, run: () => actions.duplicateSelected(s) },
      SEP,
      { label: 'Bring to front', hint: sc('⌘⇧]'), enabled: n > 0, run: () => actions.bringToFront(s) },
      { label: 'Bring forward', hint: sc('⌘]'), enabled: n > 0, run: () => actions.adjustZ(s, 1) },
      { label: 'Send backward', hint: sc('⌘['), enabled: n > 0, run: () => actions.adjustZ(s, -1) },
      { label: 'Send to back', hint: sc('⌘⇧['), enabled: n > 0, run: () => actions.sendToBack(s) },
      SEP,
      { label: 'Group', hint: sc('⌘G'), enabled: multi, run: () => actions.groupSelected(s) },
      { label: 'Ungroup', hint: sc('⌘⇧G'), enabled: hasGroup, run: () => actions.ungroupSelected(s) },
      SEP,
      // Alignment needs something to align TO, so it only appears with a real
      // multi-selection rather than sitting there permanently greyed out.
      ...(multi ? [
        { label: 'Align left', enabled: true, run: () => alignLeft(s) },
        { label: 'Align centre', enabled: true, run: () => alignCenterH(s) },
        { label: 'Align right', enabled: true, run: () => alignRight(s) },
        { label: 'Align top', enabled: true, run: () => alignTop(s) },
        { label: 'Align middle', enabled: true, run: () => alignCenterV(s) },
        { label: 'Align bottom', enabled: true, run: () => alignBottom(s) },
        { label: 'Distribute horizontally', enabled: n >= 3, run: () => distributeH(s) },
        { label: 'Distribute vertically', enabled: n >= 3, run: () => distributeV(s) },
        SEP,
      ] as Entry[] : []),
      { label: 'Flip horizontal', hint: sc('⇧H'), enabled: n > 0, run: () => flipHorizontal(s) },
      { label: 'Flip vertical', hint: sc('⇧V'), enabled: n > 0, run: () => flipVertical(s) },
      SEP,
      { label: allHidden ? 'Show' : 'Hide', enabled: n > 0, run: () => actions.toggleVisibilitySelected(s) },
      { label: anyUnlocked ? 'Lock' : 'Unlock', enabled: n > 0, run: () => actions.toggleLockSelected(s) },
      SEP,
      { label: 'Select all', hint: sc('⌘A'), enabled: true, run: () => s.set('selectedLayerIds', s.getCurrentLayers().map(l => l.id)) },
      { label: 'Delete', hint: 'Del', enabled: n > 0, run: () => actions.deleteSelected(s) },
    ];
  }

  /** Actions on the document, for a right-click that hit no layer. */
  private canvasItems(): Entry[] {
    const s = this.state;
    const add = (type: string, extra: Record<string, unknown>): void => {
      const { x, y } = this.at;
      s.addLayer({
        id: `${type}-${Date.now().toString(36)}`, type,
        x: Math.round(x), y: Math.round(y), z: (s.getCurrentLayers().length + 1) * 10,
        ...extra,
      } as unknown as Parameters<typeof s.addLayer>[0]);
    };
    const zoom = s.get().zoom ?? 1;
    return [
      { label: 'Paste here', hint: sc('⌘V'), enabled: true, run: () => actions.pasteFromClipboard(s) },
      SEP,
      { label: 'Add rectangle', hint: 'R', enabled: true, run: () => add('rect', { width: 200, height: 140, fill: '#3B82F6' }) },
      { label: 'Add ellipse', hint: 'C', enabled: true, run: () => add('ellipse', { width: 160, height: 160, fill: '#3B82F6' }) },
      { label: 'Add text', hint: 'T', enabled: true, run: () => add('text', { width: 320, content: 'Text', style: { font_size: 32, color: '#111111' } }) },
      SEP,
      { label: 'Select all', hint: sc('⌘A'), enabled: true, run: () => s.set('selectedLayerIds', s.getCurrentLayers().map(l => l.id)) },
      { label: 'Deselect', hint: 'Esc', enabled: s.get().selectedLayerIds.length > 0, run: () => s.set('selectedLayerIds', []) },
      SEP,
      { label: 'Zoom in', enabled: zoom < 5, run: () => s.set('zoom', Math.min(5, zoom * 1.25), false) },
      { label: 'Zoom out', enabled: zoom > 0.1, run: () => s.set('zoom', Math.max(0.1, zoom / 1.25), false) },
      { label: 'Zoom to 100%', hint: sc('⌘1'), enabled: true, run: () => s.set('zoom', 1, false) },
      SEP,
      { label: s.get().gridVisible ? 'Hide grid' : 'Show grid', hint: 'G', enabled: true, run: () => s.set('gridVisible', !s.get().gridVisible, false) },
    ];
  }

  private open(x: number, y: number, onLayer: boolean): void {
    this.close();
    // Screen → design coords, so "add here" lands under the cursor.
    const st = this.state.get();
    const pane = document.querySelector<HTMLElement>('.canvas-area');
    const box = pane?.getBoundingClientRect();
    const z = st.zoom ?? 1;
    this.at = {
      x: ((x - (box?.left ?? 0)) - (st.panX ?? 0)) / z,
      y: ((y - (box?.top ?? 0)) - (st.panY ?? 0)) / z,
    };

    const menu = document.createElement('div');
    menu.className = 'canvas-context-menu';
    const entries = onLayer || this.state.get().selectedLayerIds.length
      ? this.layerItems() : this.canvasItems();
    let lastWasSep = true;   // never open with a rule
    for (const item of entries) {
      if (item === SEP) {
        if (lastWasSep) continue;
        const hr = document.createElement('div');
        hr.className = 'ccm-sep';
        menu.appendChild(hr);
        lastWasSep = true;
        continue;
      }
      lastWasSep = false;
      const btn = document.createElement('button');
      btn.className = 'ccm-item';
      btn.disabled = !item.enabled;
      const lbl = document.createElement('span');
      lbl.textContent = item.label;
      btn.appendChild(lbl);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'ccm-hint';
        hint.textContent = item.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener('click', () => { this.close(); item.run(); });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    // Keep the menu on-screen (flip near right/bottom edges). On a phone the
    // floor is the fixed bottom nav, not the viewport: it paints OVER the
    // canvas, so clamping to innerHeight hides the last rows behind it.
    const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
    const floor = nav && nav.height > 0 ? nav.top : window.innerHeight;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, floor - r.height - 4))}px`;
    this.menu = menu;
  }

  close(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
