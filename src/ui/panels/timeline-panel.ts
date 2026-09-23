import type { StateManager, EditorState } from '../../editor/state';
import { openEasePopover } from './ease-popover';
import type { Layer } from '../../schema/types';
import { MotionPlayer } from '../../editor/motion-player';
import type { Keyframe } from '../../animation/types';
import { fromSceneTime } from '../../animation/clock-time';
import { trackHTML, markerStripHTML, markersOf, fmtMs, HEADER_W } from './timeline-track-view';
import { timelineRows, setKeyframeEasing, shiftKeyframes, flattenForTimeline } from './timeline-model';
import { bindTimelineEdits } from './timeline-edit';
import { bindTimelineDrags } from './timeline-drag';
import { soundLane, analyse, type SoundAnalysis, type SoundDeps } from './timeline-sound';
import { resolveAssetUrl } from '../../renderer/render-context';

// The pure API lives in timeline-model.ts; re-exported for existing importers.
export * from './timeline-model';
export { fmtMs };

/** The browser's way to fetch and decode a sound file — the same mount the canvas sound plays from. */
const SOUND_DEPS: SoundDeps = {
  load: src => fetch(resolveAssetUrl(src), { credentials: 'include' })
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  decode: data => new OfflineAudioContext(1, 1, 44_100).decodeAudioData(data)
    .then(b => ({ sampleRate: b.sampleRate, channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)) })),
};

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
  /** Sound files measured in the browser (null: unreadable here); absent = not yet asked. */
  private sounds = new Map<string, SoundAnalysis | null>();
  /** The soundtrack's beats on the ruler as last drawn — snap points for every drag. */
  private beats: number[] = [];
  private asked = new Set<string>();
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

    const sound = soundLane(design, currentPageIndex, this.duration, this.sounds, HEADER_W);
    this.beats = sound.beats;
    this.measure(sound.unmeasured);
    body.innerHTML = markerStripHTML(markersOf(design, currentPageIndex), this.duration) + sound.html
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

  /** Measure sound files not yet measured; redraw as each arrives, so its waveform and beats appear. */
  private measure(srcs: string[]): void {
    for (const src of srcs) {
      if (this.asked.has(src)) continue;   // asked once: a failure stays a failure, never a loop of retries
      this.asked.add(src);
      void analyse(src, SOUND_DEPS).then(a => { this.sounds.set(src, a); this.render(); });
    }
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

    // In/out handles and the shot strip: drag, rename, add, remove (timeline-edit.ts).
    bindTimelineEdits(body, {
      state: this.state,
      duration: () => this.duration,
      playhead: () => this.scrubMs,
      rows: () => this.player.rows(),
      markers: () => { const { design, currentPageIndex } = this.state.get(); return markersOf(design, currentPageIndex); },
      preview: ms => { const tc = this.container.querySelector<HTMLElement>('#tl-timecode'); if (tc) tc.textContent = fmtMs(ms); },
      seek: ms => this.scrubTo(ms),
      beats: () => this.beats,
    });

    // Drag a keyframe to retime it, a layer's bar to move all of its motion (timeline-drag.ts).
    bindTimelineDrags(body, {
      duration: () => this.duration,
      playhead: () => this.scrubMs,
      rows: () => this.player.rows(),
      markers: () => { const { design, currentPageIndex } = this.state.get(); return markersOf(design, currentPageIndex); },
      preview: ms => { const tc = this.container.querySelector<HTMLElement>('#tl-timecode'); if (tc) tc.textContent = fmtMs(ms); },
      animationOf: id => flattenForTimeline(layers).find(r => r.layer.id === id)?.layer.animation,
      write: (id, animation) => this.state.updateLayers(new Map([[id, { animation } as Partial<Layer>]]), true),
      beats: () => this.beats,
    });

    // Left-click a diamond opens the easing picker for THAT keyframe. The
    // click must not reach the track area underneath, which would read it as
    // "add a keyframe here" and drop a second one on top of this one.
    body.querySelectorAll<HTMLElement>('.tl-keyframe').forEach(kfEl => {
      kfEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openEasingPicker(kfEl);
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
   * The keyframe's easing: a name from the list, or a curve shaped by its
   * handles (ease-popover.ts). The popover sits on the panel, so it survives
   * the redraw each write causes; the layer is read fresh at every write.
   */
  private openEasingPicker(kfEl: HTMLElement): void {
    const layerId = kfEl.dataset['layerId'] ?? '';
    const t = parseInt(kfEl.dataset['t'] ?? '0', 10);
    openEasePopover({
      anchor: kfEl,
      host: this.container.querySelector<HTMLElement>('.timeline-panel') ?? this.container,
      current: kfEl.dataset['easing'] ?? '',
      commit: value => {
        const animation = flattenForTimeline(this.player.authoredLayers()).find(r => r.layer.id === layerId)?.layer.animation;
        if (animation) this.state.updateLayer(layerId, { animation: setKeyframeEasing(animation, t, value) } as Partial<Layer>);
      },
    });
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
