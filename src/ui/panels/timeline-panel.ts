import type { StateManager, EditorState } from '../../editor/state';
import { poseAt } from '../../animation/keyframe-css';
import { EASING_NAMES } from '../../animation/easing';
import { easingCurveSVG } from './easing-curve';
import type { Layer } from '../../schema/types';
import { MotionPlayer } from '../../editor/motion-player';
import type { AnimationSpec, Keyframe } from '../../animation/types';

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

const hasMotion = (l: Layer): boolean => ((l.animation?.keyframes ?? []).length > 0);

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

/** The scene's own length: the last keyframe of any animated layer. */
export function sceneDuration(layers: Layer[], fallback = 2000): number {
  let end = 0;
  for (const { layer } of flattenForTimeline(layers ?? [])) {
    const kfs = layer.animation?.keyframes ?? [];
    const delay = Number(layer.animation?.playback?.delay ?? 0) || 0;
    for (const kf of kfs) end = Math.max(end, delay + (Number(kf.t) || 0));
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

const TRACK_H = 32;       // px per track row
const HEADER_W = 120;     // px left-side label area
const KF_RADIUS = 5;      // keyframe diamond half-size

export class TimelinePanelManager {
  private container: HTMLElement;
  private state: StateManager;
  /** Authored values captured before a scrub, restored when it stops. */
  private duration = 2000;
  /** The user typed a duration — stop fitting the ruler to the scene. */
  private durationPinned = false;
  private scrubMs = 0;
  private player: MotionPlayer;
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
    if (keys.includes('selectedLayerIds') || keys.includes('design')) {
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

    const { selectedLayerIds } = this.state.get();
    const rows = timelineRows(this.state.getCurrentLayers(), selectedLayerIds);
    const layers = rows.map(r => r.layer);

    if (layers.length === 0) {
      body.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--color-text-muted)">
        Select layers to edit their animation.</div>`;
      return;
    }

    // Fit the ruler to the scene unless the user has typed a duration. A scene
    // written by animation(op:sequence) is routinely longer than the old 2000ms
    // default, so play stopped a third of the way through it.
    if (!this.durationPinned) {
      const scene = sceneDuration(this.state.getCurrentLayers(), this.duration);
      if (scene !== this.duration) {
        this.duration = scene;
        const durInput = this.container.querySelector<HTMLInputElement>('#tl-duration');
        if (durInput) durInput.value = String(scene);
      }
    }

    const trackAreaW = body.clientWidth - HEADER_W || 400;

    body.innerHTML = rows.map(r => this.renderTrack(r.layer, trackAreaW, r.depth)).join('');

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

  private renderTrack(layer: Layer, trackAreaW: number, depth = 0): string {
    const keyframes = (layer.animation?.keyframes ?? []) as Keyframe[];
    const diamonds = keyframes.map(kf => {
      const pct = Math.min(1, kf.t / this.duration) * trackAreaW;
      const ease = String((kf as unknown as Record<string, unknown>)['easing'] ?? '');
      return `<div class="tl-keyframe" data-layer-id="${layer.id}" data-t="${kf.t}" data-easing="${ease}"
        title="${fmtMs(kf.t)}${ease ? ` · ${ease}` : ''} — click to set easing, right-click to delete"
        style="position:absolute;left:${pct - KF_RADIUS}px;top:${TRACK_H / 2 - KF_RADIUS}px;
               width:${KF_RADIUS * 2}px;height:${KF_RADIUS * 2}px;
               background:${ease ? 'var(--color-text)' : 'var(--color-accent)'};border-radius:2px;transform:rotate(45deg);
               cursor:pointer"></div>`;
    }).join('');

    return `
      <div class="tl-track" style="display:flex;height:${TRACK_H}px;border-bottom:1px solid var(--color-border)">
        <div style="width:${HEADER_W}px;flex-shrink:0;display:flex;align-items:center;
                    padding:0 8px 0 ${8 + depth * 12}px;font-size:11px;color:var(--color-text);overflow:hidden;white-space:nowrap"
             title="${layer.id}">
          ${depth ? '<span style="opacity:.45">└ </span>' : ''}${layer.id}
        </div>
        <div class="tl-track-area" data-layer-id="${layer.id}"
          style="flex:1;position:relative;cursor:crosshair;background:var(--color-surface-2)">
          ${diamonds}
        </div>
      </div>`;
  }

  private bindTracks(body: HTMLElement, layers: Layer[], trackAreaW: number): void {
    // Click track area to add/select keyframe
    body.querySelectorAll<HTMLElement>('.tl-track-area').forEach(area => {
      const layerId = area.dataset.layerId!;
      area.addEventListener('click', (e) => {
        const rect = area.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const t = Math.round(pct * this.duration);
        this.addKeyframe(layerId, t, layers);
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

  /**
   * Show the pose on the CANVAS, not just on the ruler.
   *
   * The scrubber used to move a thumb and a timecode and change nothing else,
   * so dragging it looked like a preview and was not one. Poses are applied
   * with recordUndo:false — the same channel a drag uses mid-gesture — and the
   * authored values are captured once, on the first scrub, so stopping puts
   * the design back exactly as authored rather than baking a frame into it.
   */


}

/**
 * A timecode, always `s.mmm`.
 *
 * Round FIRST. This only ever saw whole milliseconds from the scrub slider
 * until the player started driving it from requestAnimationFrame, which hands
 * over fractional times: 163.799999976 % 1000 padded to three characters is
 * already three, so it printed verbatim and the readout became
 * "0.163.799999976s" — two decimal points, thirteen digits, and wide enough to
 * shove the rest of the toolbar out of the panel.
 */
export function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  return `${Math.floor(total / 1000)}.${String(total % 1000).padStart(3, '0')}s`;
}
