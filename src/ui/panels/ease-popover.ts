/**
 * What a click on a keyframe opens: every named easing in a select, and under
 * it the curve with two handles to shape one of your own (curve-editor.ts).
 *
 * Picking a name writes it and closes, as the picker always did. Letting go of
 * a handle writes the cubic-bezier and stays open for the other handle, so the
 * popover lives on the panel, not the track row the write redraws. Escape, or a
 * press anywhere outside it, closes it.
 */

import { EASING_NAMES } from '../../animation/easing';
import { bindCurveEditor, type CurveBox } from './curve-editor';

const BOX: CurveBox = { w: 168, h: 140, pad: 14 };

export interface EasePopoverOptions {
  /** The keyframe's diamond: the popover opens under it. */
  anchor: HTMLElement;
  /** What the popover is placed in — kept when the timeline redraws. */
  host: HTMLElement;
  /** The keyframe's easing now ('' = the track's default). */
  current: string;
  /** Write an easing to the keyframe. */
  commit: (easing: string) => void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/** Open the popover (closing any other). */
export function openEasePopover(o: EasePopoverOptions): void {
  o.host.querySelectorAll('.tl-ease-pop').forEach(n => n.remove());
  if (getComputedStyle(o.host).position === 'static') o.host.style.position = 'relative';
  const a = o.anchor.getBoundingClientRect(), h = o.host.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'tl-ease-pop';
  pop.style.cssText = 'position:absolute;z-index:20;display:flex;flex-direction:column;gap:4px;'
    + `left:${Math.max(0, a.left - h.left + o.host.scrollLeft)}px;top:${a.bottom - h.top + o.host.scrollTop + 2}px`;

  const sel = document.createElement('select');
  sel.className = 'tl-ease-picker';
  sel.style.cssText = 'font-size:11px;background:var(--color-bg);color:var(--color-text);border:1px solid var(--color-border);border-radius:3px';
  const options = (current: string): string => {
    const names = ['', ...EASING_NAMES];
    // A shaped curve is not one of the names: list it, so the select says what the keyframe has.
    if (current && !names.includes(current)) names.push(current);
    return names.map(n => `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n || '(track default)')}</option>`).join('');
  };
  sel.innerHTML = options(o.current);
  const curve = document.createElement('div');
  curve.className = 'tl-ease-curve';
  pop.append(sel, curve);

  let closed = false;
  let pressedInside = false;
  const onOutside = (e: PointerEvent): void => { if (!pop.contains(e.target as Node)) close(); };
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onOutside, true);
    pop.remove();
  };
  // Show the curve for whatever is highlighted; a handle dragged writes its own curve and keeps the popover.
  const draw = (name: string): void => bindCurveEditor(curve, name, BOX, shaped => {
    sel.innerHTML = options(shaped);
    o.commit(shaped);
  });
  draw(o.current);
  sel.addEventListener('input', () => draw(sel.value));
  sel.addEventListener('keyup', () => draw(sel.value));
  // WRITE FIRST, tear down second: blur can fire before change in a scripted selection.
  sel.addEventListener('change', () => { if (closed) return; o.commit(sel.value); close(); });
  // Leaving the select for the curve is not a cancel; leaving the popover is.
  pop.addEventListener('pointerdown', () => { pressedInside = true; });
  sel.addEventListener('blur', () => { if (!pressedInside) close(); pressedInside = false; });
  pop.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', onOutside, true);
  o.host.appendChild(pop);
  sel.focus();
}
