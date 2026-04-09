/**
 * Lightweight toast notification — shows a brief dismissible message.
 * Uses the .toast CSS class defined in main.css.
 */

export type ToastLevel = 'info' | 'success' | 'error' | 'warning';

const DURATION: Record<ToastLevel, number> = {
  info:    3000,
  success: 3000,
  error:   6000,
  warning: 4000,
};

const BORDER_COLOR: Record<ToastLevel, string> = {
  info:    'var(--color-border)',
  success: 'var(--color-success)',
  error:   'var(--color-error)',
  warning: 'var(--color-warning)',
};

export function showToast(message: string, level: ToastLevel = 'info'): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  el.style.borderLeft = `3px solid ${BORDER_COLOR[level]}`;

  document.body.appendChild(el);

  const remove = (): void => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 200);
  };

  const timer = setTimeout(remove, DURATION[level]);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}
