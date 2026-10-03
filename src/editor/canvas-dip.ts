/**
 * The colour a dip passes through, under the editor's canvas.
 *
 * A dip fades the outgoing clip to a colour and the incoming one up from it. The export compiles that colour
 * into a rect layer behind both clips (animation/clip-transition.ts); the canvas draws the AUTHORED layers, so
 * without this the preview shows the page behind the clips instead of the dip colour. While the playhead is
 * inside a dip's window, this puts the same rect into the canvas, behind the earlier of the two clips.
 */

import type { MotionPlayer } from './motion-player';
import { dipUnderlays } from '../animation/clip-transition';
import type { Layer } from '../schema/types';

const NS = 'http://www.w3.org/2000/svg';
type Rect = { id: string; x: number; y: number; width: number; height: number; in: number; out: number; fill: { color: string } };

export class CanvasDip {
  private observer: MutationObserver;
  private unsubscribe: () => void;
  private from: unknown = null;
  private dips: Array<{ rect: Rect; clips: [string, string] }> = [];

  constructor(private player: MotionPlayer, private container: HTMLElement) {
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(container, { childList: true, subtree: true });
    this.unsubscribe = player.subscribe(() => this.sync());
    this.sync();
  }

  /** Put the colour under the clips while the playhead is inside a dip, and take it away outside. Idempotent: the canvas rebuilds often. */
  sync(): void {
    const layers = this.player.authoredLayers() as Layer[];
    if (layers !== this.from) {
      this.from = layers;
      this.dips = dipUnderlays(layers, false).map(d => ({ rect: d.rect as unknown as Rect, clips: d.clips }));
    }
    const t = this.player.time;
    const live = this.dips.filter(d => t >= d.rect.in && t < d.rect.out);
    this.container.querySelectorAll<SVGElement>('[data-dip-for]').forEach(el => {
      if (!live.some(d => d.rect.id === el.dataset['dipFor'])) el.remove();
    });
    for (const d of live) {
      if (this.container.querySelector(`[data-dip-for="${d.rect.id}"]`)) continue;
      const a = this.container.querySelector(`[data-layer-id="${d.clips[0]}"]`), b = this.container.querySelector(`[data-layer-id="${d.clips[1]}"]`);
      if (!a || !b) continue;
      const first = a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? a : b;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('data-dip-for', d.rect.id);
      for (const k of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(k, String(d.rect[k]));
      rect.setAttribute('fill', d.rect.fill.color);
      rect.setAttribute('pointer-events', 'none');
      first.parentNode?.insertBefore(rect, first);
    }
  }

  dispose(): void {
    this.observer.disconnect();
    this.unsubscribe();
    this.container.querySelectorAll('[data-dip-for]').forEach(el => el.remove());
  }
}
