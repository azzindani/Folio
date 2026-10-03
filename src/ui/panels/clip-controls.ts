// The inspector's controls for a clip: markup and one binder.
//
// Every control carries `data-clip="<key>"`; the section that drew it says what the key means. A slider is a
// gesture — its first `input` opens one undo step, `change` (release, or a key press) closes it — and every
// other control commits on `change`. The panel redraws only between gestures (clip-commit.ts).

import { beginGesture, endGesture, type ClipEnv } from './clip-commit';

export const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
export const fix = (v: number, dec: number): string => (Number.isFinite(v) ? v : 0).toFixed(dec);

const row = (label: string, inner: string): string =>
  `<div class="clip-row"><span class="prop-label">${esc(label)}</span>${inner}</div>`;

/** A drag: label, track, and the value read out beside it. */
export function range(key: string, label: string, v: number, min: number, max: number, step: number, dec = 2, unit = ''): string {
  return row(label, `<input type="range" class="clip-range" data-clip="${key}" data-dec="${dec}" data-unit="${esc(unit)}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}">`
    + `<span class="clip-val" data-val="${key}">${fix(v, dec)}${esc(unit)}</span>`);
}

/** A typed number, committed on change. */
export function num(key: string, label: string, v: number | '', min: number, max: number, step: number, unit = ''): string {
  return row(label, `<input type="number" class="clip-input" data-prop="clip.${key}" data-clip="${key}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}">`
    + (unit ? `<span class="clip-unit">${esc(unit)}</span>` : ''));
}

export function check(key: string, label: string, on: boolean): string {
  return row(label, `<input type="checkbox" class="prop-check" data-clip="${key}" ${on ? 'checked' : ''} aria-label="${esc(label)}">`);
}

export function pick(key: string, label: string, options: ReadonlyArray<readonly [string, string]>, value: string): string {
  return row(label, `<select class="clip-input" data-clip="${key}" aria-label="${esc(label)}">`
    + options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('') + '</select>');
}

/** A text colour: the swatch and its hex, committed on change. */
export function colour(key: string, label: string, hex: string): string {
  return row(label, `<input type="color" class="clip-swatch" data-clip="${key}" value="${esc(hex)}" aria-label="${esc(label)}">`
    + `<span class="clip-val">${esc(hex)}</span>`);
}

/** A button the section handles by key. */
export function button(act: string, label: string, title = '', disabled = false): string {
  return `<button type="button" class="btn btn-sm" data-clip-act="${act}" title="${esc(title)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

export function note(text: string): string { return `<div class="clip-note">${esc(text)}</div>`; }

/** A titled block, collapsible like every other section of the panel. */
export function block(title: string, body: string, collapsed = false): string {
  return `<div class="prop-section${collapsed ? ' collapsed' : ''}"><div class="prop-section-header">${esc(title)}</div><div class="prop-section-body">${body}</div></div>`;
}

export type ClipValue = number | string | boolean;
export type ClipSet = (key: string, value: ClipValue, live: boolean) => void;

/** Wire every `data-clip` control under `root` to `set`, and every `data-clip-act` button to `act`. */
export function bindClip(root: HTMLElement, env: ClipEnv, set: ClipSet, act?: (key: string) => void): void {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-clip]').forEach(el => {
    const key = el.dataset['clip'] ?? '';
    const read = (): ClipValue => {
      if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
      if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')) return parseFloat(el.value);
      return el.value;
    };
    if (el instanceof HTMLInputElement && el.type === 'range') {
      el.addEventListener('input', () => {
        beginGesture(env);
        const v = read() as number;
        set(key, v, true);
        const out = root.querySelector<HTMLElement>(`[data-val="${key}"]`);
        if (out) out.textContent = `${fix(v, Number(el.dataset['dec'] ?? 2))}${el.dataset['unit'] ?? ''}`;
      });
      el.addEventListener('change', () => endGesture(env));
      return;
    }
    el.addEventListener('change', () => {
      const v = read();
      if (typeof v === 'number' && Number.isNaN(v)) return;
      set(key, v, false);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-clip-act]').forEach(b => b.addEventListener('click', () => act?.(b.dataset['clipAct'] ?? '')));
}

/** One block of the inspector: its markup, and how it wires itself once the panel has drawn it. */
export interface Section { html: string; bind(root: HTMLElement): void }
