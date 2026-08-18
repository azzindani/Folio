// Asset explorer — the built-in text editor.
//
// A brief does not have to arrive as a file. Type it here and it lands in
// assets/docs/ exactly as an upload would, ready for an MCP asset_read. Saving
// posts plain text to the upload route: the server ingests by filename, so the
// extension alone decides where it goes.
import { esc } from './asset-explorer-view';
import type { AssetIO, AssetRow, Scope } from './asset-explorer-io';

const TEXT_EXT = /\.(md|markdown|txt|csv|json|ya?ml)$/i;

export interface DocOptions {
  io: AssetIO;
  host: HTMLElement;
  folder: string;
  scope: Scope;
  /** Existing file to edit; omitted for a new one. */
  asset?: AssetRow;
  /** Leave the editor — the manager re-renders the explorer. */
  onClose: () => void;
  /** Saved successfully; the listing needs refreshing. */
  onSaved: () => void;
}

export function openDocEditor(opts: DocOptions): void {
  const { io, host, asset } = opts;
  const name = asset ? (asset.path.split('/').pop() ?? '') : '';
  const where = opts.scope === 'library'
    ? `shared library / ${opts.folder || 'docs'}`
    : opts.folder ? `assets/docs/${opts.folder}/` : 'assets/docs/';

  host.innerHTML = `
    <div class="ax ax-doc">
      <div class="ax-top">
        <input class="ax-fname" type="text" placeholder="brief.md" value="${esc(name)}" ${asset ? 'readonly' : ''} aria-label="File name">
        <button class="ax-btn ax-primary" data-act="dsave">Save</button>
        <button class="ax-btn" data-act="dcancel">Cancel</button>
      </div>
      <textarea class="ax-text" spellcheck="false" placeholder="# Brief&#10;&#10;Paste the copy, links and notes the design should be built from."></textarea>
      <div class="ax-status"><span>${esc(where)}</span><span class="ax-status-r">md · txt · csv · json · yaml</span></div>
    </div>`;

  const fname = host.querySelector<HTMLInputElement>('.ax-fname');
  const text = host.querySelector<HTMLTextAreaElement>('.ax-text');
  host.querySelector('[data-act="dcancel"]')?.addEventListener('click', () => opts.onClose());
  host.querySelector('[data-act="dsave"]')?.addEventListener('click', () => {
    void save(opts, fname?.value ?? '', text?.value ?? '');
  });

  if (asset && text) {
    text.value = 'Loading…';
    text.disabled = true;
    void io.readText(asset).then(async t => {
      text.disabled = false;
      if (t === null) {
        text.value = '';
        const { showToast } = await import('../../utils/toast');
        showToast('Could not read that file.', 'warning');
        return;
      }
      text.value = t;
    });
  } else {
    fname?.focus();
  }
}

async function save(opts: DocOptions, rawName: string, text: string): Promise<void> {
  const { showToast } = await import('../../utils/toast');
  const clean = rawName.trim();
  if (!TEXT_EXT.test(clean)) {
    showToast('Text files only: .md, .markdown, .txt, .csv, .json, .yaml', 'warning');
    return;
  }
  if (!text) {
    showToast('The file is empty — write something first.', 'warning');
    return;
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const res = await opts.io.upload(blob, clean, opts.folder, opts.scope);
  if (!res.ok) {
    showToast(res.error ?? 'Save failed', 'warning');
    return;
  }
  showToast(`Saved ${clean}`, 'success');
  opts.onSaved();
}
