import { describe, it, expect, beforeEach } from 'vitest';
import { chooseVideoSettings, sizeOptions, rememberedChoice, exportDurationMs, DEFAULT_CHOICE } from './video-export-dialog';
import type { DesignSpec } from '../../schema/types';

const deck = (): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'carousel', created: '', modified: '' },
  document: { width: 1920, height: 1080, unit: 'px', dpi: 96 },
  pages: [
    { id: 'a', auto_advance: 3000, layers: [] },
    { id: 'b', auto_advance: 2000, transition: { type: 'fade', duration: 400 }, layers: [] },
  ],
} as unknown as DesignSpec);

const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
const $ = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('video export settings', () => {
  it('offers sizes in the pixels the file will have', () => {
    expect(sizeOptions({ width: 1920, height: 1080 }).map(o => o.label))
      .toEqual(['1920 × 1080 (full)', '1280 × 720', '960 × 540', '640 × 360', '480 × 270']);
  });

  it('counts the whole piece for a deck', () => {
    expect(exportDurationMs(deck(), true)).toBe(5000);
  });

  it('shows the frames a choice costs, and Enter exports what is selected', async () => {
    const asked = chooseVideoSettings('gif', deck(), true);
    expect($('.video-export-cost')?.textContent).toBe('5.0s · 100 frames to render');
    const size = $<HTMLSelectElement>('.video-export-size');
    const fps = $<HTMLSelectElement>('.video-export-fps');
    if (size && fps) {
      size.value = String(1 / 3);
      fps.value = '25';
      fps.dispatchEvent(new Event('change'));
    }
    expect($('.video-export-cost')?.textContent).toBe('5.0s · 125 frames to render');
    document.dispatchEvent(key('Enter'));
    expect(await asked).toEqual({ scale: 1 / 3, fps: 25 });
    expect($('.video-export-dialog')).toBeNull();
    expect(rememberedChoice('gif')).toEqual({ scale: 1 / 3, fps: 25 });
  });

  it('Escape cancels and remembers nothing', async () => {
    const asked = chooseVideoSettings('mp4', deck(), true);
    document.dispatchEvent(key('Escape'));
    expect(await asked).toBeNull();
    expect(rememberedChoice('mp4')).toEqual(DEFAULT_CHOICE.mp4);
  });
});
