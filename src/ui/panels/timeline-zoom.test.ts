import { describe, it, expect } from 'vitest';
import { trackWidth, fitScale, clampZoom, stepZoom, scrollAfterZoom, tickStep, tickLabel, rulerTicks, MAX_PX_PER_MS, MIN_PX_PER_MS } from './timeline-zoom';

describe('the track width', () => {
  it('fits the view, or follows the scale but never falls short of the view', () => {
    expect(trackWidth(10_000, null, 800)).toBe(800);
    expect(trackWidth(10_000, 0.2, 800)).toBe(2000);
    expect(trackWidth(10_000, 0.01, 800)).toBe(800);
    expect(trackWidth(10_000, null, 5)).toBe(40);
  });
});

describe('zoom limits and steps', () => {
  it('holds the scale to the limits; at or under the fit it IS the fit', () => {
    expect(fitScale(10_000, 800)).toBe(0.08);
    expect(clampZoom(0.05, 10_000, 800)).toBeNull();
    expect(clampZoom(0.08, 10_000, 800)).toBeNull();
    expect(clampZoom(0.2, 10_000, 800)).toBe(0.2);
    expect(clampZoom(99, 10_000, 800)).toBe(MAX_PX_PER_MS);
    expect(clampZoom(0.0001, 1_000_000, 400)).toBeNull();
    expect(MIN_PX_PER_MS).toBeLessThan(MAX_PX_PER_MS);
  });
  it('steps ×1.5 from the fit and back to it', () => {
    const in1 = stepZoom(null, 1, 10_000, 800);
    expect(in1).toBeCloseTo(0.12, 5);
    expect(stepZoom(in1, -1, 10_000, 800)).toBeNull();
    expect(stepZoom(null, -1, 10_000, 800)).toBeNull();
    expect(stepZoom(MAX_PX_PER_MS, 1, 10_000, 800)).toBe(MAX_PX_PER_MS);
  });
  it('keeps the moment under the pointer where it was', () => {
    // 3000 ms sits under x=200 at 0.1 px/ms with scroll 100 (ms = (100+200)/0.1); at 0.4 px/ms it must still be under x=200.
    const after = scrollAfterZoom(100, 200, 0.1, 0.4);
    expect((after + 200) / 0.4).toBeCloseTo(3000, 0);
    expect(scrollAfterZoom(0, 0, 0.1, 0.4)).toBe(0);
    expect(scrollAfterZoom(10, 300, 0.4, 0.1)).toBe(0);
  });
});

describe('ruler ticks', () => {
  it('pick the finest step whose labels are 64 px apart', () => {
    expect(tickStep(0.08)).toBe(1000);     // 80 px a second
    expect(tickStep(0.01)).toBe(10_000);   // 100 px per 10 s
    expect(tickStep(2)).toBe(50);          // 2 px a ms: 50 ms = 100 px
    expect(tickStep(0.0001)).toBe(600_000);
  });
  it('label seconds, fractions of one, and minutes', () => {
    expect(tickLabel(3000, 1000)).toBe('3s');
    expect(tickLabel(3500, 500)).toBe('3.5s');
    expect(tickLabel(3250, 50)).toBe('3.25s');
    expect(tickLabel(65_000, 5000)).toBe('1:05');
  });
  it('are a labelled mark every step with unlabelled ones between when there is room', () => {
    const t = rulerTicks(3000, 0.08);       // step 1000, minor 200 (16 px)
    expect(t.filter(x => x.label).map(x => x.label)).toEqual(['0s', '1s', '2s', '3s']);
    expect(t.length).toBe(16);
    expect(t[1]).toEqual({ ms: 200, label: null });
    const tight = rulerTicks(60_000, 0.001);   // step 100 000? no: 64 px = 64 s → 120 s
    expect(tight.every(x => x.ms <= 60_000)).toBe(true);
    expect(tight[0]).toEqual({ ms: 0, label: '0s' });
  });
});
