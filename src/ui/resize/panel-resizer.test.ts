import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PanelResizer } from './panel-resizer';

// jsdom doesn't implement setPointerCapture/releasePointerCapture
HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();

// jsdom provides document/HTMLElement in vitest with jsdom environment
describe('PanelResizer', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    // Set a starting CSS var value
    root.style.setProperty('--test-width', '260px');
  });

  it('creates a handle element with correct class', () => {
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root });
    const h = r.getHandle();
    expect(h.classList.contains('panel-resize-handle')).toBe(true);
    expect(h.classList.contains('panel-resize-handle--x')).toBe(true);
  });

  it('y-axis handle has correct class', () => {
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'y', min: 100, max: 500, target: root });
    expect(r.getHandle().classList.contains('panel-resize-handle--y')).toBe(true);
  });

  it('handle has role=separator and tabindex', () => {
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root });
    const h = r.getHandle();
    expect(h.getAttribute('role')).toBe('separator');
    expect(h.getAttribute('tabindex')).toBe('0');
    expect(h.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('y-axis aria-orientation is horizontal', () => {
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'y', min: 100, max: 500, target: root });
    expect(r.getHandle().getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('calls onChange after drag', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    // Simulate pointerdown → pointermove → pointerup
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onChange).toHaveBeenCalled();
    h.remove();
  });

  it('clamps to min/max', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 300, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    // Simulate a drag that would exceed max
    root.style.setProperty('--test-width', '260px');
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 1000, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // onChange should have been called with max = 300
    const calls = onChange.mock.calls;
    const maxCall = calls[calls.length - 1]?.[0] ?? 0;
    expect(maxCall).toBeLessThanOrEqual(300);
    h.remove();
  });

  it('invert flag negates delta', () => {
    const onChange = vi.fn();
    // With invert: dragging RIGHT (positive delta) should shrink
    const r = new PanelResizer({
      cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, invert: true, onChange,
    });
    const h = r.getHandle();
    document.body.appendChild(h);

    root.style.setProperty('--test-width', '260px');
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, bubbles: true })); // +50px
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // With invert, size should be 260 - 50 = 210
    expect(onChange).toHaveBeenCalledWith(210);
    h.remove();
  });

  it('destroy removes the handle element', () => {
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root });
    const h = r.getHandle();
    document.body.appendChild(h);
    expect(document.body.contains(h)).toBe(true);
    r.destroy();
    expect(document.body.contains(h)).toBe(false);
  });

  it('keyboard ArrowRight nudges size by 8px', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    root.style.setProperty('--test-width', '260px');
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(268);
    h.remove();
  });
});
