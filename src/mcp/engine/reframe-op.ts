/**
 * manage_design {op:"reframe"} — the same piece in another frame: a 16:9 promo
 * as a 9:16 story, a 1:1 post, a 4:5 feed card (V8). Written as a NEW design
 * beside the source (`<name>-9x16`), which is left as it was.
 *
 * resize scales the whole piece uniformly into the new canvas, so a 16:9 piece
 * in a 9:16 frame is a thin band across the middle. reframe re-seats the
 * piece's own blocks (reframe-layout.ts) and carries their motion with them
 * (reframe-map.ts). A page with a camera world is carried whole: its camera
 * already decides what the frame shows. The new design then goes through the
 * gate (heal, measure, top 3 with calls), so the reply says what the new frame
 * got wrong.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, readYAML, writeYAML, generateId, errResult, okResult, pOk, pInfo, buildContext } from './utils';
import { planReframe, type Span } from './reframe-layout';
import { mapSubtree, type Affine } from './reframe-map';
import { fillAxes, syncSpecPos } from '../engine-customize-tools';
import { gateDesign } from './diagnose-gate';
import { fitTextBoxes } from './reframe-text';

type ReframeArgs = { design_path: string; project_path?: string; aspect?: string; width?: number; height?: number; new_name?: string };
type World = { x: number; y: number; width: number; height: number };

/** The new canvas: the aspect on the source's short side, or the size given. */
export function reframeSize(oldW: number, oldH: number, args: Pick<ReframeArgs, 'aspect' | 'width' | 'height'>): { W: number; H: number; label: string } | null {
  if (typeof args.width === 'number' && typeof args.height === 'number') return { W: Math.round(args.width), H: Math.round(args.height), label: `${Math.round(args.width)}x${Math.round(args.height)}` };
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/.exec(args.aspect ?? '');
  const a = Number(m?.[1]), b = Number(m?.[2]);
  if (!m || !(a > 0) || !(b > 0)) return null;
  const short = Math.min(oldW, oldH);
  return a <= b ? { W: short, H: Math.round((short * b) / a), label: `${m[1]}x${m[2]}` } : { W: Math.round((short * a) / b), H: short, label: `${m[1]}x${m[2]}` };
}

const mapWorld = (w: World, m: Affine): World => ({
  x: Math.round(m.ox + m.dx + (w.x - m.ox) * m.k), y: Math.round(m.oy + m.dy + (w.y - m.oy) * m.k), width: Math.round(w.width * m.k), height: Math.round(w.height * m.k),
});

/** A band that ran to an edge runs to the new frame's edge: b26's sea stopped 420 px above the bottom. */
function pinEdges(l: Layer, span: Span, W: number, H: number): void {
  const o = l as unknown as { x?: number; y?: number; width?: number; height?: number };
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.width !== 'number' || typeof o.height !== 'number') return;
  if (!span.h && span.bottom) o.height = Math.max(o.height, H - o.y);
  if (!span.h && span.top) { o.height += o.y; o.y = 0; }
  if (!span.w && span.right) o.width = Math.max(o.width, W - o.x);
  if (!span.w && span.left) { o.width += o.x; o.x = 0; }
}

/** One surface's layers re-seated for W×H; what it did, for the reply. */
function reframeSurface(layers: Layer[], holder: { world?: World }, oldW: number, oldH: number, W: number, H: number): string {
  if (holder.world) {
    const k = Math.min(W / oldW, H / oldH);
    const m: Affine = { k, ox: oldW / 2, oy: oldH / 2, dx: W / 2 - oldW / 2, dy: H / 2 - oldH / 2 };
    for (const l of layers) mapSubtree(l, m);
    holder.world = mapWorld(holder.world, m);
    return `carried whole at ×${k.toFixed(2)} (a camera world decides what the frame shows)`;
  }
  const plan = planReframe(layers, oldW, oldH, W, H);
  for (const [l, m] of plan.maps) { mapSubtree(l, m); syncSpecPos(l); }
  for (const [l, span] of plan.spans) { fillAxes(l, span, W, H); pinEdges(l, span, W, H); }
  for (const g of plan.holders) Object.assign(g, { x: 0, y: 0, width: W, height: H });
  const trimmed = fitTextBoxes(layers, W, H);
  return `${plan.blocks} block(s) at ×${plan.k.toFixed(2)}${plan.stacked ? `, ${plan.stacked} side-by-side group(s) stacked into a column` : ''}${trimmed ? `, ${trimmed} text box(es) trimmed to their letters` : ''}`;
}

export function reframeDesign(args: ReframeArgs): ToolResult {
  const op = 'reframe';
  const progress: ProgressItem[] = [];
  const src = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(src)) return errResult(op, `Design not found: ${src}`, 'Check the design_path value.');
  const spec = readYAML<DesignSpec>(src);
  const oldW = spec.document.width, oldH = spec.document.height;
  const size = reframeSize(oldW, oldH, args);
  if (!size) return errResult(op, 'Say which frame: aspect "9:16", "1:1", "4:5" — or width and height.', 'e.g. manage_design {op:"reframe", design_path, aspect:"9:16"}.');
  const { W, H } = size;
  if (W < 80 || H < 80 || W > 20000 || H > 20000) return errResult(op, `Refusing a ${W}×${H} canvas.`, 'Width and height must each be between 80 and 20000 px.');
  if (W === oldW && H === oldH) return errResult(op, `"${spec.meta.name}" is already ${W}×${H}.`, 'Pick another aspect.');

  const base = path.basename(src).replace(/\.design\.yaml$/, '');
  const name = (args.new_name ?? `${base}-${size.label}`).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const out = path.join(path.dirname(src), `${name}.design.yaml`);
  if (fs.existsSync(out)) return errResult(op, `Design already exists: ${out}`, 'Pass new_name, or delete the old reframe first.');

  const surfaces: Array<{ layers: Layer[]; holder: { world?: World }; id?: string }> = spec.pages?.length
    ? spec.pages.map((p: Page) => ({ layers: p.layers ?? [], holder: p as { world?: World }, id: p.id }))
    : [{ layers: spec.layers ?? [], holder: spec as unknown as { world?: World } }];
  for (const s of surfaces) progress.push(pOk(s.id ? `Page ${s.id}` : 'Canvas', reframeSurface(s.layers, s.holder, oldW, oldH, W, H)));

  const today = new Date().toISOString().split('T')[0];
  spec.meta = { ...spec.meta, id: generateId(), name: `${spec.meta.name} ${size.label.replace('x', ':')}`, created: today, modified: today };
  spec.document = { ...spec.document, width: W, height: H };
  writeYAML(out, spec);
  progress.push(pInfo(`${oldW}×${oldH} → ${W}×${H}`, `written as ${path.basename(out)}; the source is unchanged`));

  const gate = gateDesign({ design_path: out }) as ToolResult & { ready?: boolean; verdict?: string; top?: unknown[]; next_action?: unknown };
  return okResult(op, {
    design_path: out, source: src, canvas: `${W}×${H}`,
    review: { ready: gate.ready, verdict: gate.verdict, top: gate.top },
    progress, next_action: gate.next_action,
    context: buildContext(op, `Reframed "${base}" to ${W}×${H}`, [{ type: 'design', path: out, role: 'created' }]),
  });
}
