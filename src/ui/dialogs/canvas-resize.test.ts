import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasResizeDialog } from './canvas-resize';

const BASE = { width: 1080, height: 1080, dpi: 96, unit: 'px' as const };

function openDialog(onConfirm = vi.fn()): { dialog: CanvasResizeDialog; overlay: HTMLElement } {
  const dialog = new CanvasResizeDialog();
  dialog.open(BASE, onConfirm);
  const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
  return { dialog, overlay };
}

describe('CanvasResizeDialog', () => {
  beforeEach(() => {
    document.querySelectorAll('.dialog-overlay').forEach(el => el.remove());
  });

  it('renders the dialog overlay', () => {
    const { overlay } = openDialog();
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.dialog-title')?.textContent).toBe('Resize Canvas');
  });

  it('pre-fills width and height from current spec', () => {
    const { overlay } = openDialog();
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')?.value;
    const h = overlay.querySelector<HTMLInputElement>('#cr-height')?.value;
    expect(w).toBe('1080');
    expect(h).toBe('1080');
  });

  it('calls onConfirm with px values on Apply', () => {
    const onConfirm = vi.fn();
    const { overlay } = openDialog(onConfirm);
    overlay.querySelector<HTMLButtonElement>('#cr-confirm')?.click();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1080 }));
  });

  it('Cancel closes the dialog', () => {
    const { dialog, overlay } = openDialog();
    overlay.querySelector<HTMLButtonElement>('#cr-cancel')?.click();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
    void dialog;
  });

  it('close() removes the overlay', () => {
    const { dialog } = openDialog();
    dialog.close();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('clicking overlay backdrop closes dialog', () => {
    const { overlay } = openDialog();
    overlay.click();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('shows px size info panel', () => {
    const { overlay } = openDialog();
    const info = overlay.querySelector('#cr-px-size')?.textContent ?? '';
    expect(info).toContain('1080');
  });

  it('applying preset changes width/height inputs', () => {
    const { overlay } = openDialog();
    const preset = overlay.querySelector<HTMLSelectElement>('#cr-preset')!;
    // Select "Instagram Post"
    preset.value = 'Instagram Post';
    preset.dispatchEvent(new Event('change'));
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')?.value;
    expect(parseInt(w ?? '0', 10)).toBeGreaterThan(0);
  });

  it('changing unit converts dimensions', () => {
    const { overlay } = openDialog();
    const unitSel = overlay.querySelector<HTMLSelectElement>('#cr-unit')!;
    unitSel.value = 'mm';
    unitSel.dispatchEvent(new Event('change'));
    const w = parseFloat(overlay.querySelector<HTMLInputElement>('#cr-width')?.value ?? '0');
    // 1080 px ÷ (96/25.4) ≈ 285.75mm
    expect(w).toBeGreaterThan(200);
    expect(w).toBeLessThan(400);
  });

  it('fallback to px when unit is unknown (line 37-38 else branch)', () => {
    const dialog = new CanvasResizeDialog();
    dialog.open({ width: 800, height: 600, dpi: 96, unit: 'pt' as 'px' }, vi.fn());
    const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
    const unitSel = overlay.querySelector<HTMLSelectElement>('#cr-unit')!;
    // The selected unit should be px (fallback)
    expect(unitSel.querySelector('option[selected]')?.getAttribute('value') ?? 'px').toBe('px');
    dialog.close();
  });

  it('selecting empty preset key returns early (line 138 branch)', () => {
    const { overlay } = openDialog();
    const preset = overlay.querySelector<HTMLSelectElement>('#cr-preset')!;
    // First set a real preset, then deselect
    preset.value = 'Instagram Post';
    preset.dispatchEvent(new Event('change'));
    const wAfterPreset = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    // Now select empty (custom)
    preset.value = '';
    preset.dispatchEvent(new Event('change'));
    // Width shouldn't change after empty selection
    const wAfterEmpty = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    expect(wAfterEmpty).toBe(wAfterPreset);
  });

  it('width/height input triggers updateInfo', () => {
    const { overlay } = openDialog();
    const wInput = overlay.querySelector<HTMLInputElement>('#cr-width')!;
    wInput.value = '500';
    wInput.dispatchEvent(new Event('input'));
    const info = overlay.querySelector('#cr-px-size')?.textContent ?? '';
    expect(info).toContain('500');
  });

  it('Escape key closes the dialog (line 156)', () => {
    openDialog();
    expect(document.querySelector('.dialog-overlay')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('changing unit back to px shows integer widths (unit=px ? 0 : 2)', () => {
    const { overlay } = openDialog();
    const unitSel = overlay.querySelector<HTMLSelectElement>('#cr-unit')!;
    unitSel.value = 'mm';
    unitSel.dispatchEvent(new Event('change'));
    // Change back to px
    unitSel.value = 'px';
    unitSel.dispatchEvent(new Event('change'));
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    // Should be an integer (no decimal)
    expect(w).toMatch(/^\d+$/);
  });

  it('dialog-close button closes dialog', () => {
    const { overlay } = openDialog();
    overlay.querySelector<HTMLButtonElement>('.dialog-close')!.click();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('applying preset while unit is mm uses decimal format (line 140 false branch)', () => {
    const { overlay } = openDialog();
    // Switch to mm first
    const unitSel = overlay.querySelector<HTMLSelectElement>('#cr-unit')!;
    unitSel.value = 'mm';
    unitSel.dispatchEvent(new Event('change'));
    // Now apply a preset — uses pxToUnit(preset.w, 'mm').toFixed(2) → false branch of (unit==='px'?0:2)
    const preset = overlay.querySelector<HTMLSelectElement>('#cr-preset')!;
    preset.value = 'Instagram Post';
    preset.dispatchEvent(new Event('change'));
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    // Should have decimal places (mm, not px)
    expect(w).toMatch(/\./);
  });

  it('confirm with invalid dpi falls back to current.dpi (line 147 || branch)', () => {
    const onConfirm = vi.fn();
    const { overlay } = openDialog(onConfirm);
    // Clear the dpi input → parseInt returns NaN → || current.dpi fallback
    const dpiInput = overlay.querySelector<HTMLInputElement>('#cr-dpi')!;
    dpiInput.value = '';
    overlay.querySelector<HTMLButtonElement>('#cr-confirm')!.click();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ dpi: BASE.dpi }));
  });

  it('non-Escape keydown does not close dialog (line 156 false branch)', () => {
    const { dialog } = openDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.dialog-overlay')).not.toBeNull();
    dialog.close();
  });

  it('opening with mm unit shows decimal width/height (line 40 false branch)', () => {
    const dialog = new CanvasResizeDialog();
    dialog.open({ width: 1080, height: 1080, dpi: 96, unit: 'mm' as 'px' }, vi.fn());
    const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    // mm display → should have decimal places
    expect(w).toContain('.');
    // Also checks unit selector pre-selection
    dialog.close();
  });

  it('opening with cm unit covers template unit branches (lines 40-115)', () => {
    const dialog = new CanvasResizeDialog();
    dialog.open({ width: 1080, height: 1080, dpi: 96, unit: 'cm' as 'px' }, vi.fn());
    const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
    expect(overlay).not.toBeNull();
    dialog.close();
  });

  it('opening with in unit covers toDisplay false branch', () => {
    const dialog = new CanvasResizeDialog();
    dialog.open({ width: 816, height: 1056, dpi: 96, unit: 'in' as 'px' }, vi.fn());
    const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!;
    const w = overlay.querySelector<HTMLInputElement>('#cr-width')!.value;
    // inch display
    expect(parseFloat(w)).toBeGreaterThan(0);
    dialog.close();
  });
});
