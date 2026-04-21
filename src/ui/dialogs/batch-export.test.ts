import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchExportDialog } from './batch-export';
import type { DesignSpec } from '../../schema/types';

// Stub exports so tests don't hit real canvas/PDF
vi.mock('../../export/exporter', () => ({
  exportToSVG: vi.fn(() => '<svg></svg>'),
  exportToPNG: vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))),
  exportToHTML: vi.fn(() => '<!DOCTYPE html>'),
}));

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

function makeSpec(pageCount = 1): DesignSpec {
  const base = {
    _protocol: 'design/v1' as const,
    meta: { id: 't', name: 'My Design', type: 'poster' as const, created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px' as const, dpi: 96 },
  };
  if (pageCount <= 1) return { ...base, layers: [] } as unknown as DesignSpec;
  return {
    ...base,
    pages: Array.from({ length: pageCount }, (_, i) => ({ id: `p${i}`, name: `Page ${i + 1}`, layers: [] })),
  } as unknown as DesignSpec;
}

describe('BatchExportDialog', () => {
  beforeEach(() => {
    document.querySelectorAll('.dialog-overlay').forEach(el => el.remove());
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn().mockReturnValue('blob:test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens and renders an overlay', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const overlay = document.querySelector('.dialog-overlay');
    expect(overlay).not.toBeNull();
    dlg.close();
  });

  it('shows "Batch Export" in the title', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const title = document.querySelector('.dialog-title');
    expect(title?.textContent).toContain('Batch Export');
    dlg.close();
  });

  it('shows page selector for multi-page spec', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(3), 0);
    const pagesEl = document.querySelector('#be-pages');
    expect(pagesEl).not.toBeNull();
    dlg.close();
  });

  it('hides page selector for single-page spec', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(1), 0);
    expect(document.querySelector('#be-pages')).toBeNull();
    dlg.close();
  });

  it('pre-fills prefix from design name', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const prefix = document.querySelector<HTMLInputElement>('#be-prefix');
    expect(prefix?.value).toBe('my-design');
    dlg.close();
  });

  it('Cancel button closes dialog', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    (document.querySelector<HTMLButtonElement>('#be-cancel'))?.click();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('close() removes overlay', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    dlg.close();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('Escape key closes dialog', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('format selector has expected options', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const opts = [...document.querySelectorAll('#be-format option')].map(o => (o as HTMLOptionElement).value);
    expect(opts).toContain('png2x');
    expect(opts).toContain('svg');
    expect(opts).toContain('html');
    dlg.close();
  });

  it('X button closes dialog', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    (document.querySelector<HTMLButtonElement>('#be-close'))?.click();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('clicking overlay background closes dialog', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // overlay.target === overlay → closes
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('preview updates on format change', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'svg';
    formatSel.dispatchEvent(new Event('change'));
    const preview = document.querySelector('#be-preview-text')?.textContent ?? '';
    expect(preview).toContain('.svg');
    dlg.close();
  });

  it('preview shows range for multi-page all pages', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(3), 0);
    const pagesSel = document.querySelector<HTMLSelectElement>('#be-pages')!;
    pagesSel.value = 'all';
    pagesSel.dispatchEvent(new Event('change'));
    const preview = document.querySelector('#be-preview-text')?.textContent ?? '';
    expect(preview).toContain('…');
    dlg.close();
  });

  it('prefix input updates preview', () => {
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const prefix = document.querySelector<HTMLInputElement>('#be-prefix')!;
    prefix.value = 'custom-name';
    prefix.dispatchEvent(new Event('input'));
    const preview = document.querySelector('#be-preview-text')?.textContent ?? '';
    expect(preview).toContain('custom-name');
    dlg.close();
  });

  it('Export button runs SVG export', async () => {
    const { exportToSVG } = await import('../../export/exporter');
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    // Select SVG format
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'svg';
    formatSel.dispatchEvent(new Event('change'));
    const runBtn = document.querySelector<HTMLButtonElement>('#be-run')!;
    runBtn.click();
    // Wait for async export to complete
    await new Promise(r => setTimeout(r, 50));
    expect(exportToSVG).toHaveBeenCalled();
    dlg.close();
  });

  it('Export button runs HTML export', async () => {
    const { exportToHTML } = await import('../../export/exporter');
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'html';
    formatSel.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('#be-run')!.click();
    await new Promise(r => setTimeout(r, 50));
    expect(exportToHTML).toHaveBeenCalled();
    dlg.close();
  });

  it('Export button runs PNG export (png2x)', async () => {
    const { exportToPNG } = await import('../../export/exporter');
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    // Default format is png2x
    document.querySelector<HTMLButtonElement>('#be-run')!.click();
    await new Promise(r => setTimeout(r, 50));
    expect(exportToPNG).toHaveBeenCalled();
    dlg.close();
  });

  it('Export button runs PNG1x export', async () => {
    const { exportToPNG } = await import('../../export/exporter');
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'png1x';
    formatSel.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('#be-run')!.click();
    await new Promise(r => setTimeout(r, 50));
    expect(exportToPNG).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scale: 1 }));
    dlg.close();
  });

  it('multi-page: exports all pages for SVG format', async () => {
    const { exportToSVG } = await import('../../export/exporter');
    vi.mocked(exportToSVG).mockClear();
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(3), 0);
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'svg';
    formatSel.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('#be-run')!.click();
    await new Promise(r => setTimeout(r, 100));
    expect(exportToSVG).toHaveBeenCalledTimes(3);
    dlg.close();
  });

  it('failed export shows error toast', async () => {
    const { showToast } = await import('../../utils/toast');
    const { exportToSVG } = await import('../../export/exporter');
    vi.mocked(exportToSVG).mockImplementationOnce(() => { throw new Error('export failed'); });
    const dlg = new BatchExportDialog();
    dlg.open(makeSpec(), 0);
    const formatSel = document.querySelector<HTMLSelectElement>('#be-format')!;
    formatSel.value = 'svg';
    formatSel.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('#be-run')!.click();
    await new Promise(r => setTimeout(r, 50));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error');
    dlg.close();
  });
});
