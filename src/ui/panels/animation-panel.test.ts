import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnimationPanel } from './animation-panel';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

function makeDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [
      { id: 'r1', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 } as unknown as import('../../schema/types').Layer,
    ],
  } as unknown as DesignSpec;
}

describe('AnimationPanel', () => {
  let state: StateManager;
  let container: HTMLElement;
  let panel: AnimationPanel;

  beforeEach(() => {
    state = new StateManager();
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new AnimationPanel(container, state);
  });
  afterEach(() => { container.remove(); });

  it('shows placeholder when nothing selected', () => {
    expect(container.textContent).toContain('Select a layer');
  });

  it('renders sections when a layer is selected', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const titles = [...container.querySelectorAll('.anim-section-title')].map(el => el.textContent?.trim());
    expect(titles).toContain('Entrance');
    expect(titles).toContain('Loop');
    expect(titles).toContain('Exit');
    expect(titles.some(t => t?.startsWith('Keyframes'))).toBe(true);
    void panel;
  });

  it('enter type select defaults to (none)', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="enter"][data-field="type"]')!;
    expect(sel.value).toBe('(none)');
  });

  it('changing enter type stores animation in state', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="enter"][data-field="type"]')!;
    sel.value = 'fade_in';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.enter?.type).toBe('fade_in');
  });

  it('selecting (none) clears the enter animation', () => {
    state.set('animations', { r1: { enter: { type: 'fade_in' } } }, false);
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="enter"][data-field="type"]')!;
    sel.value = '(none)';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.enter).toBeUndefined();
  });

  it('changing loop type stores animation in state', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="loop"][data-field="type"]')!;
    sel.value = 'float';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.loop?.type).toBe('float');
  });

  it('Add keyframe button adds a keyframe', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    container.querySelector<HTMLButtonElement>('.anim-add-kf')!.click();
    expect(state.get().animations['r1']?.keyframes?.length).toBe(1);
  });

  it('delete keyframe button removes it', () => {
    state.set('animations', { r1: { keyframes: [{ t: 0, opacity: 1 }, { t: 500, opacity: 0 }] } }, false);
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    container.querySelector<HTMLButtonElement>('.anim-kf-del')!.click();
    expect(state.get().animations['r1']?.keyframes?.length).toBe(1);
  });

  it('duration number input updates animation', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    // First set an enter type
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="enter"][data-field="type"]')!;
    sel.value = 'fade_in';
    sel.dispatchEvent(new Event('change'));
    // Then change duration
    const dur = container.querySelector<HTMLInputElement>('[data-kind="enter"][data-field="duration"]')!;
    dur.value = '800';
    dur.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.enter?.duration).toBe(800);
  });

  it('changing exit type stores animation in state (lines 189-191)', () => {
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="exit"][data-field="type"]')!;
    sel.value = 'fade_out';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.exit?.type).toBe('fade_out');
  });

  it('selecting (none) for exit clears exit animation (lines 187-188)', () => {
    state.set('animations', { r1: { exit: { type: 'fade_out' } } }, false);
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="exit"][data-field="type"]')!;
    sel.value = '(none)';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.exit).toBeUndefined();
  });

  it('selecting (none) for loop clears loop animation (line 195)', () => {
    state.set('animations', { r1: { loop: { type: 'float' } } }, false);
    state.set('design', makeDesign());
    state.set('selectedLayerIds', ['r1']);
    const sel = container.querySelector<HTMLSelectElement>('[data-kind="loop"][data-field="type"]')!;
    sel.value = '(none)';
    sel.dispatchEvent(new Event('change'));
    expect(state.get().animations['r1']?.loop).toBeUndefined();
  });
});
