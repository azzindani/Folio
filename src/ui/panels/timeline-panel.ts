import type { StateManager, EditorState } from '../../editor/state';
import { openEasePopover } from './ease-popover';
import type { Layer } from '../../schema/types';
import { MotionPlayer } from '../../editor/motion-player';
import type { Keyframe } from '../../animation/types';
import { fromSceneTime } from '../../animation/clock-time';
import { trackHTML, markerStripHTML, markersOf, fmtMs, HEADER_W, TRACK_H } from './timeline-track-view';
import { timelineRows, setKeyframeEasing, shiftKeyframes, flattenForTimeline } from './timeline-model';
import { bindTimelineEdits } from './timeline-edit';
import { bindTimelineDrags } from './timeline-drag';
import { bindClipEdits, bindClipMoves, bindClipJoins, clipJoins, splitAtPlayhead, selectFromTimeline, type ClipEditContext } from './timeline-clips';
import { freezeAtPlayhead, holdMs, setHoldMs } from './clip-freeze';
import { onMeasured, shotsOnScene } from './clip-measure';
import { rulerHTML } from './timeline-ruler';
import { trackWidth, stepZoom, clampZoom, scrollAfterZoom } from './timeline-zoom';
import { bindPinch } from './timeline-gestures';
import { toolbarHTML } from './timeline-toolbar';
import { soundLane, analyse, type SoundAnalysis, type SoundDeps } from './timeline-sound';
import { stripTimes, clipWave, browserFrames, type ClipLook } from './timeline-filmstrip';
import { summarize, type ClipLayer } from '../../animation/video-clip';
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
  /** Clip thumbnails by `file|ms` (null: could not be grabbed); `grabbing` holds the ones asked for. */
  private frames = new Map<string, string | null>();
  private grabbing = new Set<string>();
  private readonly frameDeps = browserFrames(src => resolveAssetUrl(src));
  private redraw: ReturnType<typeof setTimeout> | null = null;
  /** px per ms, or null: the scene exactly fills the view (timeline-zoom.ts). */
  private zoom: number | null = null;
  private resizeWatch: ResizeObserver | null = null;
  private lastViewW = 0;
  /** The ⋯ row (duration, stagger, trails) is open. */
  private optionsOpen = false;
  /** Two fingers are on the sheet: it is resized, never rebuilt (timeline-gestures.ts). */
  private pinching = false;
  /** Rows for the selected layers alone (the old behaviour); off: the whole sequence, selection highlighted. */
  private onlySelected = false;
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
    onMeasured(() => this.render());
    this.player.subscribe(s => {
      // The sampler loads after the panel: redraw once, so rows move onto the scene clock.
      if ((this.player.rows() !== null) !== this.drawnWithRows) this.render();
      this.scrubMs = s.time;
      const tc = this.container.querySelector<HTMLElement>('#tl-timecode');
      if (tc) tc.textContent = fmtMs(s.time);
      this.setPlayhead(s.time, s.duration);
      if (s.playing) this.follow(s.time);
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
      <div class="timeline-panel">${toolbarHTML({ duration: this.duration, hold: holdMs(), time: fmtMs(this.scrubMs), total: fmtMs(this.duration), optionsOpen: this.optionsOpen, onlySelected: this.onlySelected })}
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
    // Bound once, with the toolbar: bound per render, one click staggered once for every render so far.
    this.container.querySelector<HTMLElement>('#tl-stagger-apply')?.addEventListener('click', () => this.applyStagger());
    const hold = this.container.querySelector<HTMLInputElement>('#tl-hold');
    hold?.addEventListener('change', () => { setHoldMs(parseFloat(hold.value) || holdMs()); hold.value = String(holdMs()); });
    this.container.querySelector<HTMLElement>('#tl-freeze')?.addEventListener('click', () => {
      void freezeAtPlayhead(this.state, this.state.getSelectedLayers().find(l => l.type === 'video')?.id);
    });
    this.container.querySelector<HTMLElement>('#tl-split')?.addEventListener('click', () => {
      const selected = this.state.getSelectedLayers().find(l => l.type === 'video');
      splitAtPlayhead(this.state, this.scrubMs, this.player.rows(), selected?.id);
    });
    const toggle = this.container.querySelector<HTMLElement>('#tl-options-toggle');
    toggle?.addEventListener('click', () => {
      this.optionsOpen = !this.optionsOpen;
      toggle.setAttribute('aria-expanded', String(this.optionsOpen));
      this.container.querySelector<HTMLElement>('#tl-options')?.toggleAttribute('hidden', !this.optionsOpen);
    });
    this.container.querySelector<HTMLElement>('#tl-zoom-out')?.addEventListener('click', () => this.zoomBy(-1));
    this.container.querySelector<HTMLElement>('#tl-zoom-in')?.addEventListener('click', () => this.zoomBy(1));
    this.container.querySelector<HTMLElement>('#tl-zoom-fit')?.addEventListener('click', () => this.zoomTo(null));
    this.bindView();
    const only = this.container.querySelector<HTMLInputElement>('#tl-selected-only');
    only?.addEventListener('change', () => { this.onlySelected = only.checked; this.render(); });
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
    const rows = timelineRows(authored, selectedLayerIds, this.onlySelected);
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
        const total = this.container.querySelector<HTMLElement>('#tl-total');
        if (total) total.textContent = ` / ${fmtMs(scene)}`;
      }
    }

    const sound = soundLane(design, currentPageIndex, this.duration, this.sounds, HEADER_W);
    this.beats = sound.beats;
    const joins = clipJoins(authored);
    this.measure(sound.unmeasured);
    // One sheet: its width is the time scale (fit, or px per ms), the rows inside position in % of it.
    const view = Math.max(0, body.clientWidth - HEADER_W);
    const px = trackWidth(this.duration, this.zoom, view);
    const width = this.zoom === null ? `width:100%;min-width:${HEADER_W + 40}px` : `width:${HEADER_W + px}px`;
    body.innerHTML = `<div class="tl-sheet" style="${width};--tl-w:${HEADER_W}px;--tl-p:${Math.min(1, this.scrubMs / Math.max(1, this.duration))}">`
      + rulerHTML(this.duration, px / Math.max(1, this.duration))
      + markerStripHTML(markersOf(design, currentPageIndex), this.duration) + sound.html
      + rows.map(r => trackHTML(r.layer, timing?.get(r.layer.id), this.duration, r.depth, this.lookFor, l => ({ join: joins.get(l.id), shots: shotsOnScene(l) }))).join('')
      + '<div class="tl-scrub-thumb"></div></div>';

    const picked = new Set(selectedLayerIds);
    body.querySelectorAll<HTMLElement>('.tl-label[data-layer-id]').forEach(l => l.classList.toggle('tl-selected', picked.has(l.dataset['layerId'] ?? '')));
    this.bindTracks(body, layers);
  }

  /** A clip block's thumbnails and waveform from what has arrived; what has not is asked for, and the timeline redraws as it lands. */
  private lookFor = (l: Layer, widthPct: number): ClipLook => {
    const src = typeof (l as { src?: unknown }).src === 'string' ? (l as { src: string }).src : '';
    const thumbs = stripTimes(l, widthPct).map(ms => {
      const key = `${src}|${ms}`;
      if (src && !this.grabbing.has(key)) {
        this.grabbing.add(key);
        // Twice the block's height, so the strip stays sharp on a dense screen.
        void this.frameDeps.grab(src, ms, (TRACK_H - 6) * 2).then(uri => { this.frames.set(key, uri); this.redrawSoon(); });
      }
      return this.frames.get(key);
    });
    if (src && !summarize(l as ClipLayer).muted) this.measure([src]);
    return { thumbs, wave: clipWave(l, this.sounds.get(src)) };
  };

  /** One redraw for a burst of arrivals — and never under a drag, which a redraw would cut short. */
  private redrawSoon(): void {
    if (this.redraw) return;
    this.redraw = setTimeout(() => {
      this.redraw = null;
      if (this.pinching || this.container.querySelector('.tl-dragging')) { this.redrawSoon(); return; }
      this.render();
    }, 150);
  }

  /** Measure sound files not yet measured; redraw as each arrives, so its waveform and beats appear. */
  private measure(srcs: string[]): void {
    for (const src of srcs) {
      if (this.asked.has(src)) continue;   // asked once: a failure stays a failure, never a loop of retries
      this.asked.add(src);
      void analyse(src, SOUND_DEPS).then(a => { this.sounds.set(src, a); this.redrawSoon(); });
    }
  }

  private bindTracks(body: HTMLElement, layers: Layer[]): void {
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

    // Clip blocks: trim by their grips, drag to reorder; ✂ cuts at the playhead (timeline-clips.ts).
    const clipCtx: ClipEditContext = {
      state: this.state,
      duration: () => this.duration,
      playhead: () => this.scrubMs,
      rows: () => this.player.rows(),
      markers: () => { const { design, currentPageIndex } = this.state.get(); return markersOf(design, currentPageIndex); },
      preview: ms => { const tc = this.container.querySelector<HTMLElement>('#tl-timecode'); if (tc) tc.textContent = fmtMs(ms); },
      beats: () => this.beats,
      shots: id => { const l = this.state.findLayer(id); return l?.type === 'video' ? shotsOnScene(l) : []; },
    };
    bindClipEdits(body, clipCtx);
    bindClipMoves(body, clipCtx);
    bindClipJoins(body, clipCtx);

    // A row's name selects its layer (Shift / Ctrl adds); the selection is highlighted, not a filter.
    body.querySelectorAll<HTMLElement>('.tl-label[data-layer-id]').forEach(label => {
      label.addEventListener('click', e => selectFromTimeline(this.state, label.dataset['layerId'] ?? '', e));
    });

    // The ruler: a press puts the playhead there, and dragging carries it.
    const scrub = body.querySelector<HTMLElement>('.tl-scrub-area');
    if (scrub) {
      const seek = (e: PointerEvent): void => {
        const rect = scrub.getBoundingClientRect();
        this.scrubTo(Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * this.duration));
      };
      scrub.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        scrub.setPointerCapture(e.pointerId);
        seek(e);
        scrub.addEventListener('pointermove', seek);
        const done = (): void => { scrub.removeEventListener('pointermove', seek); };
        scrub.addEventListener('pointerup', done, { once: true });
        scrub.addEventListener('pointercancel', done, { once: true });
      });
    }

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
    // A key beside a motion rule would never play — the rule is its track (right-click → Detach rule first).
    if (!layer || layer.animation?.rule !== undefined) return;
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

  /** Put the playhead line at `ms` — one CSS variable on the sheet, no layout. */
  private setPlayhead(ms: number, duration = this.duration): void {
    this.container.querySelector<HTMLElement>('.tl-sheet')?.style.setProperty('--tl-p', String(Math.min(1, Math.max(0, ms / Math.max(1, duration)))));
  }

  /** While it plays, a zoomed sheet scrolls to keep the playhead in sight (a fitted one shows it all already). */
  private follow(ms: number): void {
    const body = this.bodyEl();
    if (!body || this.zoom === null) return;
    const x = ms * this.pxPerMs(), view = this.viewPx();
    if (x < body.scrollLeft || x > body.scrollLeft + view - 24) body.scrollLeft = Math.max(0, x - view * 0.2);
  }

  private bodyEl(): HTMLElement | null { return this.container.querySelector<HTMLElement>('#tl-body'); }

  private viewPx(): number { return Math.max(0, (this.bodyEl()?.clientWidth ?? 0) - HEADER_W); }

  /** The time scale as drawn, px per ms. */
  private pxPerMs(): number { return trackWidth(this.duration, this.zoom, this.viewPx()) / Math.max(1, this.duration); }

  /** Change the scale, keeping the moment `anchorPx` from the track's left edge in the view (default: the middle) where it was. */
  private zoomTo(next: number | null, anchorPx?: number): void {
    const body = this.bodyEl();
    if (!body) return;
    const before = this.pxPerMs(), scroll = body.scrollLeft;
    this.zoom = next;
    this.render();
    body.scrollLeft = next === null ? 0 : scrollAfterZoom(scroll, anchorPx ?? this.viewPx() / 2, before, this.pxPerMs());
  }

  /** The scale changes under the fingers: only the sheet's width moves (rows are in %), so no node is replaced. */
  private zoomLive(next: number | null, anchorPx: number): void {
    const body = this.bodyEl(), sheet = body?.querySelector<HTMLElement>('.tl-sheet');
    if (!body || !sheet) return;
    const before = this.pxPerMs(), scroll = body.scrollLeft;
    this.zoom = next;
    const px = trackWidth(this.duration, next, this.viewPx());
    sheet.style.width = next === null ? '100%' : `${HEADER_W + px}px`;
    body.scrollLeft = next === null ? 0 : scrollAfterZoom(scroll, anchorPx, before, px / Math.max(1, this.duration));
  }

  private zoomBy(dir: 1 | -1, anchorPx?: number): void {
    this.zoomTo(stepZoom(this.zoom, dir, this.duration, this.viewPx()), anchorPx);
  }

  /** Ctrl + wheel and pinch zoom the scale; a change of the panel's own width (the dock dragged, the window resized) redraws the ruler. */
  private bindView(): void {
    const body = this.bodyEl();
    if (!body) return;
    body.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.004)));
      this.zoomTo(clampZoom(this.pxPerMs() * factor, this.duration, this.viewPx()), Math.max(0, e.clientX - body.getBoundingClientRect().left - HEADER_W));
    }, { passive: false });
    bindPinch(body, {
      labelW: HEADER_W,
      scale: () => this.pxPerMs(),
      begin: () => { this.pinching = true; },
      end: () => { this.pinching = false; this.render(); },
      setScale: (px, anchor) => this.zoomLive(clampZoom(px, this.duration, this.viewPx()), anchor),
    });
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeWatch = new ResizeObserver(() => {
      if (Math.abs(body.clientWidth - this.lastViewW) < 2) return;
      this.lastViewW = body.clientWidth;
      this.redrawSoon();
    });
    this.resizeWatch.observe(body);
  }

  private scrubTo(ms: number): void {
    this.scrubMs = Math.max(0, Math.min(this.duration, ms));
    const timecode = this.container.querySelector<HTMLElement>('#tl-timecode');
    if (timecode) timecode.textContent = fmtMs(this.scrubMs);
    this.setPlayhead(this.scrubMs);
    this.player.seek(this.scrubMs);
  }
}
