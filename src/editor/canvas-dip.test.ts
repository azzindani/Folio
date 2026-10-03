import { describe, it, expect, afterEach } from 'vitest';
import { CanvasDip } from './canvas-dip';
import type { MotionPlayer } from './motion-player';
import type { Layer } from '../schema/types';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 10, y: 20, width: 300, height: 200, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 1000, duration_ms: 2000, ...extra } }) as unknown as Layer;

let host: HTMLElement;
afterEach(() => host?.remove());

function setup(layers: Layer[], time: number): { player: { time: number; fire(): void }; dip: CanvasDip } {
  host = document.createElement('div');
  host.innerHTML = '<svg><g data-layer-id="bg"></g><g data-layer-id="a"></g><g data-layer-id="b"></g></svg>';
  document.body.appendChild(host);
  const listeners: Array<() => void> = [];
  const player = { time, authoredLayers: () => layers, subscribe: (fn: () => void) => { listeners.push(fn); return () => undefined; }, fire: () => listeners.forEach(f => f()) };
  return { player, dip: new CanvasDip(player as unknown as MotionPlayer, host) };
}
const rects = (): SVGElement[] => Array.from(host.querySelectorAll<SVGElement>('[data-dip-for]'));

describe('the dip colour under the canvas', () => {
  const layers = [clip('a', 0), clip('b', 2000, { transition: { type: 'dip', duration_ms: 500, color: '#ff3366' } })];

  it('is drawn behind both clips while the playhead is in the window, in the dip colour over the incoming clip\'s box', () => {
    setup(layers, 2000);
    const [r] = rects();
    expect(rects().length).toBe(1);
    expect(r?.getAttribute('fill')).toBe('#ff3366');
    expect([r?.getAttribute('x'), r?.getAttribute('y'), r?.getAttribute('width'), r?.getAttribute('height')]).toEqual(['10', '20', '300', '200']);
    expect(r?.nextElementSibling?.getAttribute('data-layer-id')).toBe('a');
    expect(r?.previousElementSibling?.getAttribute('data-layer-id')).toBe('bg');
  });

  it('goes away when the playhead leaves the window, and comes back when it returns — never doubled', () => {
    const { player, dip } = setup(layers, 2000);
    player.time = 3000; player.fire();
    expect(rects().length).toBe(0);
    player.time = 1900; player.fire(); player.fire(); dip.sync();
    expect(rects().length).toBe(1);
  });

  it('other transitions and a hard cut draw nothing', () => {
    setup([clip('a', 0), clip('b', 2000, { transition: { type: 'crossfade' } })], 2000);
    expect(rects().length).toBe(0);
  });

  it('dispose takes it out of the canvas', () => {
    const { dip } = setup(layers, 2000);
    dip.dispose();
    expect(rects().length).toBe(0);
  });
});
