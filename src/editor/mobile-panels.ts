// Folio editor — mobile popovers for panels and tools.
//
// A phone hid two thirds of the editor: the activity bar and the right-hand tab
// rail are display:none under 768px, so Components, Icons, Find, Data, Scripts,
// Colors, Animate, Timeline, Issues and Accessibility had no route at all, and
// the drawing tools sat in a 777px strip inside a 390px screen with seven of
// them scrolled off the end.
//
// Nothing here re-implements those panels. Each popover entry is generated FROM
// the desktop control it stands for and dispatches a click to it, so the phone
// and the desktop always expose the same set — a panel added to the activity bar
// shows up here without a second edit.

/** One popover entry, mirroring a real control elsewhere in the DOM. */
export interface PopEntry {
  key: string;
  label: string;
  icon: string;
  /** The control this entry stands in for. */
  source: HTMLElement;
}

/** Titles carry their shortcut ("Layers (⌘⇧L)") — the hint is noise on a phone. */
function labelOf(el: HTMLElement): string {
  const raw = el.getAttribute('title') ?? el.getAttribute('aria-label') ?? '';
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Collect the left-panel views, the right-panel tabs and the theme toggle. */
export function collectPanelEntries(container: HTMLElement): PopEntry[] {
  const entries: PopEntry[] = [];
  const push = (el: HTMLElement, key: string): void => {
    entries.push({ key, label: labelOf(el) || key, icon: el.innerHTML, source: el });
  };
  for (const el of container.querySelectorAll<HTMLElement>('.activity-bar .act-btn[data-panel]')) {
    push(el, `panel:${el.dataset['panel'] ?? ''}`);
  }
  for (const el of container.querySelectorAll<HTMLElement>('.r-activity-bar .rpanel-tab[data-tab]')) {
    push(el, `tab:${el.dataset['tab'] ?? ''}`);
  }
  const theme = container.querySelector<HTMLElement>('#theme-toggle');
  if (theme) entries.push({ key: 'theme', label: 'Theme', icon: theme.innerHTML, source: theme });
  return entries;
}

/** Every drawing tool, in palette order. */
export function collectToolEntries(container: HTMLElement): PopEntry[] {
  return [...container.querySelectorAll<HTMLElement>('.tools-panel .tool-btn')].map(el => ({
    key: `tool:${el.dataset['tool'] ?? labelOf(el)}`,
    label: labelOf(el),
    icon: el.innerHTML,
    source: el,
  }));
}

function entryMarkup(e: PopEntry, active: boolean): string {
  return `<button class="mob-pop-item${active ? ' active' : ''}" data-key="${e.key}" type="button">
    <span class="mob-pop-icon" aria-hidden="true">${e.icon}</span>
    <span class="mob-pop-label">${e.label}</span>
  </button>`;
}

export interface PopoverOptions {
  /** Which entry should read as current (the open panel / active tool). */
  isActive?: (e: PopEntry) => boolean;
  /** Runs instead of clicking the source control, when the caller needs to do
   *  more than forward the click (open a sheet first, lazily build a panel…). */
  onPick?: (e: PopEntry) => void;
  /** Keep the sheet open after a pick — tools close, panel switches do not. */
  stayOpen?: boolean;
}

/**
 * A labelled grid of entries, shown as a bottom sheet over everything.
 *
 * One popover element is reused per id: reopening re-renders its contents, so an
 * entry list that changed (a new panel, a different active tool) is picked up
 * without leaking a second copy into the DOM.
 */
export class MobilePopover {
  private el: HTMLElement;
  private entries: PopEntry[] = [];
  private opts: PopoverOptions = {};

  constructor(container: HTMLElement, id: string, title: string) {
    const existing = container.querySelector<HTMLElement>(`#${id}`);
    if (existing) {
      this.el = existing;
    } else {
      this.el = document.createElement('div');
      this.el.id = id;
      this.el.className = 'mob-pop';
      this.el.innerHTML = `<div class="mob-pop-head"><span>${title}</span>
        <button class="mob-pop-close" type="button" aria-label="Close">✕</button></div>
        <div class="mob-pop-grid"></div>`;
      container.appendChild(this.el);
    }
    this.el.querySelector('.mob-pop-close')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('.mob-pop-item');
      if (!btn) return;
      const entry = this.entries.find(e => e.key === btn.dataset['key']);
      if (!entry) return;
      if (this.opts.onPick) this.opts.onPick(entry);
      else entry.source.click();
      if (!this.opts.stayOpen) this.close();
    });
  }

  get isOpen(): boolean { return this.el.classList.contains('open'); }

  open(entries: PopEntry[], opts: PopoverOptions = {}): void {
    this.entries = entries;
    this.opts = opts;
    const grid = this.el.querySelector('.mob-pop-grid');
    if (grid) grid.innerHTML = entries.map(e => entryMarkup(e, opts.isActive?.(e) ?? false)).join('');
    this.el.classList.add('open');
  }

  close(): void { this.el.classList.remove('open'); }

  toggle(entries: PopEntry[], opts: PopoverOptions = {}): void {
    if (this.isOpen) this.close(); else this.open(entries, opts);
  }
}
