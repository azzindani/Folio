import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Selection, openMenu, closeMenu } from './asset-explorer-menu';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const plain = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };

describe('Selection — the rules every file manager shares', () => {
  let s: Selection;
  beforeEach(() => { s = new Selection(); });

  it('a plain click takes just that one', () => {
    s.click('a', ORDER, plain);
    s.click('c', ORDER, plain);
    expect(s.values()).toEqual(['c']);
  });

  it('ctrl-click adds, and clicking the same one again removes it', () => {
    s.click('a', ORDER, plain);
    s.click('c', ORDER, ctrl);
    expect(s.values()).toEqual(['a', 'c']);
    s.click('a', ORDER, ctrl);
    expect(s.values()).toEqual(['c']);
  });

  it('shift-click takes the run from the anchor', () => {
    s.click('b', ORDER, plain);
    s.click('d', ORDER, shift);
    expect(s.values()).toEqual(['b', 'c', 'd']);
  });

  it('shift-click backwards takes the same run', () => {
    s.click('d', ORDER, plain);
    s.click('b', ORDER, shift);
    expect(s.values()).toEqual(['b', 'c', 'd']);
  });

  it('the anchor stays put, so shift-clicking twice re-picks rather than creeping', () => {
    s.click('b', ORDER, plain);
    s.click('e', ORDER, shift);
    s.click('c', ORDER, shift);
    expect(s.values()).toEqual(['b', 'c']);
  });

  it('ctrl-click moves the anchor to what was ctrl-clicked', () => {
    s.click('a', ORDER, plain);
    s.click('c', ORDER, ctrl);
    s.click('e', ORDER, shift);
    expect(s.values()).toEqual(['c', 'd', 'e']);
  });

  it('shift with no anchor behaves like a plain click', () => {
    s.click('c', ORDER, shift);
    expect(s.values()).toEqual(['c']);
  });

  it('select-all takes everything on screen', () => {
    s.all(ORDER);
    expect(s.size).toBe(5);
  });

  it('retain drops what has scrolled out of existence — a deleted file cannot stay selected', () => {
    s.all(ORDER);
    s.retain(['a', 'e']);
    expect(s.values()).toEqual(['a', 'e']);
  });

  it('retain also clears a stale anchor, so the next shift-click does not span a gone row', () => {
    s.click('b', ORDER, plain);
    s.retain(['d', 'e']);
    s.click('e', ['d', 'e'], shift);
    expect(s.values()).toEqual(['e']);
  });
});

describe('openMenu', () => {
  afterEach(() => closeMenu());

  it('renders one button per item, with separators between groups', () => {
    openMenu(10, 10, [
      { label: 'Place' },
      { separator: true, label: '' },
      { label: 'Delete', danger: true, accel: 'Del' },
    ]);
    const menu = document.querySelector('.ax-menu');
    expect(menu?.querySelectorAll('.ax-menu-item')).toHaveLength(2);
    expect(menu?.querySelectorAll('.ax-menu-sep')).toHaveLength(1);
    expect(menu?.querySelector('.ax-menu-item.danger')?.textContent).toContain('Delete');
    expect(menu?.querySelector('.ax-menu-accel')?.textContent).toBe('Del');
  });

  it('runs the item and closes on click', () => {
    let ran = 0;
    openMenu(0, 0, [{ label: 'Go', run: () => { ran++; } }]);
    document.querySelector<HTMLButtonElement>('.ax-menu-item')?.click();
    expect(ran).toBe(1);
    expect(document.querySelector('.ax-menu')).toBeNull();
  });

  it('does not run a disabled item', () => {
    let ran = 0;
    openMenu(0, 0, [{ label: 'Rename', disabled: true, run: () => { ran++; } }]);
    const btn = document.querySelector<HTMLButtonElement>('.ax-menu-item');
    expect(btn?.disabled).toBe(true);
    btn?.click();
    expect(ran).toBe(0);
  });

  it('opening a second menu replaces the first — never two on screen', () => {
    openMenu(0, 0, [{ label: 'One' }]);
    openMenu(0, 0, [{ label: 'Two' }]);
    expect(document.querySelectorAll('.ax-menu')).toHaveLength(1);
    expect(document.querySelector('.ax-menu')?.textContent).toContain('Two');
  });

  it('closeMenu is safe with nothing open', () => {
    expect(() => closeMenu()).not.toThrow();
  });
});
