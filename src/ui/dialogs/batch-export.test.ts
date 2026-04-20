import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
