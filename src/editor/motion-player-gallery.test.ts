import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer } from './motion-player';
import { renderEntry } from '../renderer/render-entry';
import type { DesignSpec, Layer } from '../schema/types';

// Close-out C7: a gallery's cells are made by the resolver, not held in the editor's state, so
// the player's poses for them had nowhere to go — Play and a seek left them where they were
// authored (the canvas drops its CSS motion while posed). They are now kept beside the design
// and drawn by the canvas render; the design itself is never touched.

const dots = {
  id: 'dots', type: 'group', z: 1, x: 100, y: 100, width: 600, height: 100, layers: [],
  gallery: { items: 3, gap: 20, template: [{ id: 'dot', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: '#E4572E',
    animation: { rule: { preset: 'rise', at: '=Index * 1000', duration: 400 } } }] },
} as unknown as Layer;
const DESIGN = { _protocol: 'design/v1', meta: { id: 'g', name: 'G', type: 'poster' }, document: { width: 800, height: 400, unit: 'px', dpi: 96 },
  layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 800, height: 400, fill: '#FBF7F0' }, dots] } as unknown as DesignSpec;

function loaded(): { state: StateManager; player: MotionPlayer } {
  const state = new StateManager();
  state.set('design', structuredClone(DESIGN));
  return { state, player: new MotionPlayer(state) };
}
const opacityOf = (svg: SVGSVGElement, id: string): string | null => svg.querySelector(`[data-layer-id="${id}"]`)?.getAttribute('opacity') ?? null;

describe('the per-page player poses gallery cells', () => {
  it('poses each cell at the playhead, beside the design, and draws them on the canvas render', async () => {
    const { state, player } = loaded();
    await player.ready();
    expect(player.hasMotion()).toBe(true);
    expect(player.duration).toBeGreaterThanOrEqual(2400);
    let redraws = 0;
    player.setRedraw(() => { redraws++; });
    player.seek(700);
    const poses = player.generatedPoses();
    expect(poses.get('dots_1_dot')?.['opacity']).toBe(1);
    expect(poses.get('dots_2_dot')?.['opacity']).toBe(0);
    expect(redraws).toBe(1);
    expect(state.get().design).toEqual(DESIGN);
    const svg = renderEntry(state.get().design as DesignSpec, { poses }).svg;
    expect(opacityOf(svg, 'dots_2_dot')).toBe('0');
    expect(opacityOf(svg, 'dots_1_dot')).not.toBe('0');
  });

  it('lets go of them on stop, and draws the design as authored again', async () => {
    const { player } = loaded();
    await player.ready();
    let redraws = 0;
    player.setRedraw(() => { redraws++; });
    player.seek(1200);
    player.stop();
    expect(player.generatedPoses().size).toBe(0);
    expect(redraws).toBe(2);
  });
});
