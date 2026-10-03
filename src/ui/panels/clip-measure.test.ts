import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../../editor/state';
import { measure, measuredFor, sceneTimes, shotsOnScene, onMeasured } from './clip-measure';
import { measureClip } from '../../editor/clip-bridge';
import { clipMarkup } from './timeline-clips';
import type { ClipLayer } from '../../animation/video-clip';

vi.mock('../../editor/clip-bridge', () => ({ measureClip: vi.fn() }));

const clip = (id: string, extra: Record<string, unknown> = {}, video: Record<string, unknown> = {}): ClipLayer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 10, height: 10, src: 'assets/video/x.mp4', in: 2000, out: 4000, video: { offset_ms: 1000, duration_ms: 2000, ...video }, ...extra }) as unknown as ClipLayer;

describe('shots and silences kept on the file clock', () => {
  it('map to the scene at the clip\'s speed; a ramp or a freeze has no single mapping', () => {
    expect(sceneTimes(clip('a'), [1500, 2500])).toEqual([2500, 3500]);
    expect(sceneTimes(clip('a', {}, { speed: 2, duration_ms: 2000 }), [2000])).toEqual([2500]);
    expect(sceneTimes(clip('a', {}, { ramp: [{ at_ms: 0, speed: 1 }, { at_ms: 500, speed: 2 }] }), [1500])).toEqual([]);
    expect(sceneTimes(clip('a', {}, { still: true }), [1500])).toEqual([]);
  });

  it('are known after measuring, and a trim only hides what it cuts off', async () => {
    vi.mocked(measureClip).mockResolvedValue({ from: 1000, to: 3000, shots: [1200, 1800, 2900], silences: [[1500, 1700]] });
    const heard = vi.fn();
    const off = onMeasured(heard);
    const l = clip('m1');
    expect(measuredFor(l)).toBeNull();
    expect(await measure(new StateManager(), l)).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    expect(measuredFor(l)?.shots).toEqual([1200, 1800, 2900]);
    expect(shotsOnScene(l)).toEqual([2200, 2800, 3900]);
    // Trimmed to file 1500–2500: the shot at 1200 and 2900 are outside, the silence is cut to what remains.
    const trimmed = clip('m1', { in: 2500, out: 3500 }, { offset_ms: 1500, duration_ms: 1000 });
    expect(measuredFor(trimmed)).toEqual({ shots: [1800], silences: [[1500, 1700]] });
    // Brought back footage never measured: unknown again.
    expect(measuredFor(clip('m1', {}, { offset_ms: 500, duration_ms: 2000 }))).toBeNull();
    expect(measuredFor(clip('m1', { src: 'assets/video/other.mp4' }))).toBeNull();
  });

  it('a failed measurement is a reason, and nothing is remembered', async () => {
    vi.mocked(measureClip).mockResolvedValue({ error: 'ffmpeg is missing' });
    const l = clip('m2');
    expect(await measure(new StateManager(), l)).toBe('ffmpeg is missing');
    expect(measuredFor(l)).toBeNull();
  });
});

describe('shot ticks on a clip block', () => {
  it('one tick per cut inside the block, at its place along it; none outside', () => {
    const html = clipMarkup(clip('t'), undefined, 10_000, 32, undefined, { shots: [1500, 2500, 3000, 4000, 5000] });
    expect((html.match(/class="tl-shot"/g) ?? []).length).toBe(2);
    expect(html).toContain('left:25.000%');
    expect(html).toContain('left:50.000%');
    expect(clipMarkup(clip('t'), undefined, 10_000, 32)).not.toContain('tl-shot');
  });
});
