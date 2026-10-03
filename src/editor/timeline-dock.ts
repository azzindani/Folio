/**
 * The timeline as a dock under the canvas — the sequence editor, wide enough to read.
 *
 * ONE timeline exists (ui/panels/timeline-panel.ts). Its root, `.timeline-content`, is moved: into this dock
 * on a desktop or a tablet, back into the right panel's Timeline pane on a phone (where it is a sheet).
 * The dock's height is dragged like any panel (`--timeline-dock-height`, kept), its open state is kept, and a
 * design with footage opens it the first time the person has not yet chosen. The rail's clock tab, the status
 * bar's button, Shift+T and the command palette all land on `toggle`.
 */

import type { StateManager } from './state';
import { PHONE_LAYOUT_MQ } from './breakpoints';
import { PanelResizer } from '../ui/resize/panel-resizer';
import { hasVideoLayer } from './video-presence';

const OPEN_KEY = 'folio-timeline-dock-open';

export interface TimelineDock {
  isOpen(): boolean;
  /** Open, close, or (no argument) flip. False on a phone, where there is no dock. */
  toggle(open?: boolean): boolean;
}

const read = (): boolean | null => {
  try { const v = localStorage.getItem(OPEN_KEY); return v === null ? null : v === '1'; } catch { return null; }
};
const write = (open: boolean): void => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* storage blocked */ } };

export function wireTimelineDock(container: HTMLElement, state: StateManager): TimelineDock | null {
  const dock = container.querySelector<HTMLElement>('#timeline-dock');
  const body = dock?.querySelector<HTMLElement>('.timeline-dock-body');
  const content = container.querySelector<HTMLElement>('.timeline-content');
  const pane = content?.parentElement;
  const app = container.closest<HTMLElement>('#app') ?? container;
  if (!dock || !body || !content || !pane) return null;

  const resizer = new PanelResizer({ cssVar: '--timeline-dock-height', axis: 'y', min: 150, max: 720, invert: true });
  dock.querySelector('[data-resize="timeline-dock"]')?.replaceWith(resizer.getHandle());

  let open = read() ?? false;
  const phone = window.matchMedia?.(PHONE_LAYOUT_MQ);
  const docked = (): boolean => !(phone?.matches ?? false);
  const apply = (): void => {
    const home = docked() ? body : pane;
    if (content.parentElement !== home) home.appendChild(content);
    const shown = docked() && open;
    dock.style.display = shown ? '' : 'none';
    app.classList.toggle('has-timeline-dock', docked());
    app.classList.toggle('timeline-dock-open', shown);
    container.querySelector('#status-timeline')?.classList.toggle('active', shown);
  };
  phone?.addEventListener?.('change', apply);

  const api: TimelineDock = {
    isOpen: () => docked() && open,
    toggle(next) {
      if (!docked()) return false;
      open = next ?? !open;
      write(open);
      apply();
      return open;
    },
  };

  // The rail's clock tab SHOWS the dock where there is one (a tab never closes what it names; the pane it used to
  // switch to is empty now). The status bar's button, Shift+T and the dock's ✕ flip it.
  container.querySelector('.rpanel-tab[data-tab="timeline"]')?.addEventListener('click', e => {
    if (!docked()) return;
    e.stopImmediatePropagation();
    api.toggle(true);
  }, true);
  container.querySelector('#status-timeline')?.addEventListener('click', () => api.toggle());
  container.querySelector('#timeline-dock-close')?.addEventListener('click', () => api.toggle(false));

  // Footage is what the dock is for: the first design with a clip opens it, once, unless the person has already chosen.
  let decided = read() !== null;
  state.subscribe((s, keys) => {
    if (decided || !keys.includes('design') || !hasVideoLayer(s.design)) return;
    decided = true;
    if (!open) { open = true; apply(); }
  });
  apply();
  return api;
}
