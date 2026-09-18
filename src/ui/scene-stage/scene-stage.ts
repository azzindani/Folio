/**
 * Play all — a multi-page design played as one piece on a stage over the editor.
 *
 * Every frame is ScenePlayer.frameAt(t): the export's compositor sampling the
 * scene plan, so transitions play here exactly as they land in the gif/mp4. The
 * stage renders that frame through renderEntry, the canvas's own render path,
 * with the editor's composed theme — and never writes the design. The only
 * edits made from here are a scene's transition and length, through state.
 *
 * Frames paint inside a SHADOW ROOT. The canvas injects its animation CSS as a
 * <style> in its inline SVG, and a style there is global to the document: its
 * `[data-layer-id="…"]` rules grabbed the stage's layers (same ids) and replayed
 * every entrance from zero on each repaint. Live, the stage at 21.8s showed the
 * promo's motion scene unmorphed, unframed and half invisible; the export was
 * right. Document styles cannot reach into a shadow tree; web fonts still do.
 */

import type { StateManager } from '../../editor/state';
import type { ScenePlayer, ScenePlayerSnapshot } from '../../editor/scene-player';
import { renderEntry } from '../../renderer/render-entry';
import { composeTheme } from '../../styles/compose';
import { buildTransport, type Transport } from './scene-stage-controls';
import { SceneAudio } from '../../editor/scene-audio';
import { resolveAssetUrl } from '../../renderer/render-context';
import { buildSoundRow, designSoundSources, type SoundRow } from './scene-stage-sound';

const TYPING = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export class SceneStage {
  private overlay: HTMLElement | null = null;
  private surface: ShadowRoot | null = null;
  private transport: Transport | null = null;
  private stopListening: Array<() => void> = [];
  private painted: number | null = null;
  private audio: SceneAudio;
  private sound: SoundRow | null = null;
  /** Whether the sound was last told to play — it follows the transport's edges, not every tick. */
  private soundPlaying = false;

  constructor(private state: StateManager, private player: ScenePlayer, private beforeOpen: () => void = () => undefined, audio?: SceneAudio) {
    this.audio = audio ?? new SceneAudio({
      context: () => new AudioContext(),
      load: src => fetch(resolveAssetUrl(src), { credentials: 'include' })
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      onChange: () => { this.sound?.redraw(); this.restartSound(); },
    });
  }

  get isOpen(): boolean { return this.overlay !== null; }

  /** Open the stage; `fromCurrentPage` starts at the scene being edited. */
  open(opts: { play?: boolean; fromCurrentPage?: boolean } = {}): void {
    if (this.overlay || !this.player.plan()) return;
    // A per-page preview writes its pose into state; stop it so no posed layer leaks into a scene frame.
    this.beforeOpen();
    const { overlay, surface } = this.buildOverlay();
    this.overlay = overlay;
    this.surface = surface;
    this.transport = buildTransport(this.state, this.player, () => this.close());
    overlay.appendChild(this.transport.element);
    this.sound = buildSoundRow(this.state, this.player, this.audio, () => this.restartSound());
    this.transport.element.appendChild(this.sound.element);
    document.body.appendChild(overlay);
    this.audio.preload(designSoundSources(this.state.get().design));

    const unsubPlayer = this.player.subscribe(s => this.paint(s));
    // An edit made on the stage (a transition, a length, a volume) must show — and sound — at the same t.
    const unsubState = this.state.subscribe(() => {
      this.painted = null;
      this.sound?.redraw();
      this.restartSound();
      this.paint(this.player.snapshot());
    });
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    document.addEventListener('keydown', onKey, true);
    this.stopListening = [unsubPlayer, unsubState, () => document.removeEventListener('keydown', onKey, true)];

    if (opts.fromCurrentPage) this.player.seekScene(this.state.get().currentPageIndex);
    else this.player.seek(0);
    this.paint(this.player.snapshot());
    if (opts.play) this.player.play();
  }

  close(): void {
    if (!this.overlay) return;
    this.player.pause();
    for (const stop of this.stopListening) stop();
    this.stopListening = [];
    this.audio.stop();
    this.soundPlaying = false;
    this.overlay.remove();
    this.overlay = null;
    this.surface = null;
    this.transport = null;
    this.sound = null;
    this.painted = null;
  }

  /** Sound follows the transport: it starts on play (and on the play a seek makes) and stops on pause. */
  private syncSound(s: ScenePlayerSnapshot): void {
    if (s.playing === this.soundPlaying) return;
    this.soundPlaying = s.playing;
    if (s.playing) this.startSound(s.time);
    else this.audio.stop();
  }

  private startSound(t: number): void {
    const design = this.state.get().design;
    const plan = this.player.plan();
    if (design && plan) this.audio.start(this.audio.plan(design, plan), t);
  }

  /** After an edit, a finished decode or a mute switch: sound again from where the piece is. */
  private restartSound(): void {
    if (this.overlay && this.player.playing) this.startSound(this.player.time);
    else this.audio.stop();
  }

  private buildOverlay(): { overlay: HTMLElement; surface: ShadowRoot } {
    const { width, height } = this.state.get().design?.document ?? { width: 1920, height: 1080 };
    const overlay = document.createElement('div');
    overlay.className = 'scene-stage';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Play all scenes');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:#0B0B0C;';
    const well = document.createElement('div');
    const pad = window.innerWidth < 768 ? 10 : 24;
    well.style.cssText = `flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:${pad}px;`;
    const frame = document.createElement('div');
    frame.className = 'scene-stage-frame';
    frame.style.cssText = 'background:#FFFFFF;overflow:hidden;';

    // MEASURED, not `aspect-ratio + height:100% + max-width:100%`. That trio
    // does not fit a box: max-width clamps the width while the height stays at
    // 100%, so on a phone a 4:5 deck was framed 342×578 — a white card taller
    // than the design, with white bands above and below every scene. The SVG
    // letterboxes inside the frame correctly; the frame itself was the wrong
    // shape. Two numbers from the well's own box get it right at any size.
    const fit = (): void => {
      const availW = Math.max(1, well.clientWidth - pad * 2);
      const availH = Math.max(1, well.clientHeight - pad * 2);
      const scale = Math.min(availW / width, availH / height);
      frame.style.width = `${Math.round(width * scale)}px`;
      frame.style.height = `${Math.round(height * scale)}px`;
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(well);
    window.addEventListener('resize', fit);
    queueMicrotask(fit);

    well.appendChild(frame);
    overlay.appendChild(well);
    return { overlay, surface: frame.attachShadow({ mode: 'open' }) };
  }

  private paint(s: ScenePlayerSnapshot): void {
    this.syncSound(s);
    this.transport?.update(s);
    if (!this.surface || this.painted === s.time) return;
    const spec = this.player.frameAt(s.time);
    if (!spec) return;
    const { theme, palette, typePack, effectsPack } = this.state.get();
    const composed = theme
      ? composeTheme(theme, { palette: palette ?? undefined, typePack: typePack ?? undefined, effectsPack: effectsPack ?? undefined })
      : undefined;
    const { svg } = renderEntry(spec, { theme: composed, pageIndex: 0 });
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.display = 'block';
    this.surface.replaceChildren(svg);
    this.painted = s.time;
  }

  private onKey(e: KeyboardEvent): void {
    if (TYPING.has((e.target as HTMLElement | null)?.tagName ?? '')) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const scene = this.player.sceneIndexAt();
    const handled: Record<string, () => void> = {
      ' ': () => this.player.toggle(),
      Escape: () => this.close(),
      ArrowRight: () => this.player.seekScene(scene + 1),
      ArrowLeft: () => this.player.seekScene(Math.max(0, scene - 1)),
      Home: () => this.player.seek(0),
    };
    const run = handled[e.key];
    if (!run) return;
    // Captured, so the editor's own Space (the per-page player) never fires underneath.
    e.preventDefault();
    e.stopPropagation();
    run();
  }
}
