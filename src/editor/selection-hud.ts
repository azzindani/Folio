// Folio editor — the touch selection bar.
//
// What you get the moment you select something on a phone: the verbs, beside
// the object. Nothing here is new capability — every item runs the same shared
// action the desktop right-click and the keyboard run — it is the same commands
// at arm's length instead of at the bottom of the screen.
//
// THE DETERMINATIONS.
//  1. Verbs come to the object; lists stay at the bottom. Layers, Tools and
//     Panels are things you browse, and a sheet is the right home for them.
//     Duplicate/Delete/Order/Edit are things you do TO a selection, so they
//     appear where the selection is.
//  2. Below by default. A phone is held from the bottom, so a control under
//     the selection is reached without the hand covering what it edits. Above
//     is the fallback, not the preference (see anchor-place.ts).
//  3. Five verbs, not twenty. The bar is the frequent half; `⋯` opens the full
//     menu — the same one the desktop shows — anchored to the same spot.
//  4. One surface at a time. Opening the inspector replaces the bar rather
//     than stacking a second floating thing beside a small object.
//  5. It never fights the canvas. It vanishes for the duration of any drag,
//     pan or pinch, and while a sheet is open (see anchored-surface.ts).
//  6. Nothing is removed. The bottom nav, the sheets and the reach arc all
//     stay exactly as they were — this is a shorter route, not a replacement.
import type { StateManager } from './state';
import { AnchoredSurface, selectionRect } from './anchored-surface';
import * as actions from './layer-actions';
import { QuickEdit } from './quick-edit';

interface HudItem {
  key: string;
  label: string;
  glyph: string;
  /** Hidden rather than greyed out when this returns false. */
  when?: (n: number) => boolean;
}

const ITEMS: HudItem[] = [
  { key: 'edit', label: 'Edit', glyph: '✎' },
  { key: 'duplicate', label: 'Copy', glyph: '⧉' },
  { key: 'front', label: 'Front', glyph: '↥' },
  { key: 'group', label: 'Group', glyph: '⊞', when: n => n >= 2 },
  { key: 'delete', label: 'Delete', glyph: '✕' },
  { key: 'more', label: 'More', glyph: '⋯' },
];

/** Fire the canvas's own context menu at a point — the lazily-loaded module
 *  listens for the real event, so `⋯` and a long press produce the identical
 *  menu with no second implementation to drift. */
function openFullMenu(x: number, y: number): void {
  const el = document.elementFromPoint(x, y)
    ?? document.querySelector('.canvas-area');
  el?.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
  }));
}

/**
 * Mount the selection bar and its inspector. Phones and tablets only — the
 * desktop already has this gesture, at the cursor, on right-click.
 */
export function wireSelectionHud(container: HTMLElement, state: StateManager): (() => void) | null {
  if (container.querySelector('.sel-hud')) return null;

  const quick = new QuickEdit(container, state);

  const bar = new AnchoredSurface(container, state, {
    className: 'sel-hud',
    visible: () => !quick.isOpen,
    render: (el) => {
      const n = state.get().selectedLayerIds.length;
      const wanted = ITEMS.filter(i => i.when?.(n) ?? true);
      const signature = wanted.map(i => i.key).join(',');
      if (el.dataset['sig'] === signature) return;
      el.dataset['sig'] = signature;
      el.innerHTML = wanted.map(i => `<button type="button" class="sel-hud-btn" data-key="${i.key}"
        aria-label="${i.label}"><span class="sel-hud-glyph" aria-hidden="true">${i.glyph}</span>
        <span class="sel-hud-label">${i.label}</span></button>`).join('');
    },
  });

  bar.el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.sel-hud-btn');
    const key = btn?.dataset['key'];
    if (!key) return;
    switch (key) {
      case 'edit': quick.toggle(); break;
      case 'duplicate': actions.duplicateSelected(state); break;
      case 'front': actions.bringToFront(state); break;
      case 'group': actions.groupSelected(state); break;
      case 'delete': actions.deleteSelected(state); break;
      case 'more': {
        // Anchor the menu on the selection, not on the bar: the bar is about
        // to be covered by the menu, and the object is what the menu is for.
        const r = selectionRect(document);
        const box = bar.el.getBoundingClientRect();
        openFullMenu(r ? r.x + r.width / 2 : box.left, r ? r.y + r.height / 2 : box.top);
        break;
      }
      default: break;
    }
  });

  // A tap on an already-selected layer re-opens the bar after it was dismissed,
  // and the canvas's own selection change covers every other case.
  quick.onClose = () => bar.schedule();

  bar.schedule();
  return () => { bar.destroy(); quick.destroy(); };
}
