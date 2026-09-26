/**
 * Edits to generated items (phase 3, S6) — the MCP doors of gallery overrides
 * (renderer/gallery-overrides.ts). edit_layer update/remove and patch_design
 * name a gallery's cells by the ids every reply shows (people_4_role); those
 * ids are not in the file, so the edit is stored as an override on the
 * gallery that makes them, in the template's frame, and replayed on every
 * resolve. A diagnose call naming a generated id works the same way.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo } from './utils';
import { resolveSpec } from '../../renderer/resolve-source';
import { findGenerated, findIn, withItemOverride, type GeneratedHit } from '../../renderer/gallery-edit';

export { findGenerated } from '../../renderer/gallery-edit';

/** Store `props` (null: take the item out) as the item's override, in place on the spec. An error string, or null. */
export function writeOverride(hit: GeneratedHit, props: Record<string, unknown> | null): string | null {
  const next = withItemOverride(hit, props);
  if (typeof next === 'string') return next;
  hit.gallery.gallery = next;
  return null;
}

/** A move in px as reported: a fractional cell leaves float noise (-11.666666666666629). */
const r2 = (v: number): number => Math.round(v * 100) / 100;

const SELECTOR = /^(?:pages\[id=([^\]]+)\]\.)?layers\[id=([^\]]+)\]\.([A-Za-z_][\w.]*)$/;

/**
 * A patch_design selector aimed at a generated item, stored as its override:
 * `layers[id=people_4_role].style.color` → people's overrides. Null when the
 * path names no generated item (the ordinary patch then reports it).
 */
export function patchGenerated(spec: DesignSpec, dotPath: string, value: unknown): { to: string } | { error: string } | null {
  const m = SELECTOR.exec(dotPath);
  if (!m?.[2] || !m[3]) return null;
  const hit = findGenerated(spec, m[2], m[1]);
  if (!hit) return null;
  const props = m[3].split('.').reduceRight<unknown>((v, k) => ({ [k]: v }), value) as Record<string, unknown>;
  const err = writeOverride(hit, props);
  return err ? { error: err } : { to: `layers[id=${hit.gallery.id}].gallery.overrides.${hit.key}.${m[3]}` };
}

/**
 * edit_layer op:move on ONE generated item — diagnose's usual fix call
 * ("move people_4_role 40 px up") — kept as the item's override: where it is
 * drawn now, plus the move. Null when the id is in the file or no gallery
 * makes it (the ordinary move answers then).
 */
export function moveGenerated(args: { design_path: string; project_path?: string; page_id?: string; layer_id?: string; layer_ids?: string[];
  dx?: number; dy?: number; x?: number; y?: number; to?: string }): ToolResult | null {
  const id = args.layer_id;
  if (!id || args.layer_ids?.length) return null;
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return null;
  const spec = readYAML<DesignSpec>(dPath);
  const pages = args.page_id ? (spec.pages ?? []).filter(p => p.id === args.page_id) : spec.pages ?? [];
  if (findIn([...(args.page_id ? [] : spec.layers ?? []), ...pages.flatMap(p => p.layers ?? [])], id)) return null;
  const hit = findGenerated(spec, id, args.page_id);
  if (!hit) return null;
  if (!hit.template || Array.isArray((hit.template as Layer & { layers?: unknown }).layers)) {
    return errResult('move_layers', `"${id}" is made by gallery "${hit.maker ?? hit.gallery.id}" and moves with its cell.`, 'Move one of its layers, change the gallery\'s columns / gap / cell, or detach the gallery (edit_layer op:detach).');
  }
  const drawn = resolveSpec(spec);
  const now = findIn([...(drawn.layers ?? []), ...(drawn.pages ?? []).filter(p => !args.page_id || p.id === args.page_id).flatMap(p => p.layers ?? [])], id) as (Layer & { width?: unknown; height?: unknown }) | undefined;
  const x0 = typeof now?.x === 'number' ? now.x : 0, y0 = typeof now?.y === 'number' ? now.y : 0;
  const w = typeof now?.width === 'number' ? now.width : 0, h = typeof now?.height === 'number' ? now.height : 0;
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  let x = x0 + (args.dx ?? 0), y = y0 + (args.dy ?? 0);
  if (typeof args.x === 'number') x = args.x;
  if (typeof args.y === 'number') y = args.y;
  if (args.to && args.to !== 'center_v') x = W / 2 - w / 2;
  if (args.to && args.to !== 'center_h') y = H / 2 - h / 2;
  x = Math.round(x); y = Math.round(y);
  if (x === x0 && y === y0) return errResult('move_layers', 'Nothing to move — the item is already there.', 'Pass dx/dy, x/y or to:"center".');
  const backup = snapshot(dPath);
  writeOverride(hit, { x, y });
  writeYAML(dPath, spec);
  return okResult('move_layers', {
    status: 'ok', layers: [id], dx: r2(x - x0), dy: r2(y - y0), backup,
    progress: [pOk('Moved 1 layer(s)', `dx ${r2(x - x0)}, dy ${r2(y - y0)}`), pInfo('Stored as an override of the gallery that makes it — replayed on every render', `"${id}" is made by gallery "${hit.maker ?? hit.gallery.id}"${hit.maker ? `, kept on "${hit.gallery.id}"` : ''}`)],
  });
}
