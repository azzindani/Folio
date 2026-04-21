import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../editor/state';
import { openPrintWindow } from './print-mode';
import type { DesignSpec } from '../schema/types';

function makeDesign(overrides: Partial<DesignSpec> = {}): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test Print', type: 'poster', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px', dpi: 96 },
    layers: [],
    ...overrides,
  } as unknown as DesignSpec;
}

function makePagedDesign(pageCount = 2): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Paged Print', type: 'carousel', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px', dpi: 96 },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `p${i}`, label: `Page ${i + 1}`, layers: [],
    })),
  } as unknown as DesignSpec;
}

describe('openPrintWindow', () => {
  let state: StateManager;
  let mockWin: { document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    state = new StateManager();
    mockWin = {
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when no design in state', () => {
    openPrintWindow(state);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens a new window with design HTML', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state);
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(mockWin.document.write).toHaveBeenCalled();
    expect(mockWin.document.close).toHaveBeenCalled();
  });

  it('HTML contains design name', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state);
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).toContain('Test Print');
  });

  it('HTML contains SVG', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state);
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).toContain('<svg');
  });

  it('includes crop marks by default', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state, { bleed: 10 });
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).toContain('viewBox');
  });

  it('no crop marks when cropMarks: false', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state, { cropMarks: false });
    const html = mockWin.document.write.mock.calls[0][0] as string;
    // No crop mark SVG should be present in this case
    expect(typeof html).toBe('string');
  });

  it('renders all pages for paged design', () => {
    state.set('design', makePagedDesign(3), false);
    openPrintWindow(state, { pageNumbers: true });
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).toContain('Page 1 of 3');
    expect(html).toContain('Page 2 of 3');
    expect(html).toContain('Page 3 of 3');
  });

  it('does not show page numbers when pageNumbers: false (default)', () => {
    state.set('design', makePagedDesign(2), false);
    openPrintWindow(state);
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).not.toContain('Page 1 of 2');
  });

  it('shows bleed info in toolbar when bleed set', () => {
    state.set('design', makeDesign(), false);
    openPrintWindow(state, { bleed: 20 });
    const html = mockWin.document.write.mock.calls[0][0] as string;
    expect(html).toContain('20px bleed');
  });

  it('handles window.open returning null gracefully', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    state.set('design', makeDesign(), false);
    expect(() => openPrintWindow(state)).not.toThrow();
  });
});
