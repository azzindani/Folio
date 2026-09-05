import type { StateManager, EditorState } from '../../editor/state';
import { poseAt } from '../../animation/keyframe-css';
import type { Layer } from '../../schema/types';
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

const TRACK_H = 32;       // px per track row
const HEADER_W = 120;     // px left-side label area
const KF_RADIUS = 5;      // keyframe diamond half-size

export class TimelinePanelManager {
  private container: HTMLElement;
  private state: StateManager;
  /** Authored values captured before a scrub, restored when it stops. */
  private preScrub: Map<string, Partial<Layer>> | null = null;
  private duration = 2000;
  private scrubMs = 0;
  private playing = false;
  private raf = 0;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    state.subscribe(this.onStateChange.bind(this));
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
      if (this.playing) { this.pause(); playBtn.textContent = '▶'; }
      else              { this.play();  playBtn.textContent = '⏸'; }
    });
    stopBtn.addEventListener('click', () => {
      this.stop();
      playBtn.textContent = '▶';
    });
    durInput.addEventListener('change', () => {
      this.duration = Math.max(100, parseFloat(durInput.value) || 2000);
      this.render();
    });
  }

  render(): void {
    const body = this.container.querySelector<HTMLElement>('#tl-body');
    if (!body) return;

    const { selectedLayerIds } = this.state.get();
    const layers = this.state.getCurrentLayers()
      .filter(l => selectedLayerIds.length === 0 || selectedLayerIds.includes(l.id));

    if (layers.length === 0) {
      body.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--color-text-muted)">
        Select layers to edit their animation.</div>`;
      return;
    }

    const trackAreaW = body.clientWidth - HEADER_W || 400;

    body.innerHTML = layers.map(l => this.renderTrack(l, trackAreaW)).join('');

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

  private renderTrack(layer: Layer, trackAreaW: number): string {
    const keyframes = (layer.animation?.keyframes ?? []) as Keyframe[];
    const diamonds = keyframes.map(kf => {
      const pct = Math.min(1, kf.t / this.duration) * trackAreaW;
      return `<div class="tl-keyframe" data-layer-id="${layer.id}" data-t="${kf.t}"
        title="${fmtMs(kf.t)}"
        style="position:absolute;left:${pct - KF_RADIUS}px;top:${TRACK_H / 2 - KF_RADIUS}px;
               width:${KF_RADIUS * 2}px;height:${KF_RADIUS * 2}px;
               background:var(--color-accent);border-radius:2px;transform:rotate(45deg);
               cursor:pointer"></div>`;
    }).join('');

    return `
      <div class="tl-track" style="display:flex;height:${TRACK_H}px;border-bottom:1px solid var(--color-border)">
        <div style="width:${HEADER_W}px;flex-shrink:0;display:flex;align-items:center;
                    padding:0 8px;font-size:11px;color:var(--color-text);overflow:hidden;white-space:nowrap">
          ${layer.id}
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
    this.previewAt(this.scrubMs);
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
  private previewAt(ms: number): void {
    const layers = this.state.getCurrentLayers() as Layer[];
    const animated = layers.filter(l => (l.animation?.keyframes ?? []).length > 0);
    if (animated.length === 0) return;

    if (!this.preScrub) {
      this.preScrub = new Map();
      for (const l of animated) {
        const o = l as unknown as Record<string, unknown>;
        this.preScrub.set(l.id, {
          x: o['x'], y: o['y'], opacity: o['opacity'], rotation: o['rotation'],
          transform: o['transform'], effects: o['effects'],
        } as unknown as Partial<Layer>);
      }
    }

    for (const l of animated) {
      const base = this.preScrub.get(l.id);
      if (!base) continue;
      const authored = { ...(l as unknown as Record<string, unknown>), ...(base as unknown as Record<string, unknown>) } as unknown as Layer;
      const pose = interpolateAtTime((l.animation?.keyframes ?? []) as Keyframe[], ms, this.duration);
      const update = { ...(base as unknown as Record<string, unknown>), ...(poseToLayerUpdate(authored, pose) as unknown as Record<string, unknown>) };
      this.state.updateLayer(l.id, update as unknown as Partial<Layer>, false);
    }
  }

  /** Put every previewed layer back the way it was authored. */
  private clearPreview(): void {
    if (!this.preScrub) return;
    for (const [id, base] of this.preScrub) this.state.updateLayer(id, base, false);
    this.preScrub = null;
  }

  private play(): void {
    this.playing = true;
    const start = performance.now() - this.scrubMs;
    const tick = (now: number) => {
      if (!this.playing) return;
      const elapsed = now - start;
      const t = elapsed % this.duration;
      this.scrubTo(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  private stop(): void {
    this.pause();
    this.scrubMs = 0;
    const timecode = this.container.querySelector<HTMLElement>('#tl-timecode');
    if (timecode) timecode.textContent = fmtMs(0);
    const thumb = this.container.querySelector<HTMLElement>('.tl-scrub-thumb');
    if (thumb) thumb.style.left = '0%';
    // Stop means "back to the design", not "back to frame 0 of the preview".
    this.clearPreview();
  }
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = ms % 1000;
  return `${s}.${String(m).padStart(3, '0')}s`;
}
