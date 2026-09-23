import { describe, it, expect, vi, afterEach } from 'vitest';
import { SceneStage } from './scene-stage';
import { ScenePlayer, type SceneClock } from '../../editor/scene-player';
import type { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';
import { SceneAudio, type SoundOutput } from '../../editor/scene-audio';

const page = (id: string, fill: string, extra: object = {}): object => ({
  id, label: id.toUpperCase(), ...extra,
  layers: [{ id: `${id}_bg`, type: 'rect', z: 0, x: 0, y: 0, width: 400, height: 300, fill }],
});

const deck = (enter = 'fade'): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'carousel', created: '', modified: '' },
  document: { width: 400, height: 300, unit: 'px', dpi: 96 },
  pages: [page('a', '#FF0000', { auto_advance: 1000 }), page('b', '#0000FF', { auto_advance: 1000, transition: { type: enter, duration: 400 } })],
} as unknown as DesignSpec);

function setup(enter?: string): { stage: SceneStage; player: ScenePlayer; setPageScene: ReturnType<typeof vi.fn> } {
  const setPageScene = vi.fn();
  const state = {
    get: () => ({ design: deck(enter), currentPageIndex: 0 }),
    subscribe: () => () => undefined,
    setPageScene,
  } as unknown as StateManager;
  const clock: SceneClock = { now: () => 0, frame: () => 1, cancel: () => undefined };
  const player = new ScenePlayer(state, clock);
  return { stage: new SceneStage(state, player), player, setPageScene };
}

/** A deck with a 30s track under it, played through a fake audio clock that records starts and stops. */
function setupSound(): { stage: SceneStage; player: ScenePlayer; audio: SceneAudio; setAudioTracks: ReturnType<typeof vi.fn>; starts: number[][]; stops: () => number } {
  const setAudioTracks = vi.fn();
  const design = { ...deck(), audio: [{ id: 'bed', src: 'assets/audio/bed.mp3', volume: 0.8, fade_out: 500 }] } as DesignSpec;
  const state = { get: () => ({ design, currentPageIndex: 0 }), subscribe: () => () => undefined, setPageScene: vi.fn(), setAudioTracks } as unknown as StateManager;
  const player = new ScenePlayer(state, { now: () => 0, frame: () => 1, cancel: () => undefined });
  const starts: number[][] = [];
  let stopped = 0;
  const out = {
    currentTime: 0, destination: {},
    createGain: () => ({ gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined }, connect: () => undefined, disconnect: () => undefined }),
    createBufferSource: () => ({ connect: () => undefined, disconnect: () => undefined, start: (...a: number[]) => { starts.push(a); }, stop: () => { stopped++; } }),
    decodeAudioData: async () => ({ duration: 30 }),
    resume: async () => undefined,
  } as unknown as SoundOutput;
  const audio = new SceneAudio({ context: () => out, load: async () => new ArrayBuffer(8) });
  return { stage: new SceneStage(state, player, () => undefined, audio), player, audio, setAudioTracks, starts, stops: () => stopped };
}

const flush = (): Promise<void> => new Promise(res => { setTimeout(res, 0); });
const $ = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
/** The rendered frame lives in the stage's shadow root. */
const frameSvg = (): SVGSVGElement | null => $('.scene-stage-frame')?.shadowRoot?.querySelector('svg') ?? null;
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

afterEach(() => { document.body.innerHTML = ''; });

describe('SceneStage — Play all', () => {
  it('mounts a frame and a strip with one segment per scene, the transition hatched at its front', () => {
    const { stage } = setup();
    stage.open();
    expect(frameSvg()).not.toBeNull();
    const segs = document.querySelectorAll<HTMLElement>('.scene-stage-seg');
    expect(segs).toHaveLength(2);
    expect(segs[1].innerHTML).toContain('enters with fade, 400ms');
    expect($('.scene-stage-clock')?.textContent).toBe('0.0s / 2.0s');
    stage.close();
  });

  // Found live: the canvas's animation CSS sits in the document, keyed by layer id,
  // and replayed every entrance on the stage's frames from zero at each repaint.
  it('paints out of reach of the document CSS — the frame is in a shadow root, never in the page', () => {
    const style = document.createElement('style');
    style.textContent = '[data-layer-id="a_bg"] { animation: kf-a_bg 600ms both; }';
    document.head.appendChild(style);
    const { stage } = setup();
    stage.open();
    expect(document.querySelectorAll('[data-layer-id="a_bg"]')).toHaveLength(0);
    expect(frameSvg()?.querySelector('[data-layer-id="a_bg"]')).not.toBeNull();
    stage.close();
    style.remove();
  });

  it('shows both scenes on screen mid-transition', () => {
    const { stage, player } = setup();
    stage.open();
    player.seek(1200);
    const svg = frameSvg()?.outerHTML ?? '';
    expect(svg).toContain('__scene_from');
    expect(svg).toContain('__scene_to');
    stage.close();
  });

  it('turns a cube in CSS 3D: each scene flat on its face, captions over it unturned, on a stage', () => {
    const { stage, player } = setup('cube-left');
    stage.open();
    player.seek(1200);
    const root = $('.scene-stage-frame')?.shadowRoot;
    const svgs = Array.from(root?.querySelectorAll('svg') ?? []);
    expect(svgs).toHaveLength(3);
    expect(svgs.slice(0, 2).map(s => s.style.transform.slice(0, 9))).toEqual(['matrix3d(', 'matrix3d(']);
    expect(svgs[0]?.outerHTML).toContain('a_bg');
    expect(svgs[1]?.outerHTML).toContain('b_bg');
    expect(svgs[2]?.style.transform).toBe('none');
    expect(root?.innerHTML).not.toContain('__scene_from');
    player.seek(1900);
    expect(root?.querySelectorAll('svg')).toHaveLength(1);
    stage.close();
  });

  it('sets how a scene enters through state, and never on the first scene', () => {
    const { stage, player, setPageScene } = setup();
    stage.open();
    expect($<HTMLSelectElement>('.scene-stage-transition')?.disabled).toBe(true);
    player.seekScene(1);
    const select = $<HTMLSelectElement>('.scene-stage-transition');
    expect(select?.disabled).toBe(false);
    if (select) { select.value = 'slide-left'; select.dispatchEvent(new Event('change')); }
    expect(setPageScene).toHaveBeenCalledWith(1, { transition: { type: 'slide-left', duration: 400 } });
    stage.close();
  });

  it('takes Space before the editor shortcuts, and Escape closes', () => {
    const { stage, player } = setup();
    const editorShortcut = vi.fn();
    document.addEventListener('keydown', editorShortcut);
    stage.open();
    document.dispatchEvent(key(' '));
    expect(player.playing).toBe(true);
    expect(editorShortcut).not.toHaveBeenCalled();
    document.dispatchEvent(key('Escape'));
    expect($('.scene-stage')).toBeNull();
    expect(player.playing).toBe(false);
    document.removeEventListener('keydown', editorShortcut);
  });

  it('draws the soundtrack under the strip and plays it with the scenes, from wherever a seek lands', async () => {
    const { stage, player, starts, stops } = setupSound();
    stage.open();
    await flush();
    expect($<HTMLElement>('.scene-stage-sound')?.hidden).toBe(false);
    expect($<HTMLElement>('.scene-stage-sound-clip')?.title).toContain('assets/audio/bed.mp3 · 0.0s–2.0s');
    document.dispatchEvent(key(' '));
    expect(starts).toEqual([[0, 0, 2]]);
    player.seek(1500);
    expect(starts[1]).toEqual([0, 1.5, 0.5]);
    const before = stops();
    document.dispatchEvent(key(' '));
    expect(player.playing).toBe(false);
    expect(stops()).toBeGreaterThan(before);
    stage.close();
  });

  it('sets a track\'s volume through state, and mute silences a playing piece', async () => {
    const { stage, player, audio, setAudioTracks, starts, stops } = setupSound();
    stage.open();
    await flush();
    const volume = $<HTMLInputElement>('.scene-stage-volume');
    if (volume) { volume.value = '40'; volume.dispatchEvent(new Event('change')); }
    expect(setAudioTracks).toHaveBeenCalledWith([{ id: 'bed', src: 'assets/audio/bed.mp3', volume: 0.4, fade_out: 500 }]);
    player.play();
    const before = stops();
    $<HTMLButtonElement>('.scene-stage-mute')?.click();
    expect(audio.muted).toBe(true);
    expect(stops()).toBeGreaterThan(before);
    expect(starts).toHaveLength(1);
    stage.close();
  });

  it('shows no sound row for a design without sound', () => {
    const { stage } = setup();
    stage.open();
    expect($<HTMLElement>('.scene-stage-sound')?.hidden).toBe(true);
    stage.close();
  });
});
