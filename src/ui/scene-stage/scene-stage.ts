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

const TYPING = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export class SceneStage {
  private overlay: HTMLElement | null = null;
  private surface: ShadowRoot | null = null;
  private transport: Transport | null = null;
  private stopListening: Array<() => void> = [];
  private painted: number | null = null;

  constructor(private state: StateManager, private player: ScenePlayer, private beforeOpen: () => void = () => undefined) {}

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
    document.body.appendChild(overlay);

    const unsubPlayer = this.player.subscribe(s => this.paint(s));
    // An edit made on the stage (a transition, a length) must show at the same t.
    const unsubState = this.state.subscribe(() => { this.painted = null; this.paint(this.player.snapshot()); });
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
    this.overlay.remove();
    this.overlay = null;
    this.surface = null;
    this.transport = null;
    this.painted = null;
  }

  private buildOverlay(): { overlay: HTMLElement; surface: ShadowRoot } {
    const { width, height } = this.state.get().design?.document ?? { width: 1920, height: 1080 };
    const overlay = document.createElement('div');
    overlay.className = 'scene-stage';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Play all scenes');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:#0B0B0C;';
    const well = document.createElement('div');
    well.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;';
    const frame = document.createElement('div');
    frame.className = 'scene-stage-frame';
    frame.style.cssText = `aspect-ratio:${width} / ${height};height:100%;max-width:100%;background:#FFFFFF;overflow:hidden;`;
    well.appendChild(frame);
    overlay.appendChild(well);
    return { overlay, surface: frame.attachShadow({ mode: 'open' }) };
  }

  private paint(s: ScenePlayerSnapshot): void {
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
