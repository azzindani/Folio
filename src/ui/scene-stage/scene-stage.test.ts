import { describe, it, expect, vi, afterEach } from 'vitest';
import { SceneStage } from './scene-stage';
import { ScenePlayer, type SceneClock } from '../../editor/scene-player';
import type { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

const page = (id: string, fill: string, extra: object = {}): object => ({
  id, label: id.toUpperCase(), ...extra,
  layers: [{ id: `${id}_bg`, type: 'rect', z: 0, x: 0, y: 0, width: 400, height: 300, fill }],
});

const deck = (): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'carousel', created: '', modified: '' },
  document: { width: 400, height: 300, unit: 'px', dpi: 96 },
  pages: [page('a', '#FF0000', { auto_advance: 1000 }), page('b', '#0000FF', { auto_advance: 1000, transition: { type: 'fade', duration: 400 } })],
} as unknown as DesignSpec);

function setup(): { stage: SceneStage; player: ScenePlayer; setPageScene: ReturnType<typeof vi.fn> } {
  const setPageScene = vi.fn();
  const state = {
    get: () => ({ design: deck(), currentPageIndex: 0 }),
    subscribe: () => () => undefined,
    setPageScene,
  } as unknown as StateManager;
  const clock: SceneClock = { now: () => 0, frame: () => 1, cancel: () => undefined };
  const player = new ScenePlayer(state, clock);
  return { stage: new SceneStage(state, player), player, setPageScene };
}

const $ = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

afterEach(() => { document.body.innerHTML = ''; });

describe('SceneStage — Play all', () => {
  it('mounts a frame and a strip with one segment per scene, the transition hatched at its front', () => {
    const { stage } = setup();
    stage.open();
    expect($('.scene-stage-frame svg')).not.toBeNull();
    const segs = document.querySelectorAll<HTMLElement>('.scene-stage-seg');
    expect(segs).toHaveLength(2);
    expect(segs[1].innerHTML).toContain('enters with fade, 400ms');
    expect($('.scene-stage-clock')?.textContent).toBe('0.0s / 2.0s');
    stage.close();
  });

  it('shows both scenes on screen mid-transition', () => {
    const { stage, player } = setup();
    stage.open();
    player.seek(1200);
    const svg = $('.scene-stage-frame svg')?.outerHTML ?? '';
    expect(svg).toContain('__scene_from');
    expect(svg).toContain('__scene_to');
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
});
