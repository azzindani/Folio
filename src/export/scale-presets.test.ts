import { describe, it, expect } from 'vitest';
import {
  EXPORT_SCALE_PRESETS,
  DEFAULT_SCALE_PRESET_ID,
  getScalePreset,
  defaultScalePreset,
} from './scale-presets';

describe('EXPORT_SCALE_PRESETS', () => {
  it('contains at least one preset', () => {
    expect(EXPORT_SCALE_PRESETS.length).toBeGreaterThan(0);
  });

  it('every preset has unique id', () => {
    const ids = EXPORT_SCALE_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has positive scale > 0', () => {
    for (const p of EXPORT_SCALE_PRESETS) {
      expect(p.scale).toBeGreaterThan(0);
    }
  });

  it('every preset DPI equals round(scale × 96)', () => {
    for (const p of EXPORT_SCALE_PRESETS) {
      expect(p.dpi).toBe(Math.round(p.scale * 96));
    }
  });

  it('default preset id resolves to a real preset', () => {
    expect(getScalePreset(DEFAULT_SCALE_PRESET_ID)).toBeDefined();
  });

  it('defaultScalePreset() returns the configured default', () => {
    expect(defaultScalePreset().id).toBe(DEFAULT_SCALE_PRESET_ID);
  });

  it('getScalePreset returns undefined for unknown id', () => {
    expect(getScalePreset('nonexistent-preset-id')).toBeUndefined();
  });

  it('includes ×1 screen preset', () => {
    const p = getScalePreset('x1');
    expect(p?.scale).toBe(1);
    expect(p?.dpi).toBe(96);
  });

  it('includes ×2 retina preset', () => {
    const p = getScalePreset('x2');
    expect(p?.scale).toBe(2);
    expect(p?.dpi).toBe(192);
  });

  it('includes print-300 preset at exactly 300 DPI', () => {
    const p = getScalePreset('print-300');
    expect(p?.dpi).toBe(300);
  });

  it('includes print-600 preset at exactly 600 DPI', () => {
    const p = getScalePreset('print-600');
    expect(p?.dpi).toBe(600);
  });
});
