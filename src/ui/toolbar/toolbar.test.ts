import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolbarManager } from './toolbar';
import { StateManager } from '../../editor/state';
import type { EditorApp } from '../../editor/app';
import type { DesignSpec } from '../../schema/types';

// ── Module mocks ─────────────────────────────────────────────

vi.mock('../../export/exporter', () => ({
  exportDesign: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../../ui/dialogs/batch-export', () => ({
  batchExportDialog: { open: vi.fn() },
}));

vi.mock('../../schema/template', () => ({
  exportAsTemplate: vi.fn().mockReturnValue({ slots: [] }),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function makeApp(): EditorApp {
  return {
    canvas: { fitToScreen: vi.fn() },
    applyTheme: vi.fn(),
    exportSVG: vi.fn(),
  } as unknown as EditorApp;
}

function makeDesign(name = 'My Poster'): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test-id', name, type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [],
  } as unknown as DesignSpec;
}

// ── Tests ────────────────────────────────────────────────────

describe('ToolbarManager', () => {
  let state: StateManager;
  let container: HTMLElement;
  let app: EditorApp;
  let toolbar: ToolbarManager;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
    app = makeApp();
    toolbar = new ToolbarManager(container, state, app);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  // ── Structure ────────────────────────────────────────────

  it('builds .toolbar-left inside container', () => {
    expect(container.querySelector('.toolbar-left')).not.toBeNull();
  });

  it('builds .toolbar-center inside container', () => {
    expect(container.querySelector('.toolbar-center')).not.toBeNull();
  });

  it('builds .toolbar-right inside container', () => {
    expect(container.querySelector('.toolbar-right')).not.toBeNull();
  });

  it('builds visual mode button', () => {
    expect(container.querySelector('.mode-btn[data-mode="visual"]')).not.toBeNull();
  });

  it('builds payload mode button', () => {
    expect(container.querySelector('.mode-btn[data-mode="payload"]')).not.toBeNull();
  });

  it('builds export button', () => {
    expect(container.querySelector('[data-action="export"]')).not.toBeNull();
  });

  it('builds undo button', () => {
    expect(container.querySelector('[data-action="undo"]')).not.toBeNull();
  });

  it('builds redo button', () => {
    expect(container.querySelector('[data-action="redo"]')).not.toBeNull();
  });

  it('visual mode button is active initially', () => {
    const btn = container.querySelector('.mode-btn[data-mode="visual"]') as HTMLElement;
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('payload mode button is not active initially', () => {
    const btn = container.querySelector('.mode-btn[data-mode="payload"]') as HTMLElement;
    expect(btn.classList.contains('active')).toBe(false);
  });

  // ── Theme select ─────────────────────────────────────────

  it('.toolbar-theme-select exists', () => {
    expect(container.querySelector('.toolbar-theme-select')).not.toBeNull();
  });

  it('.toolbar-theme-select has at least 3 options', () => {
    const sel = container.querySelector('.toolbar-theme-select') as HTMLSelectElement;
    expect(sel.options.length).toBeGreaterThanOrEqual(3);
  });

  // ── Export format items ──────────────────────────────────

  it('export menu has SVG item', () => {
    expect(container.querySelector('[data-format="svg"]')).not.toBeNull();
  });

  it('export menu has PNG item', () => {
    expect(container.querySelector('[data-format="png"]')).not.toBeNull();
  });

  it('export menu has PDF item', () => {
    expect(container.querySelector('[data-format="pdf"]')).not.toBeNull();
  });

  it('export menu has HTML item', () => {
    expect(container.querySelector('[data-format="html"]')).not.toBeNull();
  });

  it('export menu has batch item', () => {
    expect(container.querySelector('[data-format="batch"]')).not.toBeNull();
  });

  it('export menu has template item', () => {
    expect(container.querySelector('[data-format="template"]')).not.toBeNull();
  });

  // ── Mode button clicks ───────────────────────────────────

  it('clicking visual mode button calls state.set("mode", "visual", false)', () => {
    const spy = vi.spyOn(state, 'set');
    const btn = container.querySelector('.mode-btn[data-mode="visual"]') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalledWith('mode', 'visual', false);
  });

  it('clicking payload mode button calls state.set("mode", "payload", false)', () => {
    const spy = vi.spyOn(state, 'set');
    const btn = container.querySelector('.mode-btn[data-mode="payload"]') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalledWith('mode', 'payload', false);
  });

  // ── Undo / Redo ──────────────────────────────────────────

  it('clicking undo button calls state.undo()', () => {
    const spy = vi.spyOn(state, 'undo');
    const btn = container.querySelector('[data-action="undo"]') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('clicking redo button calls state.redo()', () => {
    const spy = vi.spyOn(state, 'redo');
    const btn = container.querySelector('[data-action="redo"]') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  // ── Export menu toggle ───────────────────────────────────

  it('export menu is hidden initially', () => {
    const menu = container.querySelector('.export-menu') as HTMLElement;
    expect(menu.style.display).toBe('none');
  });

  it('clicking export button shows .export-menu', () => {
    const exportBtn = container.querySelector('[data-action="export"]') as HTMLElement;
    exportBtn.click();
    const menu = container.querySelector('.export-menu') as HTMLElement;
    expect(menu.style.display).toBe('block');
  });

  it('clicking export button twice hides .export-menu again', () => {
    const exportBtn = container.querySelector('[data-action="export"]') as HTMLElement;
    exportBtn.click(); // open
    exportBtn.click(); // close
    const menu = container.querySelector('.export-menu') as HTMLElement;
    expect(menu.style.display).toBe('none');
  });

  it('clicking outside .export-group closes the menu', () => {
    // Open menu first
    const exportBtn = container.querySelector('[data-action="export"]') as HTMLElement;
    exportBtn.click();
    const menu = container.querySelector('.export-menu') as HTMLElement;
    expect(menu.style.display).toBe('block');

    // Simulate click outside export-group
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    outside.remove();

    expect(menu.style.display).toBe('none');
  });

  // ── onStateChange: mode ──────────────────────────────────

  it('state mode change → payload mode button becomes active', () => {
    state.set('mode', 'payload', false);
    const payloadBtn = container.querySelector('.mode-btn[data-mode="payload"]') as HTMLElement;
    const visualBtn = container.querySelector('.mode-btn[data-mode="visual"]') as HTMLElement;
    expect(payloadBtn.classList.contains('active')).toBe(true);
    expect(visualBtn.classList.contains('active')).toBe(false);
  });

  it('state mode change → visual mode button becomes active', () => {
    // Switch to payload first
    state.set('mode', 'payload', false);
    // Then back to visual
    state.set('mode', 'visual', false);
    const visualBtn = container.querySelector('.mode-btn[data-mode="visual"]') as HTMLElement;
    expect(visualBtn.classList.contains('active')).toBe(true);
  });

  it('only one mode button is active at a time', () => {
    state.set('mode', 'payload', false);
    const activeBtns = container.querySelectorAll('.mode-btn.active');
    expect(activeBtns.length).toBe(1);
  });

  // ── onStateChange: design name ───────────────────────────

  it('state design change → .toolbar-project-name shows design name', () => {
    const design = makeDesign('Cool Poster');
    state.set('design', design);
    const nameEl = container.querySelector('.toolbar-project-name');
    expect(nameEl?.textContent).toBe('Cool Poster');
  });

  it('.toolbar-project-name defaults to "Untitled" before design is set', () => {
    const nameEl = container.querySelector('.toolbar-project-name');
    expect(nameEl?.textContent).toBe('Untitled');
  });

  // ── Export format clicks ─────────────────────────────────

  it('clicking SVG format item does not throw when design is set', async () => {
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="svg"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();
  });

  it('clicking PNG format item does not throw when design is set', async () => {
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="png"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();
  });

  it('clicking PDF format item does not throw when design is set', async () => {
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="pdf"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();
  });

  it('clicking HTML format item does not throw when design is set', async () => {
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="html"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();
  });

  it('clicking template format triggers template export without crash', () => {
    // Mock URL.createObjectURL to avoid jsdom errors
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    state.set('design', makeDesign('My Design'));
    const item = container.querySelector('[data-format="template"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('clicking template format with no design does not throw', () => {
    // state.get().design is null by default — showToast('No design open', 'error') is called internally
    const item = container.querySelector('[data-format="template"]') as HTMLElement;
    expect(() => item.click()).not.toThrow();
  });

  it('export format click closes the export menu', () => {
    // Open menu
    const exportBtn = container.querySelector('[data-action="export"]') as HTMLElement;
    exportBtn.click();
    const menu = container.querySelector('.export-menu') as HTMLElement;
    expect(menu.style.display).toBe('block');

    // Click an export item
    state.set('design', makeDesign());
    const svgItem = container.querySelector('[data-format="svg"]') as HTMLElement;
    svgItem.click();
    expect(menu.style.display).toBe('none');
  });

  // ── Theme select ─────────────────────────────────────────

  it('changing theme select calls app.applyTheme', () => {
    const sel = container.querySelector('.toolbar-theme-select') as HTMLSelectElement;
    sel.value = 'light-clean';
    sel.dispatchEvent(new Event('change'));
    expect(app.applyTheme).toHaveBeenCalledWith('light-clean');
  });

  it('clicking batch format opens batch export dialog when design is set', async () => {
    const { batchExportDialog } = await import('../../ui/dialogs/batch-export');
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="batch"]') as HTMLElement;
    item.click();
    expect(batchExportDialog.open).toHaveBeenCalled();
  });

  it('clicking batch format does nothing when no design', async () => {
    const { batchExportDialog } = await import('../../ui/dialogs/batch-export');
    vi.mocked(batchExportDialog.open).mockClear();
    const item = container.querySelector('[data-format="batch"]') as HTMLElement;
    item.click();
    expect(batchExportDialog.open).not.toHaveBeenCalled();
  });

  it('triggerExport shows error toast when exportDesign throws', async () => {
    const { exportDesign } = await import('../../export/exporter');
    const { showToast } = await import('../../utils/toast');
    vi.mocked(exportDesign).mockRejectedValueOnce(new Error('Export crashed'));
    state.set('design', makeDesign());
    const item = container.querySelector('[data-format="svg"]') as HTMLElement;
    item.click();
    await new Promise(r => setTimeout(r, 10));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Export crashed'), 'error');
  });
});
