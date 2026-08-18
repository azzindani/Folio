// Asset explorer — the ask-something-first dialogs.
//
// These replace window.prompt/confirm. Not for looks: the native ones are
// modal to the whole BROWSER, cannot be styled, drop focus back somewhere
// arbitrary, are suppressed outright in some embedded webviews, and on a phone
// they are a system alert with no relation to the panel you are working in.
// A file manager that asks "what shall I call it?" through a browser alert
// reads as a web page pretending to be one.
//
// Both resolve rather than throw, so a caller can simply `if (!name) return`.

interface DialogSpec {
  title: string;
  /** Sub-label under the title — used to say WHERE something will land. */
  label?: string;
  body?: string;
  value?: string;
  placeholder?: string;
  confirm?: string;
  danger?: boolean;
  /** Ask for text. Off for a plain confirm. */
  input?: boolean;
  /** Preselect this much of the value — the stem of a filename, so typing
   *  replaces the name and keeps the extension. */
  selectTo?: number;
}

function open(spec: DialogSpec): Promise<string | null> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.className = 'ax-modal';
    host.innerHTML = `
      <div class="ax-modal-box" role="dialog" aria-modal="true" aria-label="${esc(spec.title)}">
        <div class="ax-modal-title">${esc(spec.title)}</div>
        ${spec.label ? `<div class="ax-modal-label">${esc(spec.label)}</div>` : ''}
        ${spec.body ? `<div class="ax-modal-body">${esc(spec.body)}</div>` : ''}
        ${spec.input ? `<input class="ax-modal-input" type="text" value="${esc(spec.value ?? '')}" placeholder="${esc(spec.placeholder ?? '')}" spellcheck="false">` : ''}
        <div class="ax-modal-actions">
          <button class="ax-btn" data-x="cancel">Cancel</button>
          <button class="ax-btn ${spec.danger ? 'ax-danger' : 'ax-primary'}" data-x="ok">${esc(spec.confirm ?? 'OK')}</button>
        </div>
      </div>`;
    document.body.appendChild(host);

    const input = host.querySelector<HTMLInputElement>('.ax-modal-input');
    let done = false;
    const close = (value: string | null): void => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      resolve(value);
    };
    const submit = (): void => {
      if (!spec.input) { close('ok'); return; }
      const v = input?.value.trim() ?? '';
      // An empty name is a cancel, not an error to scold someone about.
      close(v || null);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); close(null); }
      else if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); submit(); }
    };

    host.querySelector('[data-x="cancel"]')?.addEventListener('click', () => close(null));
    host.querySelector('[data-x="ok"]')?.addEventListener('click', submit);
    // Click-away cancels, but only on the backdrop — not on a stray click
    // inside the box while selecting text.
    host.addEventListener('pointerdown', ev => { if (ev.target === host) close(null); });
    document.addEventListener('keydown', onKey, true);

    if (input) {
      input.focus();
      if (spec.selectTo && spec.selectTo > 0) input.setSelectionRange(0, spec.selectTo);
      else input.select();
    } else {
      host.querySelector<HTMLElement>('[data-x="ok"]')?.focus();
    }
  });
}

/** Ask for a name. Resolves to the trimmed text, or null if cancelled/empty. */
export function promptDialog(spec: Omit<DialogSpec, 'input'>): Promise<string | null> {
  return open({ ...spec, input: true });
}

/** Ask yes/no. Resolves true only on confirm. */
export async function confirmDialog(spec: Omit<DialogSpec, 'input' | 'value'>): Promise<boolean> {
  return (await open({ ...spec, input: false })) !== null;
}

/**
 * Rename, with the extension preselected out of the way.
 *
 * Selecting only the stem is the detail that makes rename feel native: you type
 * the new name straight over the old one and ".png" survives, which is the
 * whole reason renaming in a file manager is not a text-editing exercise.
 */
export function renameDialog(current: string): Promise<string | null> {
  const dot = current.lastIndexOf('.');
  return promptDialog({
    title: 'Rename',
    value: current,
    confirm: 'Rename',
    ...(dot > 0 ? { selectTo: dot } : {}),
  });
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
