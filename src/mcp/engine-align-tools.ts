// Auto-align / distribute / snap-to-grid a set of layers — the fix for the
// misalignment findings diagnose reports. Mutates positions in place and writes
// the YAML.
//
// Split out of engine-export-tools.ts, which was at the 700-line ceiling (§0.3)
// and shares nothing with this: aligning layers is a geometry edit, not an
// export. Same reason batch_create moved to engine-batch-tools.ts.
import * as fs from 'fs';
import { findTargets, translateSubtree } from './engine/layer-transform';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult, ProgressItem } from './types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext } from './engine/utils';
import { LOCKED_EDIT_NOTE } from './engine/layer-lookup';
import { buildEditorLink } from './engine/editor-link';


export function alignLayers(args: { design_path: string; layer_ids: string[]; operation: string; project_path?: string; page_id?: string; grid?: number }): ToolResult {
  const op = 'align_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const arr: Layer[] = (args.page_id && spec.pages) ? (spec.pages.find(p => p.id === args.page_id)?.layers ?? []) : (spec.pages ? spec.pages[0]?.layers ?? [] : spec.layers ?? []);
  const getXY = (l: Layer): { x: number; y: number; w: number; h: number } | null => {
    const p = (l as { pos?: unknown }).pos;
    if (Array.isArray(p) && p.length >= 4 && p.every(n => typeof n === 'number')) return { x: p[0] as number, y: p[1] as number, w: p[2] as number, h: p[3] as number };
    if ([l.x, l.y, l.width, (l as { height?: unknown }).height].every(v => typeof v === 'number')) return { x: l.x as number, y: l.y as number, w: l.width as number, h: (l as { height: number }).height };
    return null;
  };
  // Moves go through translateSubtree: a group's children and a path's `d`
  // are absolute, so moving only the box left the ink behind — the reply said
  // aligned and the drawing stayed put (layer-transform.ts).
  const setXY = (l: Layer, x: number, y: number): void => {
    const was = getXY(l);
    if (was) translateSubtree(l, Math.round(x) - was.x, Math.round(y) - was.y);
  };
  // Every MCP poster is ONE group, so a flat scan of the page's top level found
  // nothing for 267 of 279 real designs: `align` answered "No positioned target
  // layers found" for the inner layers `update` has always been able to reach.
  // A batch op reports what it could not do rather than quietly doing less
  // (`unresolved`, patch_design's convention). A named layer inside a LOCKED
  // group is aligned like any other and named in the reply (LOCKED_EDIT_NOTE).
  const { targets, unresolved, locked } = findTargets(arr, args.layer_ids);
  const boxed = targets.map(l => ({ l, b: getXY(l) })).filter((t): t is { l: Layer; b: { x: number; y: number; w: number; h: number } } => !!t.b);
  if (boxed.length < 1) return errResult(op, 'No positioned target layers found.', 'Pass layer_ids that exist on the page and have numeric positions.', progress);

  const o = args.operation;
  const grid = typeof args.grid === 'number' && args.grid > 0 ? args.grid : 8;
  const minX = Math.min(...boxed.map(t => t.b.x)), maxR = Math.max(...boxed.map(t => t.b.x + t.b.w));
  const minY = Math.min(...boxed.map(t => t.b.y)), maxB = Math.max(...boxed.map(t => t.b.y + t.b.h));
  for (const { l, b } of boxed) {
    if (o === 'left') setXY(l, minX, b.y);
    else if (o === 'right') setXY(l, maxR - b.w, b.y);
    else if (o === 'top') setXY(l, b.x, minY);
    else if (o === 'bottom') setXY(l, b.x, maxB - b.h);
    else if (o === 'center_h') setXY(l, (minX + maxR) / 2 - b.w / 2, b.y);
    else if (o === 'center_v') setXY(l, b.x, (minY + maxB) / 2 - b.h / 2);
    else if (o === 'snap_grid') setXY(l, Math.round(b.x / grid) * grid, Math.round(b.y / grid) * grid);
  }
  if ((o === 'distribute_h' || o === 'distribute_v') && boxed.length >= 3) {
    const horiz = o === 'distribute_h';
    const sorted = [...boxed].sort((a, c) => horiz ? a.b.x - c.b.x : a.b.y - c.b.y);
    const first = sorted[0].b, last = sorted[sorted.length - 1].b;
    const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
    const totalSize = sorted.reduce((s, t) => s + (horiz ? t.b.w : t.b.h), 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = horiz ? first.x : first.y;
    for (const t of sorted) { if (horiz) { setXY(t.l, cursor, t.b.y); cursor += t.b.w + gap; } else { setXY(t.l, t.b.x, cursor); cursor += t.b.h + gap; } }
  }

  const backup = snapshot(dPath);
  writeYAML(dPath, spec);
  progress.push(pOk(`Aligned ${boxed.length} layer(s)`, o));
  if (unresolved.length) progress.push(pWarn('Not found — nothing aligned for these', unresolved.join(', ')));
  if (locked.length) progress.push(pInfo(LOCKED_EDIT_NOTE, locked.join(', ')));
  const context = buildContext(op, `Aligned ${boxed.length} layer(s) (${o}) in "${spec.meta.name}"`);
  const link = buildEditorLink(dPath);
  return okResult(op, {
    status: 'ok', operation: o, aligned: boxed.map(t => t.l.id),
    ...(unresolved.length ? { unresolved } : {}),
    ...(locked.length ? { in_locked_group: locked } : {}),
    backup, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, _attachments: [link.attachment],
  });
}