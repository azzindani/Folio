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

describe('the Grade section', () => {
  const color = (id: string): Record<string, unknown> | undefined => video(id)['color'] as Record<string, unknown> | undefined;
  const drag = (key: string, values: number[]): void => {
    const el = control(key) as HTMLInputElement;
    for (const v of values) { el.value = String(v); fire(el, 'input'); }
    fire(el, 'change');
  };

  it('a slider drag writes the grade — one undo step — and a value back at zero leaves the file', () => {
    drag('exposure', [0.5, 1, 1.5]);
    drag('saturation', [0.2]);
    expect(color('b')).toEqual({ exposure: 1.5, saturation: 0.2 });
    drag('saturation', [0]);
    expect(color('b')).toEqual({ exposure: 1.5 });
    state.undo();
    expect(color('b')).toEqual({ exposure: 1.5, saturation: 0.2 });
    drag('exposure', [0]);
    state.undo();
    expect(color('b')).toEqual({ exposure: 1.5, saturation: 0.2 });
  });

  it('no grade at all leaves no color key; Reset takes the whole grade off in one step', () => {
    expect(video('b')).not.toHaveProperty('color');
    drag('contrast', [0.3]);
    drag('temperature', [-0.4]);
    const reset = wrapper.querySelector('[data-clip-act="reset"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(video('b')).not.toHaveProperty('color');
    state.undo();
    expect(color('b')).toEqual({ contrast: 0.3, temperature: -0.4 });
  });

  it('the LUT picker writes a stored .cube and None takes it off, keeping the sliders', () => {
    drag('tint', [0.2]);
    const lut = control('lut') as HTMLSelectElement;
    lut.insertAdjacentHTML('beforeend', '<option value="assets/docs/night.cube">night.cube</option>');
    lut.value = 'assets/docs/night.cube'; fire(lut, 'change');
    expect(color('b')).toEqual({ tint: 0.2, lut: 'assets/docs/night.cube' });
    const shown = control('lut') as HTMLSelectElement;
    expect(shown.value).toBe('assets/docs/night.cube');
    shown.value = ''; fire(shown, 'change');
    expect(color('b')).toEqual({ tint: 0.2 });
  });

  it('the grade section stays shut until there is a grade, and stays as the person left it', () => {
    const sec = (): HTMLElement => wrapper.querySelector('[data-clip-block="Grade"]') as HTMLElement;
    expect(sec().classList.contains('collapsed')).toBe(true);
    (sec().querySelector('.prop-section-header') as HTMLElement).click();
    expect(sec().classList.contains('collapsed')).toBe(false);
    drag('exposure', [0.4]);
    expect(sec().classList.contains('collapsed')).toBe(false);
  });
});

describe('the Green screen section', () => {
  const key = (id: string): Record<string, unknown> | undefined => video(id)['key'] as Record<string, unknown> | undefined;
  const sliderOf = (k: string): HTMLInputElement => control(k) as HTMLInputElement;

  it('stays shut and disabled until there is a key; choosing a colour keys the clip with the engine\'s defaults', () => {
    expect(wrapper.querySelector('[data-clip-block="Green screen"]')?.classList.contains('collapsed')).toBe(true);
    expect(sliderOf('similarity').disabled).toBe(true);
    expect((wrapper.querySelector('[data-clip-act="remove"]') as HTMLButtonElement).disabled).toBe(true);
    const swatch = control('color') as HTMLInputElement;
    swatch.value = '#00ff00'; fire(swatch, 'change');
    expect(key('b')).toEqual({ color: '#00ff00', similarity: 0.4, blend: 0.1 });
    expect(sliderOf('similarity').disabled).toBe(false);
  });

  it('the sliders write the key — one undo step per drag — and Remove takes it off', () => {
    const swatch = control('color') as HTMLInputElement;
    swatch.value = '#00b140'; fire(swatch, 'change');
    const sim = sliderOf('similarity');
    for (const v of ['0.5', '0.6', '0.7']) { sim.value = v; fire(sim, 'input'); }
    fire(sim, 'change');
    expect(key('b')).toEqual({ color: '#00b140', similarity: 0.7, blend: 0.1 });
    state.undo();
    expect(key('b')?.['similarity']).toBe(0.4);
    (wrapper.querySelector('[data-clip-act="remove"]') as HTMLButtonElement).click();
    expect(video('b')).not.toHaveProperty('key');
  });

  it('a grey is refused by the engine\'s own reader and writes nothing', () => {
    const swatch = control('color') as HTMLInputElement;
    swatch.value = '#808080'; fire(swatch, 'change');
    expect(video('b')).not.toHaveProperty('key');
    expect(document.body.textContent).toContain('grey');
  });
});

describe('the Reframe section', () => {
  const v = (id: string): Record<string, unknown> => video(id);
  const sliderOf = (k: string): HTMLInputElement => control(k) as HTMLInputElement;
  const drag = (key: string, ...values: number[]): void => { const el = sliderOf(key); for (const x of values) { el.value = String(x); fire(el, 'input'); } fire(el, 'change'); };
  const act = (name: string): void => (wrapper.querySelector(`[data-clip-act="${name}"]`) as HTMLButtonElement).click();

  it('with no keys the sliders set the resting crop — one undo step — and back at the centre they leave the file', () => {
    drag('fx', 0.7, 0.2);
    drag('zoom', 1.5, 2);
    expect(v('b')['focus']).toEqual([0.2, 0.5]);
    expect(v('b')['zoom']).toBe(2);
    state.undo();
    expect(v('b')['zoom']).toBeUndefined();
    drag('fx', 0.5);
    expect(v('b')).not.toHaveProperty('focus');
  });

  it('◆ Key here pins the start and the playhead; the sliders then edit the key at the playhead; × removes one; Reset clears all', async () => {
    const { registerMotionPlayer } = await import('../../editor/motion-host');
    registerMotionPlayer({ time: 3500, rows: () => null } as never);
    drag('zoom', 1.4);
    act('key-add');
    // The clip is `in: 2000, offset 1000`: the playhead at 3.5 s is file 2.5 s, and 2.5 s − 1 s of footage precedes it.
    expect((v('b')['pan'] as Array<{ at_ms: number }>).map(k => k.at_ms)).toEqual([1000, 2500]);
    drag('fx', 0.9);
    const keys = v('b')['pan'] as Array<{ at_ms: number; focus: number[]; zoom: number }>;
    expect(keys.length).toBe(2);
    expect(keys[1]).toMatchObject({ at_ms: 2500, focus: [0.9, 0.5], zoom: 1.4 });
    expect(keys[0]).toMatchObject({ at_ms: 1000, focus: [0.5, 0.5], zoom: 1.4 });
    act('key-del:0');
    expect((v('b')['pan'] as unknown[]).length).toBe(1);
    act('reset');
    expect(v('b')).not.toHaveProperty('pan');
    expect(v('b')).not.toHaveProperty('zoom');
    registerMotionPlayer({ time: 0, rows: () => null } as never);
  });

  it('says so when the clip does not fill its box', () => {
    const fit = control('fit') as HTMLSelectElement;
    fit.value = 'contain'; fire(fit, 'change');
    expect(wrapper.textContent).toContain('Reframing applies to a clip that fills its box');
  });
});
