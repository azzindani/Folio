import { describe, it, expect, vi, afterEach } from 'vitest';
import { showToast } from './toast';

describe('showToast', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllTimers();
  });

  it('appends a .toast element to document.body', () => {
    vi.useFakeTimers();
    showToast('Hello!');
    const toast = document.body.querySelector('.toast');
    expect(toast).toBeTruthy();
    expect(toast?.textContent).toBe('Hello!');
    vi.useRealTimers();
  });

  it('sets border-left style for different levels', () => {
    vi.useFakeTimers();
    showToast('Error!', 'error');
    const toast = document.body.querySelector('.toast') as HTMLElement;
    expect(toast.style.borderLeft).toContain('var(--color-error)');
    vi.useRealTimers();
  });

  it('sets success border color', () => {
    vi.useFakeTimers();
    showToast('Done', 'success');
    const toast = document.body.querySelector('.toast') as HTMLElement;
    expect(toast.style.borderLeft).toContain('var(--color-success)');
    vi.useRealTimers();
  });

  it('sets warning border color', () => {
    vi.useFakeTimers();
    showToast('Watch out', 'warning');
    const toast = document.body.querySelector('.toast') as HTMLElement;
    expect(toast.style.borderLeft).toContain('var(--color-warning)');
    vi.useRealTimers();
  });

  it('default level is info', () => {
    vi.useFakeTimers();
    showToast('Info msg');
    const toast = document.body.querySelector('.toast') as HTMLElement;
    expect(toast.style.borderLeft).toContain('var(--color-border)');
    vi.useRealTimers();
  });

  it('removes toast on click', () => {
    vi.useFakeTimers();
    showToast('Click me');
    const toast = document.body.querySelector('.toast') as HTMLElement;
    toast.click();
    // After opacity transition (200ms), element should be removed
    vi.advanceTimersByTime(300);
    expect(document.body.querySelector('.toast')).toBeNull();
    vi.useRealTimers();
  });

  it('removes toast automatically after duration elapses', () => {
    vi.useFakeTimers();
    showToast('Auto-remove', 'info');
    // info duration = 3000ms, then remove after 200ms transition
    vi.advanceTimersByTime(3500);
    expect(document.body.querySelector('.toast')).toBeNull();
    vi.useRealTimers();
  });
});
