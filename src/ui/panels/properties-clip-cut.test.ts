import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from '../../editor/state';
import { PropertiesPanelManager } from './properties-panel';
import { silenceCuts } from './properties-clip-cut';
import { measureClip, runClipOp } from '../../editor/clip-bridge';
import type { DesignSpec, Layer } from '../../schema/types';

vi.mock('../../editor/clip-bridge', () => ({ measureClip: vi.fn(), runClipOp: vi.fn() }));

const clip = (id: string, extra: Record<string, unknown> = {}, video: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 320, height: 180, src: `assets/video/${id}.mp4`, in: 2000, out: 4000, video: { offset_ms: 1000, duration_ms: 2000, ...video }, ...extra }) as unknown as Layer;
const design = (layers: Layer[]): DesignSpec =>
  ({ _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 320, height: 180, unit: 'px', dpi: 96 }, layers }) as unknown as DesignSpec;

let wrapper: HTMLElement, state: StateManager;
const cutBlock = (): HTMLElement => wrapper.querySelector('[data-clip-block="Cut"]') as HTMLElement;
const act = (a: string): HTMLButtonElement => cutBlock().querySelector(`[data-clip-act="${a}"]`) as HTMLButtonElement;
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));
const open = (layers: Layer[], id: string): void => { state.set('design', design(layers), false); state.set('selectedLayerIds', [id], false); };
const measured = (shots: number[], silences: Array<[number, number]>): void => { vi.mocked(measureClip).mockResolvedValue({ from: 0, to: 9000, shots, silences }); };

beforeEach(() => {
  vi.mocked(measureClip).mockReset(); vi.mocked(runClipOp).mockReset();
  state = new StateManager();
  wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="properties-content"></div>';
  document.body.appendChild(wrapper);
  new PropertiesPanelManager(wrapper, state);
});
afterEach(() => { wrapper.remove(); document.querySelectorAll('.toast').forEach(t => t.remove()); });

describe('silenceCuts', () => {
  it('leaves a breath at each end, except at the clip\'s own edge, and skips what is too short to cut', () => {
    expect(silenceCuts([[2000, 3000]], 0, 9000, 150)).toEqual([[2150, 2850]]);
    expect(silenceCuts([[0, 800]], 0, 9000, 150)).toEqual([[0, 650]]);
    expect(silenceCuts([[8000, 9000]], 0, 9000, 150)).toEqual([[8150, 9000]]);
    expect(silenceCuts([[2000, 2350]], 0, 9000, 150)).toEqual([]);
    expect(silenceCuts([[500, 1500]], 1000, 9000, 100)).toEqual([[1000, 1400]]);
  });
});

describe('the Cut section', () => {
  it('measures on demand; nothing can be split or cut before there is something found', async () => {
    open([clip('b1')], 'b1');
    expect(act('split').disabled).toBe(true);
    expect(act('silence').disabled).toBe(true);
    measured([1500, 2200], [[1800, 2600]]);
    act('measure').click();
    await flush(); await flush();
    expect(measureClip).toHaveBeenCalledTimes(1);
    expect(cutBlock().textContent).toContain('2 shot cuts · 1 silence');
    expect(act('split').disabled).toBe(false);
    expect(act('split').textContent).toContain('(2)');
    expect(act('silence').textContent).toContain('Cut 1 silence');
  });

  it('Split at shots cuts one clip per shot on the scene clock, as one undo step', async () => {
    open([clip('b2')], 'b2');
    measured([1500, 2200], []);
    act('measure').click(); await flush(); await flush();
    act('split').click();
    const ids = state.getCurrentLayers().map(l => l.id);
    expect(ids).toEqual(['b2', 'b2_2', 'b2_3']);
    const plays = state.getCurrentLayers().map(l => [(l as unknown as { in: number }).in, (l as unknown as { out: number }).out]);
    expect(plays).toEqual([[2000, 2500], [2500, 3200], [3200, 4000]]);
    state.undo();
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['b2']);
  });

  it('Cut silences asks the engine for the spans with the breath kept, and tells what it took out', async () => {
    open([clip('b3')], 'b3');
    measured([], [[1800, 2600]]);
    act('measure').click(); await flush(); await flush();
    vi.mocked(runClipOp).mockResolvedValue({ ok: true, result: { removed_ms: 500 } });
    act('silence').click(); await flush();
    expect(runClipOp).toHaveBeenCalledWith(state, { layer_id: 'b3', cut: [[1950, 2450]] });
    expect(document.body.textContent).toContain('Took 0.5 s of silence out');
  });

  it('a refused cut shows the engine\'s reason and changes nothing', async () => {
    open([clip('b4')], 'b4');
    measured([], [[1800, 2600]]);
    act('measure').click(); await flush(); await flush();
    vi.mocked(runClipOp).mockResolvedValue({ ok: false, error: 'Closing it would swallow: caption' });
    act('silence').click(); await flush();
    expect(document.body.textContent).toContain('would swallow: caption');
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['b4']);
  });

  it('Cut the track to the beat sends the chosen spacing, and shows the engine\'s hint when there is no music', async () => {
    open([clip('b5')], 'b5');
    const every = cutBlock().querySelector('[data-clip="every"]') as HTMLSelectElement;
    every.value = '4'; every.dispatchEvent(new Event('change', { bubbles: true }));
    vi.mocked(runClipOp).mockResolvedValue({ ok: false, error: 'No music', hint: 'Put music under the piece (op:audio).' });
    act('beats').click(); await flush();
    expect(runClipOp).toHaveBeenCalledWith(state, { layer_id: 'b5', on_beats: { every: 4 } });
    expect(document.body.textContent).toContain('Put music under the piece');
    vi.mocked(runClipOp).mockResolvedValue({ ok: true, result: { moved: [{}, {}] } });
    act('beats').click(); await flush();
    expect(document.body.textContent).toContain('Moved 2 cuts onto the beat');
  });

  it('a ramped clip cannot be cut by its footage, and says so', async () => {
    open([clip('b6', {}, { ramp: [{ at_ms: 0, speed: 1 }, { at_ms: 800, speed: 0.5 }] })], 'b6');
    measured([1500], [[1800, 2600]]);
    act('measure').click(); await flush(); await flush();
    expect(act('split').disabled).toBe(true);
    expect(act('silence').disabled).toBe(true);
    expect(cutBlock().textContent).toContain('cannot be cut by its footage');
  });
});
