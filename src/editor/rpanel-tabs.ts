// Folio editor — fold the right activity rail into the panel header on desktop.
//
// The rail is a 48px column that exists only to switch the right panel's tab.
// With both panels open the chrome costs 656px, so at 1280 the canvas was 39%
// of the window; those 48px are the cheapest ones to get back, because the
// same eight tabs fit across the panel's own header.
//
// The NODE is moved, not re-created — `bindRightPanelTabs` in app-base binds
// `.r-activity-bar .rpanel-tab` once, and every one of those bindings survives
// a reparent. A marker restores it to the grid exactly where it was.
//
// It stays a column on TOUCH layouts, and that is not a detail: there the
// panel itself is an off-screen overlay, and the rail is the only thing that
// can bring it back. Folded into the panel, it would go off-screen with it.
import { TOUCH_LAYOUT_MQ } from './breakpoints';

const FOLDED = 'rtabs-folded';

export function wireRightPanelTabs(container: HTMLElement): void {
  const rail = container.querySelector<HTMLElement>('.r-activity-bar');
  const panel = container.querySelector<HTMLElement>('.properties-panel');
  const app = container.closest('#app') ?? container;
  if (!rail || !panel) return;

  // Where the rail goes back to when the layout turns touch.
  const marker = document.createComment('r-activity-bar');
  rail.parentElement?.insertBefore(marker, rail);

  // The reopen affordance: with the rail folded away, a collapsed right panel
  // would have nothing left to reopen it. This tab rides the canvas's right
  // edge, is absolutely positioned (so it costs no layout width), and is shown
  // by CSS only while #app is both folded and rpanel-collapsed.
  let reopen = container.querySelector<HTMLButtonElement>('.rpanel-reopen');
  if (!reopen) {
    reopen = document.createElement('button');
    reopen.className = 'rpanel-reopen';
    reopen.type = 'button';
    reopen.title = 'Show the properties panel';
    reopen.setAttribute('aria-label', 'Show the properties panel');
    reopen.textContent = '‹';
    reopen.addEventListener('click', () => {
      app.classList.remove('rpanel-collapsed');
      panel.classList.remove('mob-open');
    });
    container.appendChild(reopen);
  }

  // Collapse control for the folded strip. The tabs cannot own this — see the
  // note in wireRpanelTabs — so the strip ends with an explicit one.
  let hide = rail.querySelector<HTMLButtonElement>('.rpanel-hide');
  if (!hide) {
    hide = document.createElement('button');
    hide.className = 'act-btn rpanel-hide';
    hide.type = 'button';
    hide.title = 'Hide the panel';
    hide.setAttribute('aria-label', 'Hide the panel');
    hide.textContent = '›';
    hide.addEventListener('click', () => app.classList.add('rpanel-collapsed'));
    rail.appendChild(hide);
  }

  const mq = window.matchMedia(TOUCH_LAYOUT_MQ);
  const apply = (): void => {
    if (mq.matches) {
      // Touch: the rail is the panel's only handle — put it back in the grid.
      if (rail.parentElement !== marker.parentElement) marker.parentElement?.insertBefore(rail, marker.nextSibling);
      rail.classList.remove('rpanel-tabstrip');
      app.classList.remove(FOLDED);
    } else {
      if (rail.parentElement !== panel) panel.insertBefore(rail, panel.firstChild);
      rail.classList.add('rpanel-tabstrip');
      app.classList.add(FOLDED);
    }
  };
  apply();
  mq.addEventListener('change', apply);
}
