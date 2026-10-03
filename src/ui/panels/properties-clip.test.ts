import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { PropertiesPanelManager } from './properties-panel';
import type { DesignSpec, Layer } from '../../schema/types';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 320, height: 180, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 1000, duration_ms: 2000 }, ...extra }) as unknown as Layer;
const design = (layers: Layer[]): DesignSpec =>
  ({ _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 320, height: 180, unit: 'px', dpi: 96 }, layers }) as unknown as DesignSpec;

let wrapper: HTMLElement, state: StateManager;
const video = (id: string): Record<string, unknown> => (state.findLayer(id) as unknown as { video?: Record<string, unknown> }).video ?? {};
const control = (key: string): HTMLInputElement | HTMLSelectElement => wrapper.querySelector(`[data-clip="${key}"]`) as HTMLInputElement;
const fire = (el: Element, type: string): void => { el.dispatchEvent(new Event(type, { bubbles: true })); };

beforeEach(() => {
  state = new StateManager();
  wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="properties-content"></div>';
  document.body.appendChild(wrapper);
  new PropertiesPanelManager(wrapper, state);
  state.set('design', design([clip('a', 0), clip('b', 2000)]), false);
  state.set('selectedLayerIds', ['b'], false);
});
afterEach(() => { wrapper.remove(); });

describe('the Clip inspector on a selected video layer', () => {
  it('shows the clip on both clocks, and no clip section on any other layer', () => {
    const text = wrapper.textContent ?? '';
    expect(text).toContain('Clip');
    expect(text).toContain('2.00s – 4.00s');
    expect(text).toContain('1.00s – 3.00s');
    state.set('design', design([{ id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, fill: { type: 'solid', color: '#000' } } as unknown as Layer]), false);
    state.set('selectedLayerIds', ['r'], false);
    expect(wrapper.querySelector('[data-clip]')).toBeNull();
  });

  it('a typed speed commits on change through the engine\'s limits; a refused one writes nothing', () => {
    const speed = control('speed') as HTMLInputElement;
    speed.value = '2'; fire(speed, 'change');
    expect(video('b')['speed']).toBe(2);
    const again = control('speed') as HTMLInputElement;
    again.value = '20'; fire(again, 'change');
    expect(video('b')['speed']).toBe(2);
  });

  it('mute and loop write real booleans and drop back to nothing when off; fit lives on the layer', () => {
    const mute = control('muted') as HTMLInputElement;
    mute.checked = true; fire(mute, 'change');
    expect(video('b')['muted']).toBe(true);
    const off = control('muted') as HTMLInputElement;
    off.checked = false; fire(off, 'change');
    expect(video('b')).not.toHaveProperty('muted');
    const fit = control('fit') as HTMLSelectElement;
    fit.value = 'contain'; fire(fit, 'change');
    expect((state.findLayer('b') as unknown as { fit?: string }).fit).toBe('contain');
    const back = control('fit') as HTMLSelectElement;
    back.value = 'cover'; fire(back, 'change');
    expect(state.findLayer('b')).not.toHaveProperty('fit');
  });

  it('a slider drag is ONE undo step however many input events it fires, and the panel is not rebuilt under it', () => {
    const slider = control('volume') as HTMLInputElement;
    for (const v of ['0.9', '0.6', '0.3']) { slider.value = v; fire(slider, 'input'); }
    expect(video('b')['volume']).toBe(0.3);
    expect(control('volume')).toBe(slider);
    fire(slider, 'change');
    state.undo();
    expect(video('b')).not.toHaveProperty('volume');
  });

  it('fades and J/L cuts are typed in ms; zero clears them', () => {
    const lead = control('audio_lead_ms') as HTMLInputElement;
    lead.value = '250'; fire(lead, 'change');
    expect(video('b')['audio_lead_ms']).toBe(250);
    const gone = control('audio_lead_ms') as HTMLInputElement;
    gone.value = '0'; fire(gone, 'change');
    expect(video('b')).not.toHaveProperty('audio_lead_ms');
  });
});
