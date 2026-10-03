import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { PropertiesPanelManager } from './properties-panel';
import { cleanTransition } from './properties-clip-transition';
import type { DesignSpec, Layer } from '../../schema/types';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 320, height: 180, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 1000, duration_ms: 2000 }, ...extra }) as unknown as Layer;
const design = (layers: Layer[]): DesignSpec =>
  ({ _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 320, height: 180, unit: 'px', dpi: 96 }, layers }) as unknown as DesignSpec;

let wrapper: HTMLElement, state: StateManager;
const transition = (id: string): Record<string, unknown> | undefined => (state.findLayer(id) as unknown as { video?: { transition?: Record<string, unknown> } }).video?.transition;
// Scoped to the Transition block: Green screen has a colour of its own.
const control = (key: string): HTMLInputElement | HTMLSelectElement | null => wrapper.querySelector(`[data-clip-block="Transition"] [data-clip="${key}"]`);
const fire = (el: Element, type: string): void => { el.dispatchEvent(new Event(type, { bubbles: true })); };
const choose = (key: string, value: string): void => { const el = control(key) as HTMLSelectElement; el.value = value; fire(el, 'change'); };
const open = (layers: Layer[], id: string): void => { state.set('design', design(layers), false); state.set('selectedLayerIds', [id], false); };

beforeEach(() => {
  state = new StateManager();
  wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="properties-content"></div>';
  document.body.appendChild(wrapper);
  new PropertiesPanelManager(wrapper, state);
});
afterEach(() => { wrapper.remove(); });

describe('cleanTransition', () => {
  it('keeps only what the type reads', () => {
    expect(cleanTransition({ type: 'dip', color: '#112233', direction: 'left', duration_ms: 400 })).toEqual({ type: 'dip', color: '#112233', duration_ms: 400 });
    expect(cleanTransition({ type: 'wipe', color: '#112233', direction: 'up' })).toEqual({ type: 'wipe', direction: 'up' });
    expect(cleanTransition({ type: 'crossfade', color: '#112233', direction: 'up' })).toEqual({ type: 'crossfade' });
  });
});

describe('the Transition section', () => {
  it('a clip joined to the one before it picks a transition; the file holds only what that type reads', () => {
    open([clip('a', 0), clip('b', 2000)], 'b');
    expect(control('type')?.hasAttribute('disabled')).toBe(false);
    choose('type', 'crossfade');
    expect(transition('b')).toEqual({ type: 'crossfade' });
    choose('type', 'dip');
    expect(control('color')).not.toBeNull();
    choose('color', '#202020');
    expect(transition('b')).toEqual({ type: 'dip', color: '#202020' });
    choose('type', 'wipe');
    expect(control('color')).toBeNull();
    choose('direction', 'up');
    expect(transition('b')).toEqual({ type: 'wipe', direction: 'up' });
  });

  it('the length is a drag — one undo step however many inputs — and stays inside the engine\'s range', () => {
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'crossfade' } } })], 'b');
    const len = control('duration') as HTMLInputElement;
    expect(len.value).toBe('500');
    for (const v of ['600', '800', '1200']) { len.value = v; fire(len, 'input'); }
    fire(len, 'change');
    expect(transition('b')).toEqual({ type: 'crossfade', duration_ms: 1200 });
    state.undo();
    expect(transition('b')).toEqual({ type: 'crossfade' });
  });

  it('None takes the transition off the file', () => {
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'push', direction: 'left' } } })], 'b');
    choose('type', '');
    expect(transition('b')).toBeUndefined();
  });

  it('says when the clip\'s own motion keeps the preview from showing the transition', () => {
    const moving = { animation: { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: 20 }] } };
    open([clip('a', 0), clip('b', 2000, { ...moving, video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'crossfade' } } })], 'b');
    expect(wrapper.textContent).toContain('motion of its own');
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'crossfade' } } })], 'b');
    expect(wrapper.textContent).not.toContain('motion of its own');
  });

  it('a clip with nothing before it cannot take one, and says what a join needs', () => {
    open([clip('a', 0), clip('b', 5000)], 'b');
    expect(control('type')?.hasAttribute('disabled')).toBe(true);
    expect(wrapper.textContent).toContain('No clip ends where this one starts');
  });

  it('a transition left without a join can still be taken off', () => {
    open([clip('a', 0), clip('b', 5000, { video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'crossfade' } } })], 'b');
    expect(control('type')?.hasAttribute('disabled')).toBe(false);
    expect(control('duration')?.hasAttribute('disabled')).toBe(true);
    choose('type', '');
    expect(transition('b')).toBeUndefined();
  });
});

describe('sections answer only their own controls', () => {
  const block = (title: string): HTMLElement => wrapper.querySelector(`[data-clip-block="${title}"]`) as HTMLElement;
  const layer = (id: string): Record<string, unknown> => (state.findLayer(id) as unknown as { video: Record<string, unknown> }).video;

  it('a dip colour is the transition\'s, not a green screen', () => {
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, transition: { type: 'dip' } } })], 'b');
    const swatch = block('Transition').querySelector('[data-clip="color"]') as HTMLInputElement;
    swatch.value = '#336699'; fire(swatch, 'change');
    expect(transition('b')).toEqual({ type: 'dip', color: '#336699' });
    expect(layer('b')['key']).toBeUndefined();
  });

  it('Reset in Grade leaves the reframe alone, and Reset in Reframe leaves the grade', () => {
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, focus: [0.2, 0.5], zoom: 2, color: { contrast: 0.3 } } })], 'b');
    (block('Grade').querySelector('[data-clip-act="reset"]') as HTMLButtonElement).click();
    expect(layer('b')['color']).toBeUndefined();
    expect(layer('b')['zoom']).toBe(2);
    open([clip('a', 0), clip('b', 2000, { video: { offset_ms: 1000, duration_ms: 2000, focus: [0.2, 0.5], zoom: 2, color: { contrast: 0.3 } } })], 'b');
    (block('Reframe').querySelector('[data-clip-act="reset"]') as HTMLButtonElement).click();
    expect(layer('b')['zoom']).toBeUndefined();
    expect(layer('b')['color']).toEqual({ contrast: 0.3 });
  });
});
