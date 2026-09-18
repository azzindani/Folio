import type { StateManager, EditorState } from '../../editor/state';
import { poseAt } from '../../animation/keyframe-css';
import { EASING_NAMES } from '../../animation/easing';
import { easingCurveSVG } from './easing-curve';
import type { Layer } from '../../schema/types';
import { MotionPlayer } from '../../editor/motion-player';
import type { AnimationSpec, Keyframe } from '../../animation/types';
import { fromSceneTime } from '../../animation/clock-time';
import { trackHTML, markerStripHTML, markersOf, fmtMs, HEADER_W, KF_RADIUS } from './timeline-track-view';

export { fmtMs };

// ── Pure-function API (used by MCP engine + tests) ───────────

export interface TimelineTrack {
  layerId: string;
  layerName: string;
  keyframes: Keyframe[];
  duration: number;
}

export interface TimelineState {
  currentTime: number;   // ms
  duration: number;      // ms
  playing: boolean;
  tracks: TimelineTrack[];
}

/**
 * Every layer in the tree, depth first — with the layers that CARRY motion
 * first, and their nesting depth alongside.
 *
 * The timeline panel used to read `state.getCurrentLayers()`, which is
 * top-level only. Every MCP-authored design is ONE group (state.ts says so
 * itself, in the comment above `findLayer`), and `animation(op:sequence)` writes
 * its keyframes onto that group's CHILDREN — so the studio timeline was empty
 * for every design the engine produces, and exporting an HTML file was the only
 * way to watch a scene play. The write path (`state.updateLayer`) already
 * recursed; only the read path did not.
 */
export function flattenForTimeline(layers: Layer[], depth = 0): Array<{ layer: Layer; depth: number }> {
  const out: Array<{ layer: Layer; depth: number }> = [];
  for (const l of layers ?? []) {
    if (!l || typeof l !== 'object') continue;
    out.push({ layer: l, depth });
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) out.push(...flattenForTimeline(kids, depth + 1));
  }
  return out;
}

/**
 * A layer that plays in time: it has keyframes, travels a motion path, lives
 * in an in/out window, or follows another layer. A continuous composition's
 * link followers and windowed titles own no keyframes and were missing from
 * the timeline and from the player.
 */
export function playsInTime(l: Layer): boolean {
  const o = l as unknown as Record<string, unknown>;
  return (l.animation?.keyframes ?? []).length > 0 || Boolean(o['motion_path']) || Boolean(o['link'])
    || typeof o['in'] === 'number' || typeof o['out'] === 'number';
}
const hasMotion = playsInTime;

/**
 * What the timeline should show, given the current selection.
 *
 * No selection → the animated layers, wherever they live. That is the case the
 * panel got wrong: a design with a full scene on it showed nothing at all.
 * Nothing animated yet → the top level, so a layer can still be picked up and
 * given its first keyframe. A selection always wins, at any depth.
 */
export function timelineRows(layers: Layer[], selectedIds: string[]): Array<{ layer: Layer; depth: number }> {
  const all = flattenForTimeline(layers ?? []);
  if (selectedIds.length) return all.filter(r => selectedIds.includes(r.layer.id));
  const animated = all.filter(r => hasMotion(r.layer));
  return animated.length ? animated : all.filter(r => r.depth === 0);
}

/**
 * The scene's own length: the last keyframe of any animated layer, or the
 * last out point. A rough cut for before the sampler loads — the player then
 * uses the export's own clip length (animationDuration over the resolved tree).
 */
export function sceneDuration(layers: Layer[], fallback = 2000): number {
  let end = 0;
  for (const { layer } of flattenForTimeline(layers ?? [])) {
    const kfs = layer.animation?.keyframes ?? [];
    const delay = Number(layer.animation?.playback?.delay ?? 0) || 0;
    for (const kf of kfs) end = Math.max(end, delay + (Number(kf.t) || 0));
    const out = (layer as unknown as Record<string, unknown>)['out'];
    if (typeof out === 'number' && Number.isFinite(out)) end = Math.max(end, out);
  }
  return end > 0 ? Math.ceil(end) : fallback;
}

/** Build timeline tracks from layer list. */
export function buildTimelineTracks(
  layers: { id: string; label?: string; animation?: AnimationSpec }[],
): TimelineTrack[] {
  return layers
    .filter(l => l.animation?.keyframes !== undefined && (l.animation.keyframes ?? []).length > 0)
    .map(l => ({
      layerId: l.id,
      layerName: l.label ?? l.id,
      keyframes: l.animation!.keyframes!,
      duration: l.animation!.playback?.duration ?? 1000,
    }));
}

/** Get interpolated layer values at a given time. */
/**
 * The pose at time t — delegated to the ENGINE's sampler, not re-implemented.
 *
 * This used to lerp x/y/scale/rotation/opacity by hand and ignore `easing`
 * entirely, so the panel's scrubber disagreed with both the CSS player and the
 * exported frames: a keyframe eased "bounce" moved linearly here, and
 * skew/blur/draw/scale_x/scale_y did not move at all because the function had
 * no branch for them. poseAt is what the flipbook and the CSS route already
 * use, so using it is what makes the three agree.
 *
 * Signature kept: callers pass keyframes and a duration, and get the subset of
 * channels that actually differ from rest, which is what the panel displays.
 */
export function interpolateAtTime(
  keyframes: Keyframe[],
  t: number,
  duration: number,
): Partial<Keyframe> {
  if (keyframes.length === 0) return {};
  const clampedT = Math.max(0, Math.min(duration, t));
  const pose = poseAt({ keyframes, playback: { duration } } as unknown as AnimationSpec, clampedT);
  // Report the channels the keyframes actually USE. Filtering by "differs from
  // rest" instead would drop a deliberate opacity of 1 at the end of a fade,
  // which is exactly the value a caller asks for when it asks for the pose.
  const used = new Set<string>();
  for (const kf of keyframes) {
    for (const [k, v] of Object.entries(kf)) if (k !== 't' && typeof v === 'number') used.add(k);
  }
  const out: Partial<Keyframe> = { t: clampedT };
  for (const [k, v] of Object.entries(pose)) {
    if (used.has(k) && typeof v === 'number') (out as Record<string, number>)[k] = v;
  }
  return out;
}


/**
 * The layer fields a pose maps onto, for a live scrub preview.
 *
 * Kept pure and exported so the mapping is testable without a DOM: the panel
 * only decides WHEN to apply it. x/y are offsets from the authored position —
 * the same convention the flipbook uses — so a preview and an exported frame
 * put the layer in the same place.
 */
export function poseToLayerUpdate(base: Layer, pose: Partial<Keyframe>): Partial<Layer> {
  const b = base as unknown as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const p = pose as unknown as Record<string, number | undefined>;
  const out: Record<string, unknown> = {};
  if (p['x'] !== undefined) out['x'] = (n(b['x']) ?? 0) + p['x'];
  if (p['y'] !== undefined) out['y'] = (n(b['y']) ?? 0) + p['y'];
  if (p['opacity'] !== undefined) out['opacity'] = p['opacity'];
  if (p['rotation'] !== undefined) out['rotation'] = (n(b['rotation']) ?? 0) + p['rotation'];
  const sx = p['skew_x'] ?? 0, sy = p['skew_y'] ?? 0;
  if (sx !== 0 || sy !== 0) {
    const cx = (n(b['x']) ?? 0) + (n(b['width']) ?? 0) / 2;
    const cy = (n(b['y']) ?? 0) + (n(b['height']) ?? 0) / 2;
    out['transform'] = `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) skewX(${sx.toFixed(3)}) skewY(${sy.toFixed(3)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
  }
  if (p['blur'] !== undefined && p['blur'] > 0) {
    const fx = (b['effects'] ?? {}) as Record<string, unknown>;
    out['effects'] = { ...fx, blur: p['blur'] };
  }
  return out as Partial<Layer>;
}

/** Render ASCII timeline preview (for MCP output). */
export function renderTimelineASCII(tracks: TimelineTrack[], width = 60): string {
  if (tracks.length === 0) return '(no animated layers)';
  const maxDuration = Math.max(...tracks.map(t => t.duration));
  const lines: string[] = [`Timeline (${maxDuration}ms)`, '─'.repeat(width)];

  for (const track of tracks) {
    const bar = Array<string>(width).fill('·');
    for (const kf of track.keyframes) {
      const pos = Math.min(width - 1, Math.round(((kf.t ?? 0) / maxDuration) * (width - 1)));
      bar[pos] = '◆';
    }
    const label = (track.layerName + ' ').padEnd(12).slice(0, 12);
    lines.push(`${label}|${bar.join('')}|`);
  }
  lines.push('─'.repeat(width));
  return lines.join('\n');
}

/** Add or replace a keyframe in an AnimationSpec (immutable). */
export function addKeyframe(anim: AnimationSpec, kf: Keyframe): AnimationSpec {
  const existing = anim.keyframes ?? [];
  const merged = [...existing.filter(k => k.t !== kf.t), kf].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return { ...anim, keyframes: merged };
}

/** Remove a keyframe at a given time (immutable). */
export function removeKeyframe(anim: AnimationSpec, t: number): AnimationSpec {
  return { ...anim, keyframes: (anim.keyframes ?? []).filter(k => k.t !== t) };
}

/**
 * Set the easing ON ONE keyframe — the curve from THAT keyframe to the next.
 *
 * Per-keyframe, not per-track: the engine reads `easing` off the keyframe a
 * segment starts at, so setting it on the last one changes nothing and setting
 * it on the track would flatten a sequence that deliberately eases differently
 * on the way in and on the way out. `''` clears it back to the track default.
 */
export function setKeyframeEasing(anim: AnimationSpec, t: number, easing: string): AnimationSpec {
  return {
    ...anim,
    keyframes: (anim.keyframes ?? []).map(k => {
      if (k.t !== t) return k;
      const next = { ...k } as Record<string, unknown>;
      if (easing) next['easing'] = easing; else delete next['easing'];
      return next as Keyframe;
    }),
  };
}

/**
 * Shift every keyframe later by `delayMs` — the panel's `op:sequence`.
 *
 * A sequence is layers doing the same thing at staggered starts, so applied
 * across a selection with an increasing delay per layer it IS the stagger.
 * Negative delays clamp at zero rather than running before the scene starts,
 * which would silently drop the head of the animation.
 */
export function shiftKeyframes(anim: AnimationSpec, delayMs: number): AnimationSpec {
  return {
    ...anim,
    keyframes: (anim.keyframes ?? [])
      .map(k => ({ ...k, t: Math.max(0, k.t + delayMs) }))
      .sort((a, b) => a.t - b.t),
  };
}

export class TimelinePanelManager {
  private container: HTMLElement;
  private state: StateManager;
  /** Authored values captured before a scrub, restored when it stops. */
  private duration = 2000;
  /** The user typed a duration — stop fitting the ruler to the scene. */
  private durationPinned = false;
  private scrubMs = 0;
  private player: MotionPlayer;
  /** Whether the last render had the resolved rows, or fell back to raw keyframe times. */
  private drawnWithRows = false;
  /** Set by the app so the checkbox can reach the canvas. */
  onTrailsToggle?: (on: boolean) => void;

  constructor(container: HTMLElement, state: StateManager, player?: MotionPlayer) {
    this.container = container;
    this.state = state;
    // The panel no longer owns playback — the canvas toolbar drives the same
    // player, and two implementations of "play" is the failure this codebase
    // keeps rediscovering.
    this.player = player ?? new MotionPlayer(state);
    this.build();
    state.subscribe(this.onStateChange.bind(this));
    this.player.subscribe(s => {
      // The sampler loads after the panel: redraw once, so rows move onto the scene clock.
      if ((this.player.rows() !== null) !== this.drawnWithRows) this.render();
      this.scrubMs = s.time;
      const tc = this.container.querySelector<HTMLElement>('#tl-timecode');
      if (tc) tc.textContent = fmtMs(s.time);
      const thumb = this.container.querySelector<HTMLElement>('.tl-scrub-thumb');
      if (thumb) thumb.style.left = `${(s.time / Math.max(1, s.duration)) * 100}%`;
      const pb = this.container.querySelector<HTMLButtonElement>('#tl-play');
      if (pb) pb.textContent = s.playing ? '⏸' : '▶';
    });
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    // A playback frame is written into the design; the rows it would redraw have not changed.
    if (this.player.posing) return;
    if (keys.includes('selectedLayerIds') || keys.includes('design') || keys.includes('currentPageIndex')) {
      this.render();
    }
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="timeline-panel">
        <div class="timeline-toolbar">
          <button class="btn btn-sm" id="tl-play">▶</button>
          <button class="btn btn-sm" id="tl-stop">■</button>
          <label style="font-size:11px;color:var(--color-text-muted);margin-left:8px">
            Duration
            <input id="tl-duration" type="number" min="100" max="30000" step="100"
              value="${this.duration}"
              style="width:70px;margin-left:4px;background:var(--color-bg);border:1px solid var(--color-border);
                     border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
            ms
          </label>
          <label style="font-size:11px;color:var(--color-text-muted);margin-left:8px"
                 title="Offset each SELECTED layer's keyframes by this much more than the one before — the panel's op:sequence.">
            Stagger
            <input id="tl-stagger" type="number" min="0" max="5000" step="10" value="80"
              style="width:60px;margin-left:4px;background:var(--color-bg);border:1px solid var(--color-border);
                     border-radius:3px;padding:2px 4px;color:var(--color-text);font-size:11px">
            ms
          </label>
          <button class="btn btn-sm" id="tl-stagger-apply" style="margin-left:4px">Stagger</button>
          <label style="font-size:11px;color:var(--color-text-muted);margin-left:10px;display:flex;align-items:center;gap:4px;cursor:pointer"
                 title="Draw each animated layer's path on the canvas — spacing shows the easing.">
            <input id="tl-trails" type="checkbox"> Trails
          </label>
          <span id="tl-timecode" style="font-size:11px;font-family:var(--font-mono);
                color:var(--color-text-muted);margin-left:auto">${fmtMs(this.scrubMs)}</span>
        </div>
        <div class="timeline-body" id="tl-body"></div>
      </div>`;
    this.bindToolbar();
    this.render();
  }

  private bindToolbar(): void {
    const playBtn  = this.container.querySelector<HTMLButtonElement>('#tl-play')!;
    const stopBtn  = this.container.querySelector<HTMLButtonElement>('#tl-stop')!;
    const durInput = this.container.querySelector<HTMLInputElement>('#tl-duration')!;

    playBtn.addEventListener('click', () => {
      this.player.toggle();
      playBtn.textContent = this.player.playing ? '⏸' : '▶';
    });
    stopBtn.addEventListener('click', () => {
      this.player.stop();
      playBtn.textContent = '▶';
    });
    const trails = this.container.querySelector<HTMLInputElement>('#tl-trails');
    trails?.addEventListener('change', () => {
      this.onTrailsToggle?.(trails.checked);
    });

    durInput.addEventListener('change', () => {
      this.duration = Math.max(100, parseFloat(durInput.value) || 2000);
      this.durationPinned = true;
      this.player.pinDuration(this.duration);
      this.render();
    });
  }

  render(): void {
    const body = this.container.querySelector<HTMLElement>('#tl-body');
    if (!body) return;

    const { selectedLayerIds, design, currentPageIndex } = this.state.get();
    // The AUTHORED tree: while a frame is posed, the state holds that frame.
    const authored = this.player.authoredLayers();
    const rows = timelineRows(authored, selectedLayerIds);
    const layers = rows.map(r => r.layer);
    const timing = this.player.rows();
    this.drawnWithRows = timing !== null;

    if (layers.length === 0) {
      body.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--color-text-muted)">
        Select layers to edit their animation.</div>`;
      return;
    }

    // Fit the ruler to the scene unless the user has typed a duration. A scene
    // written by animation(op:sequence) is routinely longer than the old 2000ms
    // default, so play stopped a third of the way through it. The player's
    // length is the export's: windows, loops and precomp clocks included.
    if (!this.durationPinned) {
      const scene = this.player.duration;
      if (scene !== this.duration) {
        this.duration = scene;
        const durInput = this.container.querySelector<HTMLInputElement>('#tl-duration');
        if (durInput) durInput.value = String(scene);
      }
    }

    const trackAreaW = body.clientWidth - HEADER_W || 400;

    body.innerHTML = markerStripHTML(markersOf(design, currentPageIndex), this.duration)
      + rows.map(r => trackHTML(r.layer, timing?.get(r.layer.id), this.duration, r.depth)).join('');

    // Scrubber
    body.insertAdjacentHTML('beforeend', `
      <div class="tl-scrubber-row" style="display:flex">
        <div style="width:${HEADER_W}px;flex-shrink:0"></div>
        <div class="tl-scrub-area" style="flex:1;height:8px;position:relative;background:var(--color-surface-3);
             border-radius:4px;cursor:pointer;margin:4px 8px">
          <div class="tl-scrub-thumb" style="position:absolute;width:2px;background:var(--color-accent);
               height:100%;left:${(this.scrubMs / this.duration) * 100}%;top:0"></div>
        </div>
      </div>`);

    this.bindTracks(body, layers, trackAreaW);
  }

  private bindTracks(body: HTMLElement, layers: Layer[], trackAreaW: number): void {
    // Click track area to add a keyframe — at the SCENE time clicked, written
    // in the track's own time (its delay and any precomp clocks taken off).
    body.querySelectorAll<HTMLElement>('.tl-track-area').forEach(area => {
      const layerId = area.dataset['layerId'] ?? '';
      area.addEventListener('click', (e) => {
        const rect = area.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.addKeyframe(layerId, this.localTime(layerId, pct * this.duration, layers), layers);
      });
    });

    body.querySelectorAll<HTMLElement>('.tl-marker').forEach(m => {
      m.addEventListener('click', (e) => {
        e.stopPropagation();
        this.scrubTo(Number(m.dataset['ms'] ?? 0));
      });
    });

    // Left-click a diamond opens the easing picker for THAT keyframe. The
    // click must not reach the track area underneath, which would read it as
    // "add a keyframe here" and drop a second one on top of this one.
    body.querySelectorAll<HTMLElement>('.tl-keyframe').forEach(kfEl => {
      kfEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openEasingPicker(kfEl, layers);
      });
    });

    // Right-click keyframe diamond to delete
    body.querySelectorAll<HTMLElement>('.tl-keyframe').forEach(kfEl => {
      kfEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const layerId = kfEl.dataset.layerId!;
        const t = parseInt(kfEl.dataset.t!);
        this.removeKeyframe(layerId, t, layers);
      });
    });

    const stagger = this.container.querySelector<HTMLElement>('#tl-stagger-apply');
    if (stagger) stagger.addEventListener('click', () => this.applyStagger());

    // Scrubber click
    const scrub = body.querySelector<HTMLElement>('.tl-scrub-area');
    if (scrub) {
      scrub.addEventListener('click', (e) => {
        const rect = scrub.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.scrubTo(Math.round(pct * this.duration));
      });
    }

    void trackAreaW;
  }

  /**
   * A `<select>` of every easing the engine knows, on the keyframe clicked.
   *
   * A select rather than a custom menu: thirty curves is too many to lay out
   * by hand, and the native control already scrolls, keyboard-navigates and
   * closes itself. Removed as soon as it commits so the track does not collect
   * dead controls.
   */
  private openEasingPicker(kfEl: HTMLElement, layers: Layer[]): void {
    this.container.querySelectorAll('.tl-ease-picker').forEach(n => n.remove());
    const layerId = kfEl.dataset['layerId'] ?? '';
    const t = parseInt(kfEl.dataset['t'] ?? '0', 10);
    const current = kfEl.dataset['easing'] ?? '';

    const sel = document.createElement('select');
    sel.className = 'tl-ease-picker';
    sel.setAttribute('data-layer-id', layerId);
    sel.style.cssText = 'position:absolute;z-index:20;font-size:11px;background:var(--color-bg);'
      + 'color:var(--color-text);border:1px solid var(--color-border);border-radius:3px;'
      + `left:${kfEl.offsetLeft}px;top:${kfEl.offsetTop + KF_RADIUS * 2 + 2}px`;
    const opts = ['', ...EASING_NAMES];
    sel.innerHTML = opts.map(n =>
      `<option value="${n}"${n === current ? ' selected' : ''}>${n || '(track default)'}</option>`).join('');

    // WRITE FIRST, tear down second. Blur can fire before change (it does in a
    // scripted selection), which detached the node, and removing it again threw
    // NotFoundError from inside commit — before the state update ran. The
    // picker looked like it worked and the easing never left the DOM.
    let done = false;
    const close = (): void => { if (sel.parentNode) sel.parentNode.removeChild(sel); };
    const commit = (): void => {
      if (done) return;
      done = true;
      const value = sel.value;
      const layer = layers.find(l => l.id === layerId);
      if (layer?.animation) {
        this.state.updateLayer(layerId, { animation: setKeyframeEasing(layer.animation, t, value) } as Partial<Layer>);
      }
      close();
    };
    // Show the curve for whatever is highlighted. Thirty names in a dropdown
    // cannot distinguish "ease-out-back" from "ease-out-expo"; the shape can,
    // and the shape is the reason to pick one.
    const preview = document.createElement('div');
    preview.className = 'tl-ease-curve';
    preview.style.cssText = 'position:absolute;z-index:21;pointer-events:none;'
      + `left:${kfEl.offsetLeft}px;top:${kfEl.offsetTop + KF_RADIUS * 2 + 26}px`;
    const paint = (): void => { preview.innerHTML = easingCurveSVG(sel.value); };
    paint();
    sel.addEventListener('input', paint);
    sel.addEventListener('keyup', paint);

    const teardown = (): void => { if (preview.parentNode) preview.parentNode.removeChild(preview); close(); };
    sel.addEventListener('change', () => { commit(); if (preview.parentNode) preview.parentNode.removeChild(preview); });
    // A blur with no choice made is a cancel, not a commit.
    sel.addEventListener('blur', () => { if (!done) teardown(); });
    const host = kfEl.parentElement ?? this.container;
    host.appendChild(sel);
    host.appendChild(preview);
    sel.focus();
  }

  /**
   * Stagger the SELECTED layers — the panel's op:sequence.
   *
   * Each selected layer is shifted by one more step than the one before, in
   * the order they are selected, so a row of items animates in sequence rather
   * than all at once. Layers with no keyframes are skipped: shifting nothing
   * is not an error, but silently counting them would put a gap in the run.
   */
  private applyStagger(): void {
    const step = parseInt(
      this.container.querySelector<HTMLInputElement>('#tl-stagger')?.value ?? '0', 10);
    if (!Number.isFinite(step) || step === 0) return;
    const { selectedLayerIds } = this.state.get();
    const layers = this.state.getCurrentLayers() as Layer[];
    let i = 0;
    for (const id of selectedLayerIds) {
      const layer = layers.find(l => l.id === id);
      if (!layer?.animation?.keyframes?.length) continue;
      this.state.updateLayer(id, { animation: shiftKeyframes(layer.animation, step * i) } as Partial<Layer>);
      i++;
    }
  }

  /** A scene time on a layer's ruler as the keyframe `t` to write: precomp clocks undone, then the track's delay. */
  private localTime(layerId: string, scene: number, layers: Layer[]): number {
    const clocks = this.player.rows()?.get(layerId)?.clocks ?? [];
    const anim = layers.find(l => l.id === layerId)?.animation;
    const kfs = anim?.keyframes ?? [];
    const first = kfs.length ? Math.min(...kfs.map(k => k.t)) : 0;
    const delay = Number(anim?.playback?.delay ?? 0) || 0;
    return Math.max(0, Math.round(fromSceneTime(scene, clocks) - delay + first));
  }

  private addKeyframe(layerId: string, t: number, layers: Layer[]): void {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    const existing = (layer.animation?.keyframes ?? []) as Keyframe[];
    if (existing.some(kf => kf.t === t)) return;

    // Snapshot current layer position/opacity at this time
    const kf: Keyframe = {
      t,
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      opacity: layer.opacity ?? 1,
      rotation: layer.rotation ?? 0,
    };

    const keyframes = [...existing, kf].sort((a, b) => a.t - b.t);
    this.state.updateLayer(layerId, {
      animation: { ...(layer.animation ?? {}), keyframes },
    } as Partial<Layer>);
  }

  private removeKeyframe(layerId: string, t: number, layers: Layer[]): void {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    const keyframes = ((layer.animation?.keyframes ?? []) as Keyframe[]).filter(kf => kf.t !== t);
    this.state.updateLayer(layerId, {
      animation: { ...(layer.animation ?? {}), keyframes },
    } as Partial<Layer>);
  }

  private scrubTo(ms: number): void {
    this.scrubMs = Math.max(0, Math.min(this.duration, ms));
    const timecode = this.container.querySelector<HTMLElement>('#tl-timecode');
    if (timecode) timecode.textContent = fmtMs(this.scrubMs);
    const thumb = this.container.querySelector<HTMLElement>('.tl-scrub-thumb');
    if (thumb) thumb.style.left = `${(this.scrubMs / this.duration) * 100}%`;
    this.player.seek(this.scrubMs);
  }
}
