// animation(op:video, freeze) — hold one frame of a clip, the way an editor's freeze frame does.
//
// The clip is split where the freeze starts, everything from there on moves
// later by the hold (the same ripple op:retime and cuts use), and a still of
// that exact frame fills the gap — with the clip's crop at that moment, silent.
// The still is a video layer with video.still (video-time.ts), so every player
// draws it from the same file.

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope } from './motion';
import { readMarkers, resolveTime } from './motion-time';
import { findClip, replaceClip, uniqueClipId, summarize, splitClip, type ClipLayer } from './motion-video-op';
import { rippleSpec, commitRipple } from './motion-retime-op';
import { videoSourceMs } from '../../animation/video-time';
import { cropAt, hasCrop } from '../../animation/clip-crop';

export interface FreezeArgs { design_path: string; project_path?: string; page_id?: string; layer_id?: string; freeze?: unknown }
const OP = 'video';
/** What a still takes from its clip: where and how it draws, not when or how it plays. */
const TIMED = new Set(['in', 'out', 'video', 'animation', 'link', 'clock']);

/** The tree with `layer` placed right after `afterId` in whichever list holds it. */
function insertAfter(layers: Layer[], afterId: string, layer: Layer): Layer[] {
  const i = layers.findIndex(l => l.id === afterId);
  if (i >= 0) return [...layers.slice(0, i + 1), layer, ...layers.slice(i + 1)];
  return layers.map(l => {
    const kids = (l as ClipLayer).layers;
    return Array.isArray(kids) ? ({ ...l, layers: insertAfter(kids, afterId, layer) } as Layer) : l;
  });
}

export function freezeVideo(args: FreezeArgs): ToolResult {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  if (!args.layer_id) return errResult(OP, 'layer_id is required.', 'Name the clip to freeze.');
  const raw = (args.freeze ?? {}) as { at?: unknown; duration_ms?: unknown };
  const hold = raw.duration_ms;
  if (typeof hold !== 'number' || !(hold >= 100 && hold <= 10_000)) return errResult(OP, 'freeze.duration_ms must be 100–10000 ms.', 'freeze:{at: "<time or marker>", duration_ms: 1200}.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(OP, scoped.error, 'Check page_id.');
  const clip = findClip(scoped.scope, args.layer_id);
  if (!clip || clip.type !== 'video') return errResult(OP, `"${args.layer_id}" is not a video layer on this page.`, 'manage_design {op:"inspect"} lists the layers.');
  if (clip.video?.still) return errResult(OP, `"${clip.id}" is already a freeze.`, 'Change its hold with op:video duration_ms, or freeze the clip it came from.');
  const markers = readMarkers(spec, scoped.page);
  const at = resolveTime(raw.at ?? clip.in ?? 0, { markers, layers: scoped.scope });
  if (typeof at === 'string') return errResult(OP, `freeze.at: ${at}`, 'A scene time in ms, a marker, or a layer point ("take.out-500").');
  const s = summarize(clip);
  if (at < s.plays.from || (s.plays.until !== null && at > s.plays.until)) {
    return errResult(OP, `freeze.at ${Math.round(at)}ms is not while "${clip.id}" plays (${s.plays.from}–${s.plays.until ?? '…'}ms).`, 'Pick a moment inside the clip.');
  }
  const t = Math.round(at), d = Math.round(hold);
  // The frame and the crop it shows at that moment.
  const fileMs = s.plays.until !== null && t >= s.plays.until ? videoSourceMs(t - 1, clip.in, clip.video) : videoSourceMs(t, clip.in, clip.video);
  const crop = hasCrop(clip) ? cropAt(clip, fileMs) : null;
  let layers = scoped.scope, headId = clip.id, tailId = '';
  if (t > s.plays.from && (s.plays.until === null || t < s.plays.until)) {
    const halves = splitClip(clip, t, uniqueClipId(layers, clip.id));
    layers = replaceClip(layers, clip.id, halves);
    tailId = halves[1]?.id ?? '';
  } else if (t <= s.plays.from) { headId = ''; tailId = clip.id; }
  const head = headId ? findClip(layers, headId) : null;
  const headOut = head?.out;
  const rip = rippleSpec(spec, { scope: layers, ...(scoped.page ? { page: scoped.page } : {}) }, markers, { at: t, by: d });
  if (rip.rep.blocked.length) return errResult(OP, `Opening ${d}ms at ${t}ms is blocked: ${rip.rep.blocked.slice(0, 6).join('; ')}.`, 'Freeze where nothing is mid-move.');
  // The ripple moves every point at the freeze — the first half's end with them; it still ends there.
  let out = headId && typeof headOut === 'number' ? replaceClip(rip.layers, headId, [{ ...(findClip(rip.layers, headId) as ClipLayer), out: headOut }]) : rip.layers;
  const still = {
    ...Object.fromEntries(Object.entries(clip).filter(([k]) => !TIMED.has(k))),
    id: findClip(out, `${clip.id}_freeze`) ? uniqueClipId(out, `${clip.id}_freeze`) : `${clip.id}_freeze`, in: t, out: t + d,
    video: { offset_ms: fileMs, duration_ms: d, still: true, muted: true, ...(crop ? { focus: crop.focus, zoom: crop.zoom } : {}) },
  } as unknown as Layer;
  out = headId ? insertAfter(out, headId, still) : [still, ...out];
  const bak = snapshot(dPath);
  commitRipple(spec, { scope: out, ...(scoped.page ? { page: scoped.page } : {}) }, { ...rip, layers: out });
  writeYAML(dPath, spec);
  const clips = [headId, still.id, tailId].filter(Boolean).map(id => findClip(out, id)).filter((l): l is ClipLayer => Boolean(l)).map(summarize);
  return okResult(OP, {
    design_path: dPath, frozen_at_ms: t, hold_ms: d, file_ms: fileMs, clips, moved_later: [...rip.rep.moved],
    progress: [pOk(`Froze "${clip.id}" at ${t}ms for ${d}ms`, `file frame ${fileMs}ms; everything from ${t}ms on moved ${d}ms later`)],
  }, bak);
}
