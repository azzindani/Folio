/**
 * `animation(op:precomp | link)` — nested time and secondary motion.
 *
 *   precomp  a group with its own clock (After Effects' pre-composition): its
 *            children are authored from local 0 and play from `start`, at
 *            `speed`, repeating every `loop_ms`. Wrap loose layers into one, or
 *            duplicate one as a second instance of the same sub-sequence.
 *   link     a layer follows another layer's track `lag` ms later, its travel
 *            scaled by `factor` — follow-through and overlapping action, the
 *            motion that makes a piece feel physical. It rides on a wrapper
 *            (<id>_link) so the layer's own track keeps playing inside it.
 *
 * Both store intent only (`clock`, `link`); timeline-resolve.ts turns them
 * into scene-clock tracks for the SVG and the flipbook alike.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec, LayerClock, LinkChannel, LayerLink } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { collectLayerIds, bakeOffsetDeep } from '../engine-finalize-geom';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, pWarn } from './utils';
import { resolveScope, commitScope, toIdList } from './motion';
import { syncAnimationsToSpec } from './animation-sync';
import { readMarkers, resolveTime, type TimeContext } from './motion-time';
import { resolveTimeline } from '../../animation/timeline-resolve';
import { drawnBox } from '../../export/frame-geometry';

type Node = Layer & { layers?: Layer[]; clock?: LayerClock; animation?: AnimationSpec; in?: number; out?: number; motion_path?: unknown };

export const LINK_CHANNELS: LinkChannel[] = ['x', 'y', 'rotation', 'scale', 'scale_x', 'scale_y', 'skew_x', 'skew_y', 'opacity', 'blur'];
export const LINK_WRAP = '_link';

/** The list a layer sits in, and where — at any depth. */
export function findParentList(layers: Layer[], id: string): { list: Layer[]; index: number } | null {
  const i = layers.findIndex(l => l.id === id);
  if (i >= 0) return { list: layers, index: i };
  for (const l of layers) {
    const kids = (l as Node).layers;
    const hit = Array.isArray(kids) ? findParentList(kids, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** True when `id` sits anywhere inside `layer`. */
export function contains(layer: Layer, id: string): boolean {
  const kids = (layer as Node).layers;
  return Array.isArray(kids) && kids.some(k => k.id === id || contains(k, id));
}

/** Shift an all-absolute path by (dx, dy); null when it has relative commands or arcs. */
function shiftPath(d: string, dx: number, dy: number): string | null {
  if (!/^[MLHVCSQTZ\s\d.,eE+-]*$/.test(d)) return null;
  const out: string[] = [];
  for (const [, cmd, args] of d.matchAll(/([MLHVCSQTZ])([^MLHVCSQTZ]*)/g)) {
    const n = (args ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const moved = cmd === 'H' ? n.map(v => v + dx) : cmd === 'V' ? n.map(v => v + dy) : n.map((v, i) => v + (i % 2 === 0 ? dx : dy));
    out.push(`${cmd}${moved.length ? ` ${moved.map(v => Number(v.toFixed(3))).join(' ')}` : ''}`);
  }
  return out.join(' ');
}

/**
 * A second instance of a precomp: every id suffixed and kept unique, moved by
 * (dx, dy). Returns the copy and any child that could not be moved exactly.
 */
export function cloneInstance(src: Layer, newId: string, used: Set<string>, dx: number, dy: number): { copy: Layer; unmoved: string[] } {
  const unmoved: string[] = [];
  const fresh = (base: string): string => {
    let id = `${base}_${newId}`, n = 2;
    while (used.has(id)) id = `${base}_${newId}_${n++}`;
    used.add(id);
    return id;
  };
  const copy = JSON.parse(JSON.stringify(src)) as Node;
  const renameDeep = (l: Node, top: boolean): void => {
    l.id = top ? newId : fresh(l.id);
    if (Array.isArray(l.layers)) for (const k of l.layers) renameDeep(k as Node, false);
  };
  used.add(newId);
  renameDeep(copy, true);
  if (dx !== 0 || dy !== 0) {
    bakeOffsetDeep(copy, dx, dy);
    const shiftShapes = (l: Node): void => {
      const o = l as unknown as Record<string, unknown>;
      if (typeof o['d'] === 'string') {
        const moved = shiftPath(o['d'], dx, dy);
        if (moved) o['d'] = moved; else unmoved.push(l.id);
      }
      if (typeof o['points'] === 'string') {
        o['points'] = (o['points'].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map((v, i) => Number(v) + (i % 2 === 0 ? dx : dy)).join(' ');
      }
      if (Array.isArray(l.layers)) for (const k of l.layers) shiftShapes(k as Node);
    };
    shiftShapes(copy);
  }
  return { copy, unmoved };
}

/** Things a clock does not reach, worth one line each in the reply. */
export function clockNotes(group: Layer, clock: LayerClock): string[] {
  const notes: string[] = [];
  const kids: Node[] = [];
  const walk = (ls: Layer[]): void => { for (const l of ls as Node[]) { kids.push(l); if (Array.isArray(l.layers)) walk(l.layers); } };
  walk((group as Node).layers ?? []);
  if (!kids.some(k => k.animation?.keyframes?.length)) notes.push('Nothing inside moves yet — the clock times the tracks you add to its children.');
  const paths = kids.filter(k => k.motion_path).map(k => k.id);
  if (paths.length) notes.push(`${paths.join(', ')} travel a motion_path, which plays on the scene clock, not the precomp's.`);
  const windows = kids.filter(k => k.in !== undefined || k.out !== undefined).map(k => k.id);
  if (clock.loop && windows.length) notes.push(`${windows.join(', ')} have in/out points: in a looping precomp they apply to its first cycle only.`);
  return notes;
}

/** Where each track inside a group runs on the scene clock, once its clocks are resolved. */
function sceneSpans(scope: Layer[], groupId: string): Array<{ id: string; start_ms: number; end_ms: number }> {
  const group = findParentList(resolveTimeline(scope), groupId);
  const g = group?.list[group.index] as Node | undefined;
  const out: Array<{ id: string; start_ms: number; end_ms: number }> = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls as Node[]) {
      const pb = l.animation?.playback;
      if (l.animation?.keyframes?.length && pb) {
        const start = Math.round(pb.delay ?? 0);
        out.push({ id: l.id, start_ms: start, end_ms: Math.round(start + pb.duration) });
      }
      if (Array.isArray(l.layers)) walk(l.layers);
    }
  };
  walk(g?.layers ?? []);
  return out.slice(0, 20);
}

/** Where one layer's resolved track plays on the scene clock — what a link turned into. */
function resolvedSpan(scope: Layer[], id: string): { start_ms?: number; end_ms?: number } {
  const hit = findParentList(resolveTimeline(scope), id);
  const pb = (hit?.list[hit.index] as Node | undefined)?.animation?.playback;
  return pb ? { start_ms: Math.round(pb.delay ?? 0), end_ms: Math.round((pb.delay ?? 0) + pb.duration) } : {};
}

type PrecompArgs = {
  design_path: string; page_id?: string; project_path?: string;
  layer_id?: string; layer_ids?: unknown; start?: unknown; speed?: number; loop_ms?: number; clear?: boolean; duplicate?: unknown;
};

export function precompMotion(args: PrecompArgs): ToolResult {
  const op = 'precomp';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = args.layer_id;
  if (!id) return errResult(op, 'layer_id is required — the precomp group (or the id for a new one, with layer_ids).', 'e.g. layer_id:"cards", start:"problem", speed:1.5');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const scope = scoped.scope;
  const ctx: TimeContext = { markers: readMarkers(spec, scoped.page), layers: scope };
  const progress: ProgressItem[] = [];

  let at = findParentList(scope, id);
  const wrap = toIdList(args.layer_ids);
  if (!at) {
    if (!wrap) return errResult(op, `No layer "${id}". To make a precomp, pass layer_ids — the layers to put in it.`, 'manage_design {op:"inspect"} lists the ids.');
    const first = findParentList(scope, wrap[0] ?? '');
    if (!first) return errResult(op, `No layer "${wrap[0]}".`, 'manage_design {op:"inspect"} lists the ids.');
    const members = wrap.map(w => first.list.find(l => l.id === w));
    if (members.some(m => !m)) return errResult(op, 'layer_ids must sit side by side in the same group (or all at the page root).', 'Wrap siblings; nest precomps for layers in different groups.');
    const kept = first.list.filter(l => wrap.includes(l.id));
    const z = Math.min(...kept.map(l => (l as Node & { z?: number }).z ?? 1));
    const group = { id, type: 'group', z, layers: kept } as unknown as Layer;
    const rest = first.list.filter(l => !wrap.includes(l.id));
    rest.splice(Math.min(first.index, rest.length), 0, group);
    first.list.splice(0, first.list.length, ...rest);
    at = findParentList(scope, id);
    progress.push(pOk(`Made precomp "${id}"`, `from ${kept.length} layer(s)`));
  } else if (wrap) {
    return errResult(op, `"${id}" already exists — layer_ids only makes a new precomp.`, 'Drop layer_ids to change its clock.');
  }
  const group = at?.list[at.index] as Node | undefined;
  if (!group || group.type !== 'group' || !Array.isArray(group.layers)) {
    return errResult(op, `"${id}" is a ${group?.type ?? 'missing layer'}, not a group — only a group runs its own clock.`, `Wrap it: layer_id:"${id}_pc", layer_ids:["${id}"].`);
  }

  const bak = snapshot(dPath);
  if (args.clear) delete group.clock;
  else {
    const clock: LayerClock = { ...(group.clock ?? {}) };
    if (args.start !== undefined) {
      const t = resolveTime(args.start, ctx);
      if (typeof t === 'string') return errResult(op, `start: ${t}`, 'A time in ms or a name like "problem+200".');
      clock.start = t;
    }
    if (args.speed !== undefined) {
      if (typeof args.speed !== 'number' || !(args.speed > 0)) return errResult(op, 'speed must be a number above 0.', '2 plays twice as fast; 0.5 at half speed.');
      clock.speed = args.speed;
    }
    if (args.loop_ms !== undefined) {
      if (typeof args.loop_ms !== 'number' || args.loop_ms < 0) return errResult(op, 'loop_ms must be ms ≥ 0 (0 stops the loop).', 'e.g. loop_ms:2000 repeats the sub-sequence every 2 s of its own time.');
      if (args.loop_ms > 0) clock.loop = args.loop_ms; else delete clock.loop;
    }
    group.clock = clock;
    for (const n of clockNotes(group, clock)) progress.push(pInfo('Note', n));
  }

  let copyId: string | undefined;
  if (args.duplicate !== undefined) {
    const d = (args.duplicate && typeof args.duplicate === 'object' ? args.duplicate : {}) as Record<string, unknown>;
    if (typeof d['id'] !== 'string' || !d['id']) return errResult(op, 'duplicate needs an id for the copy.', 'e.g. duplicate:{id:"cards_b", start:"cta", dx:0, dy:320}');
    const used = collectLayerIds(spec);
    if (used.has(d['id'])) return errResult(op, `"${d['id']}" is already taken.`, 'Pick a new id for the copy.');
    const { copy, unmoved } = cloneInstance(group, d['id'], used, typeof d['dx'] === 'number' ? d['dx'] : 0, typeof d['dy'] === 'number' ? d['dy'] : 0);
    if (d['start'] !== undefined) {
      const t = resolveTime(d['start'], ctx);
      if (typeof t === 'string') return errResult(op, `duplicate.start: ${t}`, 'A time in ms or a name.');
      (copy as Node).clock = { ...((copy as Node).clock ?? {}), start: t };
    }
    at?.list.splice((at?.index ?? 0) + 1, 0, copy);
    copyId = copy.id;
    progress.push(pOk(`Duplicated as "${copy.id}"`, 'a second instance of the same sub-sequence, on its own clock'));
    if (unmoved.length) progress.push(pWarn('Not moved', `${unmoved.join(', ')} use relative path commands; place the copy with a state instead of dx/dy.`));
  }

  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);
  progress.unshift(pOk(args.clear ? `Cleared the clock on "${id}"` : `"${id}" runs its own clock`, group.clock ? JSON.stringify(group.clock) : 'its children play on the scene clock again'));
  return okResult(op, {
    design_path: dPath, precomp: id, clock: group.clock ?? null, ...(copyId ? { copy: copyId } : {}),
    scene_spans: sceneSpans(scope, id), progress,
    next_action: { tool: 'animation', params: { op: 'timeline', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'scene_spans is where each child\'s track now plays on the scene clock. Author children from local 0 (op:sequence / op:storyboard on their ids).' },
  }, bak);
}

type LinkArgs = {
  design_path: string; page_id?: string; project_path?: string;
  layer_id?: string; layer_ids?: unknown; to?: string; channels?: unknown; lag?: number; factor?: number; stagger_ms?: number; clear?: boolean;
};

export function linkMotion(args: LinkArgs): ToolResult {
  const op = 'link';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const ids = toIdList(args.layer_ids) ?? (args.layer_id ? [args.layer_id] : undefined);
  if (!ids) return errResult(op, 'layer_id (or layer_ids) is required — the layers that follow.', 'e.g. layer_ids:["shadow"], to:"card", lag:90, factor:0.6');
  const spec = readYAML<DesignSpec>(dPath);
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
  const scope = scoped.scope;
  const bak = snapshot(dPath);

  if (args.clear) {
    const cleared: string[] = [];
    for (const id of ids) {
      const w = findParentList(scope, id.endsWith(LINK_WRAP) ? id : `${id}${LINK_WRAP}`);
      const wrapper = w?.list[w.index] as Node | undefined;
      const inner = wrapper?.layers?.[0];
      if (!w || !inner) continue;
      w.list.splice(w.index, 1, inner);
      cleared.push(inner.id);
    }
    commitScope(spec, scoped.page, scope);
    syncAnimationsToSpec(spec);
    writeYAML(dPath, spec);
    return okResult(op, { design_path: dPath, cleared, progress: [pOk(`Unlinked ${cleared.length} layer(s)`)] }, bak);
  }

  const to = args.to;
  if (!to) return errResult(op, 'to is required — the layer to follow.', 'e.g. to:"card"');
  const target = findParentList(scope, to);
  if (!target) return errResult(op, `No layer "${to}" to follow.`, 'manage_design {op:"inspect"} lists the ids.');
  let channels: LinkChannel[] | undefined;
  if (args.channels !== undefined) {
    const list = toIdList(args.channels) ?? [];
    const bad = list.filter(c => !(LINK_CHANNELS as string[]).includes(c));
    if (bad.length || list.length === 0) return errResult(op, `channels ${bad.join(', ') || '(empty)'} cannot be followed.`, `Channels: ${LINK_CHANNELS.join(', ')}.`);
    channels = list as LinkChannel[];
  }
  const lag = typeof args.lag === 'number' ? Math.max(0, args.lag) : 100;
  const factor = typeof args.factor === 'number' ? args.factor : 1;
  const stagger = Math.max(0, args.stagger_ms ?? 0);

  const wrappers: Array<{ wrapper: string; follows: string; lag: number }> = [];
  for (const [i, id] of ids.entries()) {
    if (id === to) return errResult(op, `"${id}" cannot follow itself.`, 'Pick another layer to follow.');
    const spot = findParentList(scope, id);
    const layer = spot?.list[spot.index];
    if (!spot || !layer) return errResult(op, `No layer "${id}".`, 'manage_design {op:"inspect"} lists the ids.');
    if (contains(layer, to)) return errResult(op, `"${to}" sits inside "${id}" — it would follow its own motion.`, 'Link a sibling, or move the target out of the group.');
    const link: LayerLink = { to, lag: lag + stagger * i, ...(factor !== 1 ? { factor } : {}), ...(channels ? { channels } : {}) };
    const wrapperId = id.endsWith(LINK_WRAP) ? id : `${id}${LINK_WRAP}`;
    const existing = findParentList(scope, wrapperId);
    if (existing) (existing.list[existing.index] as Node & { link?: LayerLink }).link = link;
    else {
      // The wrapper's box is the layer's drawn box, so rotate and scale pivot on the layer itself.
      const box = drawnBox(layer);
      spot.list.splice(spot.index, 1, {
        id: wrapperId, type: 'group', z: (layer as Node & { z?: number }).z ?? 1,
        ...(box ? { x: box.x, y: box.y, width: box.width, height: box.height } : {}), link, layers: [layer],
      } as unknown as Layer);
    }
    wrappers.push({ wrapper: wrapperId, follows: to, lag: link.lag ?? 0 });
  }
  commitScope(spec, scoped.page, scope);
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const progress: ProgressItem[] = [pOk(`Linked ${wrappers.length} layer(s) to "${to}"`, `${lag}ms behind${stagger ? `, +${stagger}ms each` : ''}${factor !== 1 ? `, ×${factor} travel` : ''} — each on a <id>_link wrapper`)];
  const moves = (target.list[target.index] as Node).animation?.keyframes?.length;
  if (!moves) progress.push(pWarn('Target does not move', `"${to}" has no track yet — the followers stay still until it gets one.`));
  return okResult(op, {
    design_path: dPath, wrappers: wrappers.map(w => ({ ...w, ...resolvedSpan(scope, w.wrapper) })),
    progress,
    next_action: { tool: 'animation', params: { op: 'frame', design_path: dPath, ...(args.page_id ? { page_id: args.page_id } : {}) }, remaining: 0,
      hint: 'The link is live: change the target\'s track and the followers follow. clear:true unwraps them.' },
  }, bak);
}
