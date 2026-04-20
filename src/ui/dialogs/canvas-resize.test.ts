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
});
