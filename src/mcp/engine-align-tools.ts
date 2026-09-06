// Auto-align / distribute / snap-to-grid a set of layers — the fix for the
// misalignment findings diagnose reports. Mutates positions in place and writes
// the YAML.
//
// Split out of engine-export-tools.ts, which was at the 700-line ceiling (§0.3)
// and shares nothing with this: aligning layers is a geometry edit, not an
// export. Same reason batch_create moved to engine-batch-tools.ts.
import * as fs from 'fs';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult, ProgressItem } from './types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, buildContext } from './engine/utils';
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
  const setXY = (l: Layer, x: number, y: number): void => {
    const o = l as unknown as Record<string, unknown>;
    const nx = Math.round(x), ny = Math.round(y);
    const was = getXY(l);
    const p = (l as { pos?: number[] }).pos;
    if (Array.isArray(p)) { p[0] = nx; p[1] = ny; }
    else { (l as { x: number }).x = nx; (l as { y: number }).y = ny; }
    // A line/connector draws from ABSOLUTE endpoints; moving only the box
    // leaves the ink behind, so the layer reports where it was aligned to and
    // renders where it used to be. Same disagreement update_layer had.
    const dx = was ? nx - was.x : 0;
    const dy = was ? ny - was.y : 0;
    if (dx || dy) {
      for (const [k, d] of [['x1', dx], ['x2', dx], ['y1', dy], ['y2', dy]] as const) {
        if (typeof o[k] === 'number') o[k] = (o[k] as number) + d;
      }
    }
  };
  // Every MCP poster is ONE group, so a flat scan of the page's top level found
  // nothing for 267 of 279 real designs: `align` answered "No positioned target
  // layers found" for the inner layers `update` has always been able to reach.
  // Group children carry ABSOLUTE document coordinates, so aligning across
  // groups needs no transform — only the search had to learn to descend.
  const wanted = new Set(args.layer_ids);
  const found = new Map<string, { l: Layer; lockedBy?: string }>();
  const descend = (layers: Layer[], lockedAncestor?: string): void => {
    for (const l of layers) {
      if (wanted.has(l.id) && !found.has(l.id)) found.set(l.id, { l, ...(lockedAncestor ? { lockedBy: lockedAncestor } : {}) });
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (l.type === 'group' && Array.isArray(kids)) {
        descend(kids, lockedAncestor ?? ((l as { locked?: unknown }).locked ? l.id : undefined));
      }
    }
  };
  descend(arr);

  // A batch op reports what it could not do rather than quietly doing less —
  // `align` used to filter unknown ids away and still answer success:true with a
  // shorter `aligned` list, leaving the caller to diff the arrays to notice.
  // patch_design already had the right convention (`unresolved`); this follows it.
  const unresolved = args.layer_ids.filter(id => !found.has(id));
  const locked = [...found.values()].filter(f => f.lockedBy).map(f => `${f.l.id} (in "${f.lockedBy}")`);
  const targets = [...found.values()].filter(f => !f.lockedBy).map(f => f.l);
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
  if (locked.length) progress.push(pWarn('Inside a LOCKED group — left alone', locked.join(', ')));
  const context = buildContext(op, `Aligned ${boxed.length} layer(s) (${o}) in "${spec.meta.name}"`);
  const link = buildEditorLink(dPath);
  return okResult(op, {
    status: 'ok', operation: o, aligned: boxed.map(t => t.l.id),
    ...(unresolved.length ? { unresolved } : {}),
    ...(locked.length ? { skipped_locked: locked } : {}),
    backup, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, _attachments: [link.attachment],
  });
}