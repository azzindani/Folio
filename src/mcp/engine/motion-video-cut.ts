// animation {op:"video", cut:[[from_ms, to_ms], …]} — take spans of the FILE out of a clip.
//
// The edit a "remove silences" button makes, with the model choosing the spans
// (asset_read on the clip lists its silences). Each span, on the file clock, is
// mapped onto the scene clock, the clip is split at both ends, the middle piece
// is dropped and — unless ripple:false — the gap is closed with the same ripple
// op:retime makes, so everything after it (other layers, markers, cues,
// captions, the scene length) moves up by what was removed.

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk } from './utils';
import { resolveScope, commitScope } from './motion';
import { readMarkers } from './motion-time';
import { findClip, replaceClip, uniqueClipId, summarize, splitClip, type ClipLayer } from './motion-video-op';
import { rippleSpec, commitRipple } from './motion-retime-op';

export interface CutArgs { design_path: string; project_path?: string; page_id?: string; layer_id?: string; cut?: unknown; ripple?: boolean }

/** The spans as sorted, merged [from, to) pairs on the file clock, or why they cannot be read. */
export function readSpans(raw: unknown): Array<[number, number]> | string {
  if (!Array.isArray(raw) || !raw.length) return 'cut must be a list of [from_ms, to_ms] spans on the file clock.';
  const spans: Array<[number, number]> = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length !== 2 || !s.every(v => typeof v === 'number' && Number.isFinite(v))) return `Not a [from_ms, to_ms] span: ${JSON.stringify(s)}`;
    const [a, b] = s as [number, number];
    if (!(b > a) || a < 0) return `Span [${a}, ${b}] must run forward from 0 or later.`;
    spans.push([Math.round(a), Math.round(b)]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]);
  }
  return merged;
}

export function cutVideo(args: CutArgs): ToolResult {
  const op = 'video';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spans = readSpans(args.cut);
  if (typeof spans === 'string') return errResult(op, spans, 'Example: cut:[[2400, 3100], [9800, 10600]] — file ms, as asset_read lists silences.');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const clip = args.layer_id ? findClip(scoped.scope, args.layer_id) : null;
  if (!clip || clip.type !== 'video') return errResult(op, `"${String(args.layer_id)}" is not a video layer on this page.`, 'manage_design {op:"inspect"} lists the layers.');
  const s0 = summarize(clip);
  const fileEnd = s0.file.to;
  for (const [a, b] of spans) {
    if (a < s0.file.from || (fileEnd !== null && b > fileEnd)) {
      return errResult(op, `Span [${a}, ${b}] is outside the part of the file "${clip.id}" uses (${s0.file.from}–${fileEnd ?? 'end'}ms).`, 'Cut inside the used part, or widen it first with offset_ms / duration_ms.');
    }
  }

  // Last span first: the clip's earlier piece keeps its id and its scene times stay valid.
  let layers: Layer[] = scoped.scope;
  let removed = 0;
  for (const [a, b] of [...spans].reverse()) {
    const piece = findClip(layers, clip.id) as ClipLayer;
    const s = summarize(piece);
    const ta = s.plays.from + (a - s.file.from) / s.speed, tb = s.plays.from + (b - s.file.from) / s.speed;
    const pieces: ClipLayer[] = [];
    let rest: ClipLayer = piece;
    if (ta > s.plays.from) {
      const [head, tail] = splitClip(rest, ta, uniqueClipId(layers, clip.id));
      if (!head || !tail) return errResult(op, `Could not cut "${clip.id}" at ${Math.round(ta)}ms.`, 'Check the clip\'s timing with op:video and no cut.');
      pieces.push(head);
      rest = tail;
    }
    const after = s.plays.until === null || tb < s.plays.until ? splitClip(rest, tb, uniqueClipId([...layers, ...pieces], clip.id))[1] : undefined;
    if (after) pieces.push(after);
    layers = replaceClip(layers, piece.id, pieces);
    if (args.ripple !== false) {
      const scope = { scope: layers, ...(scoped.page ? { page: scoped.page } : {}) };
      const rip = rippleSpec(spec, scope, readMarkers(spec, scoped.page), { at: Math.round(ta), by: -Math.round(tb - ta) });
      if (rip.rep.blocked.length) {
        return errResult(op, `Closing ${Math.round(ta)}–${Math.round(tb)}ms would swallow: ${rip.rep.blocked.slice(0, 6).join('; ')}.`, 'Move those first, or pass ripple:false to leave the gap.');
      }
      commitRipple(spec, scope, rip);
      layers = rip.layers;
    }
    removed += b - a;
  }

  const bak = snapshot(dPath);
  if (args.ripple === false) commitScope(spec, scoped.page, layers);
  writeYAML(dPath, spec);
  const clips = layers.flatMap(function walk(l: Layer): ClipLayer[] {
    const k = (l as ClipLayer).layers;
    return (l.id === clip.id || l.id.startsWith(`${clip.id}_`)) && l.type === 'video' ? [l as ClipLayer] : Array.isArray(k) ? k.flatMap(walk) : [];
  }).map(summarize).sort((x, y) => x.plays.from - y.plays.from);
  return okResult(op, {
    design_path: dPath, removed_ms: removed, spans, ripple: args.ripple !== false, clips,
    progress: [pOk(`Cut ${spans.length} span(s), ${removed}ms of "${clip.id}"`, clips.map(c => `${c.id}: plays ${c.plays.from}–${c.plays.until ?? '…'}ms, file ${c.file.from}–${c.file.to ?? 'end'}ms`).join(' · '))],
  }, bak);
}
