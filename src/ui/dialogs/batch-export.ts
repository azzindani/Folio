import type { DesignSpec } from '../../schema/types';
import { exportToSVG, exportToPNG, exportToHTML } from '../../export/exporter';
import { showToast } from '../../utils/toast';

export type BatchFormat = 'svg' | 'png1x' | 'png2x' | 'html';

export interface BatchExportOptions {
  format: BatchFormat;
  pages: 'all' | 'current' | number[];
}

export interface BatchResult {
  page: number;
  filename: string;
  ok: boolean;
  error?: string;
}

export class BatchExportDialog {
  private overlay: HTMLElement | null = null;
  private currentPageIndex = 0;

  open(spec: DesignSpec, currentPageIndex: number): void {
    this.close();
    this.currentPageIndex = currentPageIndex;

    const pageCount = spec.pages?.length ?? 1;
    const isMultiPage = pageCount > 1;

    this.overlay = document.createElement('div');
    this.overlay.className = 'dialog-overlay';
    this.overlay.innerHTML = `
      <div class="dialog-box" style="min-width:380px" role="dialog" aria-modal="true">
        <div class="dialog-header">
          <span class="dialog-title">Batch Export</span>
          <button class="dialog-close" id="be-close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-row">
            <label class="dialog-label" for="be-format">Format</label>
            <select class="dialog-input" id="be-format">
              <option value="png2x">PNG ×2 (recommended)</option>
              <option value="png1x">PNG ×1</option>
              <option value="svg">SVG (vector)</option>
              <option value="html">HTML (self-contained)</option>
            </select>
          </div>
          ${isMultiPage ? `
          <div class="dialog-row">
            <label class="dialog-label" for="be-pages">Pages</label>
            <select class="dialog-input" id="be-pages">
              <option value="all">All pages (${pageCount})</option>
              <option value="current">Current page only</option>
            </select>
          </div>` : ''}
          <div class="dialog-row">
            <label class="dialog-label" for="be-prefix">Filename prefix</label>
            <input class="dialog-input" id="be-prefix" type="text"
              value="${spec.meta.name.replace(/\s+/g, '-').toLowerCase()}" />
          </div>
          <div id="be-preview" style="font-size:11px;color:var(--color-text-muted);padding:6px 0">
            Preview: <span id="be-preview-text"></span>
          </div>
          <div id="be-progress" style="display:none;padding:8px 0">
            <div class="batch-progress-bar" style="height:4px;background:var(--color-surface-2);border-radius:2px">
              <div id="be-bar" style="height:100%;width:0;background:var(--color-primary);border-radius:2px;transition:width .2s"></div>
            </div>
            <div id="be-status" style="font-size:11px;color:var(--color-text-muted);margin-top:4px"></div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-sm" id="be-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="be-run">Export</button>
        </div>
      </div>`;

    document.body.appendChild(this.overlay);

    const updatePreview = () => {
      const fmt = (this.overlay!.querySelector<HTMLSelectElement>('#be-format')?.value ?? 'png2x') as BatchFormat;
      const prefix = this.overlay!.querySelector<HTMLInputElement>('#be-prefix')?.value ?? 'design';
      const pagesVal = this.overlay!.querySelector<HTMLSelectElement>('#be-pages')?.value ?? 'all';
      const ext = fmt === 'svg' ? 'svg' : fmt === 'html' ? 'html' : 'png';
      const count = isMultiPage && pagesVal === 'all' ? pageCount : 1;
      const preview = count === 1
        ? `${prefix}.${ext}`
        : `${prefix}-page-1.${ext} … ${prefix}-page-${count}.${ext}`;
      const el = this.overlay!.querySelector('#be-preview-text');
      if (el) el.textContent = preview;
    };

    this.overlay.querySelector('#be-format')?.addEventListener('change', updatePreview);
    this.overlay.querySelector('#be-pages')?.addEventListener('change', updatePreview);
    this.overlay.querySelector('#be-prefix')?.addEventListener('input', updatePreview);
    updatePreview();

    this.overlay.querySelector('#be-cancel')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#be-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    document.addEventListener('keydown', this.onKey, { once: true });

    this.overlay.querySelector('#be-run')?.addEventListener('click', () => {
      void this.runExport(spec, isMultiPage, pageCount);
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private async runExport(spec: DesignSpec, isMultiPage: boolean, pageCount: number): Promise<void> {
    const overlay = this.overlay;
    if (!overlay) return;

    const fmt = (overlay.querySelector<HTMLSelectElement>('#be-format')?.value ?? 'png2x') as BatchFormat;
    const prefix = overlay.querySelector<HTMLInputElement>('#be-prefix')?.value ?? 'design';
    const pagesVal = overlay.querySelector<HTMLSelectElement>('#be-pages')?.value ?? 'all';

    const pages: number[] = isMultiPage && pagesVal === 'all'
      ? Array.from({ length: pageCount }, (_, i) => i)
      : [this.currentPageIndex];

    const progressEl = overlay.querySelector<HTMLElement>('#be-progress');
    const barEl = overlay.querySelector<HTMLElement>('#be-bar');
    const statusEl = overlay.querySelector<HTMLElement>('#be-status');
    const runBtn = overlay.querySelector<HTMLButtonElement>('#be-run');
    if (progressEl) progressEl.style.display = 'block';
    if (runBtn) runBtn.disabled = true;

    const ext = fmt === 'svg' ? 'svg' : fmt === 'html' ? 'html' : 'png';
    const scale = fmt === 'png2x' ? 2 : 1;
    const results: BatchResult[] = [];

    for (let i = 0; i < pages.length; i++) {
      const pi = pages[i];
      const suffix = pages.length > 1 ? `-page-${pi + 1}` : '';
      const filename = `${prefix}${suffix}.${ext}`;

      if (statusEl) statusEl.textContent = `Exporting ${filename}…`;
      if (barEl) barEl.style.width = `${Math.round(((i) / pages.length) * 100)}%`;

      try {
        const opts = { format: 'png' as const, pageIndex: pi, scale };
        let blob: Blob | string;

        if (fmt === 'svg') {
          blob = exportToSVG(spec, { format: 'svg', pageIndex: pi });
          triggerTextDownload(blob, filename, 'image/svg+xml');
        } else if (fmt === 'html') {
          blob = exportToHTML(spec, { format: 'html', pageIndex: pi });
          triggerTextDownload(blob, filename, 'text/html');
        } else {
          blob = await exportToPNG(spec, opts);
          triggerBlobDownload(blob, filename);
        }
        results.push({ page: pi, filename, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        results.push({ page: pi, filename, ok: false, error });
      }

      await yieldToMicrotasks();
    }

    if (barEl) barEl.style.width = '100%';
    const failures = results.filter(r => !r.ok);
    if (statusEl) statusEl.textContent = failures.length
      ? `Done with ${failures.length} error(s)`
      : `Done — ${results.length} file(s) exported`;

    if (failures.length === 0) {
      showToast(`Exported ${results.length} file(s)`, 'success');
      setTimeout(() => this.close(), 1200);
    } else {
      showToast(`${failures.length} export(s) failed`, 'error');
      if (runBtn) runBtn.disabled = false;
    }
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey);
    this.overlay?.remove();
    this.overlay = null;
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function triggerTextDownload(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  triggerBlobDownload(blob, filename);
}

function yieldToMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export const batchExportDialog = new BatchExportDialog();
