// Reframing a clip by hand — which part of the footage the box keeps (animation/clip-crop.ts).
//
// The rule, so a drag means the same thing wherever it starts: a clip with no pan keys rests at one crop,
// and reframing sets it; once it has keys, reframing writes the key AT THE PLAYHEAD (adding it if there is
// none). Keys sit on the file clock, so they stay on the footage they follow when the clip is trimmed.

import type { Layer } from '../../schema/types';
import type { ClipLayer } from '../../animation/video-clip';
import { cropAt, panKeys, MAX_ZOOM, type ClipCrop, type PanKey } from '../../animation/clip-crop';
import { videoSourceMs } from '../../animation/video-time';
import { fromSceneTime } from '../../animation/clock-time';
import { motionHost } from '../../editor/motion-host';
import { beginGesture, endGesture, writeClip, type ClipEnv } from './clip-commit';
import { canvasVideo } from './clip-pick';

/** A key within this of a moment IS that moment's key — a drag edits it rather than stacking another beside it. */
export const KEY_SNAP_MS = 40;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** What reframing writes: the resting crop (null clears), or the keys. */
export interface CropEdit { focus?: [number, number] | null; zoom?: number | null; pan?: PanKey[] }

/** The moment of the clip's FILE the playhead is on (clocks of any precomp above it taken off). */
export function playheadFileMs(layer: ClipLayer): number {
  const p = motionHost();
  const clocks = p?.rows()?.get(layer.id)?.clocks ?? [];
  return videoSourceMs(fromSceneTime(p?.time ?? 0, clocks), layer.in, layer.video);
}

/** The edit that puts the crop at `crop` as of `fileMs`: the resting crop, or — with keys, or `asKey` — a key at that moment. */
export function cropEdit(layer: Layer, crop: ClipCrop, fileMs: number, asKey = false): CropEdit {
  const focus: [number, number] = [r4(clamp(crop.focus[0], 0, 1)), r4(clamp(crop.focus[1], 0, 1))];
  const zoom = r4(clamp(crop.zoom, 1, MAX_ZOOM));
  const keys = panKeys(layer);
  // Resting: only what differs from the centred, unzoomed cover is written; the rest leaves the file.
  if (!keys.length && !asKey) return { focus: focus[0] === 0.5 && focus[1] === 0.5 ? null : focus, zoom: zoom === 1 ? null : zoom };
  const kept = keys.filter(k => Math.abs(k.at_ms - fileMs) > KEY_SNAP_MS);
  return { pan: [...kept, { at_ms: Math.round(fileMs), focus, zoom }].sort((a, b) => a.at_ms - b.at_ms) };
}

/** A key added where the playhead is, at the crop showing there. The first key also pins the start, so the move runs FROM the look the clip had. */
export function addKeyEdit(layer: ClipLayer, fileMs: number): { pan: PanKey[] } {
  const here = cropAt(layer, fileMs);
  const edit = cropEdit(layer, here, fileMs, true).pan ?? [];
  const start = Math.max(0, Number(layer.video?.offset_ms) || 0);
  const pinned: PanKey[] = !panKeys(layer).length && fileMs - start > KEY_SNAP_MS ? [{ at_ms: start, focus: here.focus, zoom: here.zoom }] : [];
  return { pan: [...pinned, ...edit] };
}

/** The focus after the picture is dragged (dx, dy) on screen: it moves with the pointer, so the focus moves against it. */
export function dragCrop(c: ClipCrop, dx: number, dy: number, box: { w: number; h: number }, frame: { w: number; h: number }): ClipCrop {
  const s = Math.max(box.w / frame.w, box.h / frame.h);
  const overX = frame.w * s * c.zoom - box.w, overY = frame.h * s * c.zoom - box.h;
  return { focus: [overX > 0.5 ? clamp(c.focus[0] - dx / overX, 0, 1) : c.focus[0], overY > 0.5 ? clamp(c.focus[1] - dy / overY, 0, 1) : c.focus[1]], zoom: c.zoom };
}

let stopMode: (() => void) | null = null;
export const isReframing = (): boolean => stopMode !== null;

/**
 * Drag the clip's picture on the canvas to pan it, scroll to zoom; Esc, or a press outside the clip, ends it.
 * Every press inside the clip belongs to the reframe: nothing under it is selected or moved.
 */
export function reframeOnCanvas(env: ClipEnv, onEnd: () => void): void {
  stopMode?.();
  const video = (): HTMLVideoElement | null => canvasVideo(env.layerId);
  const layer = (): ClipLayer | null => (env.state.findLayer(env.layerId) as ClipLayer | undefined) ?? null;
  const inside = (e: { clientX: number; clientY: number }): boolean => {
    const r = video()?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  let drag: { x: number; y: number; crop: ClipCrop; box: { w: number; h: number }; frame: { w: number; h: number }; ms: number } | null = null;
  let wheelEnd: ReturnType<typeof setTimeout> | null = null;
  // Reframing belongs to this clip: another selection ends it, or a later press would reframe a layer left behind.
  const unsubscribe = env.state.subscribe((_s, keys) => {
    const sel = env.state.get().selectedLayerIds;
    if (keys.includes('selectedLayerIds') && !(sel.length === 1 && sel[0] === env.layerId)) stop();
  });

  const down = (e: PointerEvent): void => {
    const l = layer(), v = video();
    if (!l || !v || !inside(e)) { stop(); return; }
    e.preventDefault(); e.stopPropagation();
    const ms = playheadFileMs(l), crop = cropAt(l, ms), r = v.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, crop, box: { w: r.width / crop.zoom, h: r.height / crop.zoom }, frame: { w: v.videoWidth || 16, h: v.videoHeight || 9 }, ms };
    beginGesture(env);
    document.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
  };
  const move = (e: PointerEvent): void => {
    const l = layer();
    if (!drag || !l) return;
    writeClip(env, cropEdit(l, dragCrop(drag.crop, e.clientX - drag.x, e.clientY - drag.y, drag.box, drag.frame), drag.ms));
  };
  const up = (): void => { if (drag) { drag = null; endGesture(env); } };
  const wheel = (e: WheelEvent): void => {
    const l = layer();
    if (!l || !inside(e)) return;
    e.preventDefault(); e.stopPropagation();
    beginGesture(env);
    const ms = playheadFileMs(l), c = cropAt(l, ms);
    writeClip(env, cropEdit(l, { focus: c.focus, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) }, ms));
    if (wheelEnd) clearTimeout(wheelEnd);
    wheelEnd = setTimeout(() => endGesture(env), 350);
  };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } };
  function stop(): void {
    document.body.classList.remove('clip-reframing');
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('wheel', wheel, true);
    document.removeEventListener('keydown', key, true);
    unsubscribe();
    up();
    stopMode = null;
    onEnd();
  }
  document.body.classList.add('clip-reframing');
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  document.addEventListener('keydown', key, true);
  stopMode = stop;
}

/** End reframing (the section's button, or the selection changing). */
export function stopReframing(): void { stopMode?.(); }
