// edit_layer {op:"move"} and {op:"scale"} — revise a layer by id, as drawn.
//
// Revising a draft meant patch_design index paths (layers[3].x) or
// update_layer on a box, and neither carries what a group or path DRAWS: a
// group's children and a path's `d` are absolute, so the box moved and the ink
// stayed (layer-transform.ts). These move or scale the selection as one block,
// children and all — the revise half of review:true, which says where the
// empty space and the weight are.
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult, ProgressItem } from './types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, buildContext } from './engine/utils';
import { buildEditorLink } from './engine/editor-link';
import { drawnBox, findTargets, scaleAbout, translateSubtree, union, type Rect } from './engine/layer-transform';

interface Common { design_path: string; project_path?: string; page_id?: string; layer_id?: string; layer_ids?: string[] }
export interface MoveArgs extends Common { dx?: number; dy?: number; x?: number; y?: number; to?: 'center' | 'center_h' | 'center_v' }
export interface ScaleArgs extends Common { factor?: number; width?: number; height?: number; anchor?: string }

const ANCHORS: Record<string, [number, number]> = {
  center: [0.5, 0.5], top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5],
  right: [1, 0.5], bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1],
};

const box = (r: Rect): { x: number; y: number; width: number; height: number } =>
  ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) });

type Loaded = { dPath: string; spec: DesignSpec; targets: Layer[]; block: Rect; unresolved: string[]; locked: string[] };

/** Read the design, find the selection on its page, measure it as one block. */
function load(op: string, a: Common): Loaded | ToolResult {
  const dPath = resolveDesignPath(a.design_path, a.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  if (a.page_id && spec.pages && !spec.pages.some(p => p.id === a.page_id)) {
    return errResult(op, `Page not found: ${a.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`);
  }
  const layers = spec.pages?.length ? (spec.pages.find(p => p.id === a.page_id) ?? spec.pages[0])?.layers ?? [] : spec.layers ?? [];
  const ids = a.layer_ids?.length ? a.layer_ids : a.layer_id ? [a.layer_id] : [];
  if (!ids.length) return errResult(op, 'No layer named.', 'Pass layer_id, or layer_ids to move/scale several as one block.');
  const { targets, unresolved, locked } = findTargets(layers, ids);
  const block = union(targets.map(drawnBox).filter((b): b is Rect => b !== null));
  if (!block) {
    const why = locked.length ? `Inside a LOCKED group: ${locked.join(', ')} — move the locked group itself, or use patch_design.` : `Not found or not positioned: ${ids.join(', ')}.`;
    return errResult(op, 'Nothing to edit.', why);
  }
  return { dPath, spec, targets, block, unresolved, locked };
}

/** Write, then answer with the block before/after and the editor link. */
function commit(op: string, l: Loaded, before: Rect, detail: string, extra: Record<string, unknown>): ToolResult {
  const progress: ProgressItem[] = [];
  const backup = snapshot(l.dPath);
  writeYAML(l.dPath, l.spec);
  const after = union(l.targets.map(drawnBox).filter((b): b is Rect => b !== null)) ?? before;
  progress.push(pOk(`${op === 'move_layers' ? 'Moved' : 'Scaled'} ${l.targets.length} layer(s)`, detail));
  if (l.unresolved.length) progress.push(pWarn('Not found — left alone', l.unresolved.join(', ')));
  if (l.locked.length) progress.push(pWarn('Inside a LOCKED group — left alone', l.locked.join(', ')));
  const link = buildEditorLink(l.dPath);
  return okResult(op, {
    status: 'ok', layers: l.targets.map(t => t.id), ...extra, before: box(before), after: box(after),
    ...(l.unresolved.length ? { unresolved: l.unresolved } : {}),
    ...(l.locked.length ? { skipped_locked: l.locked } : {}),
    backup, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress,
    context: buildContext(op, `${detail} in "${l.spec.meta.name}"`), _attachments: [link.attachment],
  });
}

/** Move the selection as one block: by dx/dy, to a top-left x/y, or centred on the canvas. */
export function moveLayers(args: MoveArgs): ToolResult {
  const op = 'move_layers';
  const l = load(op, args);
  if ('success' in l) return l;
  const W = l.spec.document?.width ?? 0, H = l.spec.document?.height ?? 0;
  const b = l.block;
  let dx = args.dx ?? 0, dy = args.dy ?? 0;
  if (args.to) {
    if (args.to !== 'center_v') dx = W / 2 - (b.x + b.w / 2);
    if (args.to !== 'center_h') dy = H / 2 - (b.y + b.h / 2);
  } else {
    if (typeof args.x === 'number') dx = args.x - b.x;
    if (typeof args.y === 'number') dy = args.y - b.y;
  }
  dx = Math.round(dx); dy = Math.round(dy);
  if (!dx && !dy) return errResult(op, 'Nothing to move — the block is already there.', 'Pass dx/dy, x/y (the block\'s new top-left) or to:"center"|"center_h"|"center_v".');
  for (const t of l.targets) translateSubtree(t, dx, dy);
  return commit(op, l, b, `dx ${dx}, dy ${dy}${args.to ? ` (${args.to} on the ${W}×${H} canvas)` : ''}`, { dx, dy });
}

/** Scale the selection as one block about an anchor — type, strokes and gaps with it. */
export function scaleLayers(args: ScaleArgs): ToolResult {
  const op = 'scale_layers';
  const l = load(op, args);
  if ('success' in l) return l;
  const b = l.block;
  const k = typeof args.factor === 'number' ? args.factor
    : typeof args.width === 'number' && b.w > 0 ? args.width / b.w
      : typeof args.height === 'number' && b.h > 0 ? args.height / b.h : NaN;
  if (!Number.isFinite(k) || k < 0.05 || k > 20) return errResult(op, 'No usable scale.', 'Pass factor (0.05–20), or width / height — the size the block should draw at.');
  const anchor = args.anchor ?? 'center';
  const [fx, fy] = ANCHORS[anchor] ?? [NaN, NaN];
  if (!Number.isFinite(fx)) return errResult(op, `Unknown anchor: ${anchor}`, `Use one of: ${Object.keys(ANCHORS).join(', ')}.`);
  const ox = b.x + b.w * fx, oy = b.y + b.h * fy;
  for (const t of l.targets) scaleAbout(t, k, ox, oy);
  return commit(op, l, b, `×${Math.round(k * 1000) / 1000} about ${anchor}`, { factor: Math.round(k * 1000) / 1000, anchor });
}
