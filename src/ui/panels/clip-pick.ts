// Picking a colour out of a clip's own picture — for a green screen, the colour to take out.
//
// The browser's eyedropper reads what is ON SCREEN, which already carries the clip's grade and key; keyed
// again it would pick the wrong colour. This reads the video's raw frame instead: a click on the canvas is
// mapped back through the same fit and crop the <video> is drawn with (animation/clip-crop.ts: focus is
// the object-position, zoom a scale about it, so a point's place in the element box survives the zoom).

import { showToast } from '../../utils/toast';

/** Where in a w×h source frame a point at (fx, fy) of the element box lands, for an object-fit and object-position. */
export function sourcePoint(
  fx: number, fy: number, aspect: number, vw: number, vh: number, fit: string, pos: readonly [number, number],
): { x: number; y: number } | null {
  if (fit === 'fill') return { x: fx * vw, y: fy * vh };
  if (fit !== 'cover' && fit !== 'contain') return null;
  // The element box in units where it is 1 wide (and 1/aspect tall); s = those units per source pixel.
  const boxH = 1 / aspect;
  const s = fit === 'cover' ? Math.max(1 / vw, boxH / vh) : Math.min(1 / vw, boxH / vh);
  const ox = (1 - vw * s) * pos[0], oy = (boxH - vh * s) * pos[1];
  const x = (fx - ox) / s, y = (fy * boxH - oy) / s;
  return x < 0 || y < 0 || x >= vw || y >= vh ? null : { x, y };
}

/** "37% 80%" → [0.37, 0.8]; anything else is the middle. */
function position(css: string): [number, number] {
  const m = /(-?[\d.]+)%\s+(-?[\d.]+)%/.exec(css);
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5];
}

const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0');

/** The colour of the clip's raw picture under a click (a 5×5 average, steadier than one pixel); null off the picture. */
export function sampleClip(layerId: string, clientX: number, clientY: number): string | null {
  const v = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-video-layer]')).find(e => e.dataset['videoLayer'] === layerId);
  if (!v || !v.videoWidth || v.readyState < 2) return null;
  const r = v.getBoundingClientRect();
  if (!r.width || !r.height || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  const css = getComputedStyle(v);
  const p = sourcePoint((clientX - r.left) / r.width, (clientY - r.top) / r.height, r.width / r.height, v.videoWidth, v.videoHeight, css.objectFit, position(css.objectPosition));
  if (!p) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 5;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  try {
    g.drawImage(v, Math.min(Math.max(0, Math.round(p.x) - 2), v.videoWidth - 5), Math.min(Math.max(0, Math.round(p.y) - 2), v.videoHeight - 5), 5, 5, 0, 0, 5, 5);
    const d = g.getImageData(0, 0, 5, 5).data;
    let r0 = 0, g0 = 0, b0 = 0;
    for (let i = 0; i < d.length; i += 4) { r0 += d[i] ?? 0; g0 += d[i + 1] ?? 0; b0 += d[i + 2] ?? 0; }
    const n = d.length / 4;
    return `#${hex(r0 / n)}${hex(g0 / n)}${hex(b0 / n)}`;
  } catch { return null; }
}

let cancel: (() => void) | null = null;

/** Wait for one click on the clip's picture and hand back its colour. The click is the picker's: nothing under it is selected or dragged. */
export function pickFromClip(layerId: string, done: (hex: string) => void): void {
  cancel?.();
  document.body.classList.add('clip-picking');
  showToast('Click the colour in the picture — Esc cancels', 'info');
  const stop = (): void => {
    document.body.classList.remove('clip-picking');
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('keydown', key, true);
    cancel = null;
  };
  const down = (e: PointerEvent): void => {
    e.preventDefault(); e.stopPropagation();
    // The click that follows the press would select the layer under it.
    document.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
    const c = sampleClip(layerId, e.clientX, e.clientY);
    stop();
    if (c) done(c); else showToast('That point is not on the clip\'s picture.', 'warning');
  };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
  cancel = stop;
}
