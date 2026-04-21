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

  it('currentSize falls back to computedStyle when inline style not set', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    // Do NOT set inline style — use computed style path instead
    // Trigger a drag to call currentSize() without inline style
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 210, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // onChange should be called with a clamped value
    expect(onChange).toHaveBeenCalled();
    h.remove();
  });

  it('default onChange is called when not provided (covers line 38)', () => {
    // No onChange provided → default () => undefined is used; should not throw
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-width', '260px');
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 210, bubbles: true }));
    expect(root.style.getPropertyValue('--test-width')).toBeTruthy();
    h.remove();
  });

  it('currentSize returns 0 when neither inline nor computed style is set (covers lines 60-61)', () => {
    const root2 = document.createElement('div');
    // No CSS var set at all — inline will be empty → fallback to computed (also empty → 0)
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--nonexistent-var', axis: 'x', min: 0, max: 500, target: root2, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    // currentSize=0, delta=50, setSize(50) → clamped to min=0; onChange called
    expect(onChange).toHaveBeenCalled();
    h.remove();
  });

  it('pointerdown with non-zero button is a no-op', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-width', '200px');

    // Button 1 (middle click) should not start drag
    h.dispatchEvent(new PointerEvent('pointerdown', { button: 1, clientX: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    h.remove();
  });

  it('y-axis drag uses clientY delta', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-height', axis: 'y', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-height', '260px');

    h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 200, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointermove', { clientY: 240, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(300);
    h.remove();
  });

  it('pointermove when not dragging is a no-op', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-width', '200px');

    // Move without pointerdown first
    h.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    h.remove();
  });

  it('pointerup when not dragging is a no-op', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    // Pointerup without pointerdown
    expect(() => h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
    h.remove();
  });

  it('keyboard ArrowDown nudges y-axis size by 8px', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-height', axis: 'y', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-height', '260px');

    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(268);
    h.remove();
  });

  it('keyboard ArrowUp nudges y-axis size by -8px', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-height', axis: 'y', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-height', '260px');

    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(252);
    h.remove();
  });

  it('keyboard ArrowLeft nudges x-axis size by -8px', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);
    root.style.setProperty('--test-width', '260px');

    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(252);
    h.remove();
  });

  it('keyboard non-arrow key produces dir=0 and returns early', () => {
    const onChange = vi.fn();
    const r = new PanelResizer({ cssVar: '--test-width', axis: 'x', min: 100, max: 500, target: root, onChange });
    const h = r.getHandle();
    document.body.appendChild(h);

    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    h.remove();
  });
});
