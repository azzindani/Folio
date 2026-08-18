// Asset explorer — selection model and right-click menu.
//
// The two pieces of file-manager behaviour that are pure interaction: what
// clicking with a modifier held does to a selection, and the menu that answers
// "what can I do with these?". Kept apart from rendering so both can be
// reasoned about (and tested) without a DOM full of assets.

export interface ClickMods {
  ctrl: boolean;
  shift: boolean;
}

/**
 * Explorer's selection rules, which every desktop file manager shares:
 *
 *   plain click  → this one only, and it becomes the anchor
 *   ctrl/⌘ click → toggle this one, leaving the rest alone
 *   shift click  → the run from the anchor to here
 *
 * The anchor is what makes shift-click predictable: it stays put through a
 * range extension, so shift-clicking twice re-picks the range from the same
 * start rather than creeping along.
 */
export class Selection {
  private set = new Set<string>();
  private anchor: string | null = null;

  get size(): number { return this.set.size; }
  get keys(): Set<string> { return this.set; }
  has(key: string): boolean { return this.set.has(key); }
  values(): string[] { return [...this.set]; }

  clear(): void { this.set.clear(); this.anchor = null; }

  /** Drop keys that are no longer on screen (after a delete or a navigation). */
  retain(visible: string[]): void {
    const keep = new Set(visible);
    for (const k of [...this.set]) if (!keep.has(k)) this.set.delete(k);
    if (this.anchor && !keep.has(this.anchor)) this.anchor = null;
  }

  selectOnly(key: string): void {
    this.set = new Set([key]);
    this.anchor = key;
  }

  all(visible: string[]): void {
    this.set = new Set(visible);
    if (!this.anchor && visible.length) this.anchor = visible[0] ?? null;
  }

  click(key: string, order: string[], mods: ClickMods): void {
    if (mods.shift && this.anchor && order.includes(this.anchor)) {
      const a = order.indexOf(this.anchor);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        // Shift REPLACES the selection with the run, matching Explorer; ctrl
        // +shift would add to it, which is a refinement not worth the surface.
        this.set = new Set(order.slice(lo, hi + 1));
        return;
      }
    }
    if (mods.ctrl) {
      if (this.set.has(key)) this.set.delete(key); else this.set.add(key);
      this.anchor = key;
      return;
    }
    this.selectOnly(key);
  }
}

export interface MenuItem {
  label: string;
  /** Shown right-aligned — the keyboard route to the same action. */
  accel?: string;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
  separator?: boolean;
}

/**
 * A floating menu at (x, y), closed by Escape, an outside click, a scroll, or
 * picking something. Flipped back inside the viewport when it would overflow —
 * a right-click near the bottom of a panel is the common case, not the edge.
 */
export function openMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'ax-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.separator) {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'ax-menu-sep' }));
      continue;
    }
    const btn = document.createElement('button');
    btn.className = `ax-menu-item${item.danger ? ' danger' : ''}`;
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.disabled = Boolean(item.disabled);
    btn.textContent = item.label;
    if (item.accel) {
      const kbd = document.createElement('span');
      kbd.className = 'ax-menu-accel';
      kbd.textContent = item.accel;
      btn.appendChild(kbd);
    }
    btn.addEventListener('click', () => { closeMenu(); item.run?.(); });
    menu.appendChild(btn);
  }
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);

  const r = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const dismiss = (ev: Event): void => {
    if (ev.type === 'pointerdown' && menu.contains(ev.target as Node)) return;
    closeMenu();
  };
  const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); } };
  // Captured so a panel that stops propagation on its own listeners cannot
  // strand an open menu on screen.
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', dismiss, true);
    window.addEventListener('resize', dismiss, true);
  }, 0);
  cleanup = () => {
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', dismiss, true);
    window.removeEventListener('resize', dismiss, true);
  };
}

let cleanup: (() => void) | null = null;

export function closeMenu(): void {
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.ax-menu').forEach(el => el.remove());
}
