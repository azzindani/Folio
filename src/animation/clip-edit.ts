// What a clip's `video` block is changed by — one set of rules for every editor of it.
//
// animation(op:video) (the model) and the editor's Clip inspector (a person) both write
// through these two functions, so a value one accepts the other accepts, with the same
// limits and the same words. They are split where op:video has to do work between them
// (the file's length, the in/out points): timing first, then the look — transition, crop,
// ramp, grade, key.

import type { ClipLayer } from './video-clip';
import { MIN_SPEED, MAX_SPEED } from './video-time';
import { readColor } from './clip-color';
import { readKey } from './clip-key';
import { readCropArgs } from './clip-crop';
import { readTransition, predecessorOf, TRANSITION_TYPES, MIN_TRANSITION_MS, MAX_TRANSITION_MS } from './clip-transition';

/** Why an edit was refused, and what to try. */
export interface ClipEditFailure { error: string; hint: string }

export interface TimingEdits {
  offset_ms?: number; duration_ms?: number; speed?: number; volume?: number; muted?: boolean; loop?: boolean;
  fade_in?: unknown; fade_out?: unknown; audio_lead_ms?: unknown; audio_tail_ms?: unknown;
}
export interface LookEdits {
  clip_transition?: unknown; focus?: unknown; zoom?: unknown; pan?: unknown; ramp?: unknown; color?: unknown; key?: unknown;
}

/** A clip's `video` block as these edits see it: timing and sound, plus the look fields written by readColor / readKey. */
type VideoBlock = NonNullable<ClipLayer['video']> & { color?: unknown; key?: unknown };

const FIELDS = ['offset_ms', 'duration_ms', 'speed', 'volume', 'muted', 'loop'] as const;
/** Edge sound: the arg (fade_in/fade_out share op:audio's names) and the clip field it writes. 0 or null clears. */
const SOUND = [['fade_in', 'fade_in_ms'], ['fade_out', 'fade_out_ms'], ['audio_lead_ms', 'audio_lead_ms'], ['audio_tail_ms', 'audio_tail_ms']] as const;
export const MAX_EDGE_MS = 10_000;

/** Speed, volume, mute, loop, the file window and the edge sound, written into `clip.video`. */
export function applyTimingEdits(clip: ClipLayer, args: TimingEdits): ClipEditFailure | null {
  const v = (clip.video ??= {});
  if (args.speed !== undefined && !(args.speed >= MIN_SPEED && args.speed <= MAX_SPEED)) {
    return { error: `speed ${String(args.speed)} is out of range.`, hint: 'Use 0.1–8 (0.5 = half speed, 2 = double).' };
  }
  for (const k of FIELDS) if (args[k] !== undefined) (v as Record<string, unknown>)[k] = args[k];
  if (typeof v.volume === 'number') v.volume = Math.min(1, Math.max(0, v.volume));
  for (const [arg, key] of SOUND) {
    const n = args[arg];
    if (n === undefined) continue;
    if (n === null || n === 0) { delete (v as Record<string, unknown>)[key]; continue; }
    if (typeof n !== 'number' || !(n > 0 && n <= MAX_EDGE_MS)) {
      return { error: `${arg} ${String(n)} is out of range.`, hint: `Use ms from 1 to ${MAX_EDGE_MS} (0 or null clears it).` };
    }
    (v as Record<string, unknown>)[key] = Math.round(n);
  }
  return null;
}

/**
 * The transition into the clip, its crop, ramp, grade and key. `siblings` are the other
 * layers of the clip's own list: a transition joins the clip to the one ending where it starts.
 */
export function applyLookEdits(clip: ClipLayer, args: LookEdits, siblings: readonly ClipLayer[]): ClipEditFailure | null {
  const v = (clip.video ??= {}) as VideoBlock;
  // clip_transition, not transition: the animation tool's `transition` is op:scene's page entrance.
  if (args.clip_transition === null) delete v.transition;
  else if (args.clip_transition !== undefined) {
    const t = readTransition(args.clip_transition);
    if (typeof t === 'string') {
      return { error: t, hint: `Use {type: ${TRANSITION_TYPES.join('|')}, duration_ms? ${MIN_TRANSITION_MS}–${MAX_TRANSITION_MS}, color? "#rrggbb" (dip), direction? left|right|up|down (wipe, push)}; null clears.` };
    }
    if (!predecessorOf(siblings.filter(l => l.id !== clip.id), clip)) {
      return {
        error: `No clip ends where "${clip.id}" starts (${Number(clip.in) || 0} ms) — a transition joins a clip to the one before it on its track.`,
        hint: 'Lay the clips end to end first (op:video in on this clip, or split_at on one clip), then add the transition.',
      };
    }
    v.transition = t;
  }

  // Pan and zoom inside the footage (animation/clip-crop.ts): null clears each.
  const crop = readCropArgs(args);
  if (typeof crop === 'string') return { error: crop, hint: 'focus [x, y] 0–1 and zoom 1–4 set where the frame rests; pan:[{at_ms (file clock), focus?, zoom?, easing?}] moves it.' };
  for (const k of ['focus', 'zoom', 'pan'] as const) {
    if (crop[k] === null) delete (v as Record<string, unknown>)[k];
    else if (crop[k] !== undefined) (v as Record<string, unknown>)[k] = crop[k];
  }

  // A speed ramp (video-time.ts): keys on the clip's own clock; null clears.
  if (args.ramp === null) delete v.ramp;
  else if (args.ramp !== undefined) {
    const keys = Array.isArray(args.ramp) ? args.ramp as Array<Record<string, unknown>> : [];
    const bad = !keys.length || keys.some(k => typeof k['at_ms'] !== 'number' || k['at_ms'] < 0 || typeof k['speed'] !== 'number' || !(k['speed'] >= MIN_SPEED && k['speed'] <= MAX_SPEED));
    if (bad) {
      return { error: `ramp must be [{at_ms, speed}] — at_ms from the clip's start (ms), speed ${MIN_SPEED}–${MAX_SPEED}.`,
        hint: 'ramp:[{at_ms:0, speed:1}, {at_ms:800, speed:0.25}, {at_ms:2000, speed:1}] slows into a moment and back out.' };
    }
    if (v.still) return { error: `"${clip.id}" is a freeze; it has no speed to ramp.`, hint: 'Ramp the clip it was frozen from.' };
    v.ramp = keys.map(k => ({ at_ms: Math.round(k['at_ms'] as number), speed: k['speed'] as number })).sort((a, b) => a.at_ms - b.at_ms);
  }

  // A grade (animation/clip-color.ts); null clears.
  if (args.color !== undefined) {
    const grade = readColor(args.color);
    if (typeof grade === 'string') return { error: grade, hint: 'color:{exposure -3–3 stops, contrast/saturation/temperature/tint -1–1, lut:"assets/docs/look.cube"}; null clears.' };
    if (grade === null || !Object.keys(grade).length) delete v.color; else v.color = grade;
  }
  // A green screen taken out (animation/clip-key.ts); null clears.
  if (args.key !== undefined) {
    const key = readKey(args.key);
    if (typeof key === 'string') return { error: key, hint: 'key:{color:"#00ff00" (the screen), similarity? 0–1 (default 0.4: more takes out more), blend? 0–1 (default 0.1: the soft edge)}; null clears.' };
    if (key === null) delete v.key; else v.key = key;
  }
  return null;
}

/**
 * Both halves on a copy of the clip, for a caller with nothing between them (the editor):
 * the edited clip, or why not. `siblings` as for applyLookEdits.
 */
export function editClip(clip: ClipLayer, edits: TimingEdits & LookEdits, siblings: readonly ClipLayer[] = []): ClipLayer | ClipEditFailure {
  const next: ClipLayer = { ...clip, video: { ...(clip.video ?? {}) } };
  const bad = applyTimingEdits(next, edits) ?? applyLookEdits(next, edits, siblings);
  return bad ?? next;
}
