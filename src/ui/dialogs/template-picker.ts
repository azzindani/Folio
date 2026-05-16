/**
 * TemplatePickerDialog — modal that lists built-in templates as cards.
 *
 * On select, injects defaults via injectIntoTemplate() and hands the
 * resulting DesignSpec to onPick. The caller is responsible for loading
 * it into the editor.
 */

import { loadBuiltinTemplates, type BuiltinTemplate } from '../../templates/builtin-loader';
import { injectIntoTemplate } from '../../schema/template';
import type { DesignSpec } from '../../schema/types';

type PickCallback = (design: DesignSpec, fromTemplate: BuiltinTemplate) => void;

export class TemplatePickerDialog {
  private overlay: HTMLElement | null = null;

  open(onPick: PickCallback): void {
    this.close();
    const templates = loadBuiltinTemplates();

    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay';
    this.overlay.innerHTML = `
      <div class="dialog tmpl-dialog" role="dialog" aria-label="New from template">
        <div class="dialog-header">
          <h3 class="dialog-title">New from template</h3>
          <button class="dialog-close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="dialog-body">
          <div class="tmpl-grid">
            ${templates.map((t, i) => this.renderCard(t, i)).join('')}
          </div>
          ${templates.length === 0 ? '<p class="tmpl-empty">No templates bundled yet.</p>' : ''}
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.action === 'close' || target.classList.contains('dialog-overlay')) {
        this.close();
        return;
      }
      const card = target.closest<HTMLElement>('.tmpl-card');
      if (card) {
        const idx = parseInt(card.dataset.idx ?? '-1', 10);
        const t = templates[idx];
        if (!t) return;
        const design = injectIntoTemplate(t.spec, {});
        // Stamp as a fresh untitled design so the user doesn't accidentally
        // overwrite the template file.
        design.meta = {
          ...design.meta,
          id: `from-${t.id}-${Date.now().toString(36)}`,
          name: `Untitled (${t.spec.meta.name})`,
        };
        onPick(design, t);
        this.close();
      }
    });

    document.addEventListener('keydown', this.onKey);
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    document.removeEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private renderCard(t: BuiltinTemplate, idx: number): string {
    const { meta, document: doc } = t.spec;
    const metaTags = (meta as { tags?: string[] }).tags ?? [];
    const tags = metaTags.slice(0, 4).map((tag: string) =>
      `<span class="tmpl-tag">${escapeHTML(tag)}</span>`,
    ).join('');
    const pageInfo = t.spec.pages ? ` · ${t.spec.pages.length} pages` : '';
    const slotCount = t.spec.slots.length;
    return `
      <button class="tmpl-card" data-idx="${idx}" type="button">
        <div class="tmpl-thumb" data-aspect="${doc.width}x${doc.height}">
          <span class="tmpl-thumb-dim">${doc.width} × ${doc.height}</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${escapeHTML(meta.name)}</div>
          <div class="tmpl-sub">${escapeHTML(meta.type)}${pageInfo} · ${slotCount} editable</div>
          <div class="tmpl-tags">${tags}</div>
        </div>
      </button>
    `;
  }
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const templatePickerDialog = new TemplatePickerDialog();
