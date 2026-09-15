/**
 * `animation(op:text, remeasure:true)` — re-place the pieces of text split before
 * the fonts measured true.
 *
 * Splits made before the bundle held one static file per weight were placed by a
 * variable font's default-instance advances (Archivo SemiBold for an ExtraBold
 * headline). Once exports drew the real weight, those pieces touched — the promo's
 * "Words in." exported as "Wordsin." Re-splitting would lose each piece's motion,
 * so this moves the pieces instead, with the math splitLayer uses: the line's text
 * through charOffsets at the piece's own weight, each piece at its measured
 * offset from the line's first piece, sized by unitWidth, its mask widened around
 * it the way op:text made it. Tracks are offsets, so the motion is untouched.
 *
 * What a piece does not record: the source's alignment. Each line keeps its first
 * piece's left edge — exact for left-aligned text. Character splits dropped their
 * spaces; a gap wider than the glyph by more than 0.4 of a space was one.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult } from './utils';
import { charOffsets, letterSpacingPx, metricsForFamily, numericWeight, type FontMetrics } from '../../utils/font-metrics';
import { fontsDir, projectFontsDir } from './fonts';
import { resolveScope, commitScope } from './motion';
import { pieces } from './split-text-op';
import { unitWidth } from './text-unit-width';

type Rec = Record<string, unknown>;
type Lookup = (style: Rec) => FontMetrics | null;

const UNIT = /^(.+)_([wc])(\d+)$/;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Every split piece in a tree, with the mask group holding it, grouped by source + line. */
function collectRuns(layers: Layer[], only?: string): Map<string, Array<{ piece: Rec; mask: Rec | null; n: number; by: 'w' | 'c' }>> {
  const runs = new Map<string, Array<{ piece: Rec; mask: Rec | null; n: number; by: 'w' | 'c' }>>();
  const visit = (ls: Layer[], parent: Rec | null): void => {
    for (const l of ls) {
      const o = l as unknown as Rec;
      const m = UNIT.exec(String(o['id'] ?? ''));
      const mask = m && parent && String(parent['id'] ?? '') === `${m[1]}_mask${m[3]}` ? parent : null;
      // Named, a split is taken at its word. Unnamed, only what is surely a split moves: a piece
      // marked split_of, or one in its op:text mask — a table's "row_c1" label must never shift.
      const sure = m !== null && (m[1] === only || (!only && (o['split_of'] === m[1] || mask !== null)));
      if (m && o['type'] === 'text' && sure) {
        const key = `${m[1]}|${m[2]}|${num(o['y'])}`;
        runs.set(key, [...(runs.get(key) ?? []), { piece: o, mask, n: Number(m[3]), by: m[2] as 'w' | 'c' }]);
      }
      const kids = o['layers'];
      if (Array.isArray(kids)) visit(kids as Layer[], o);
    }
  };
  visit(layers, null);
  return runs;
}

/** Re-place one line of pieces in place. Returns how far the line's last piece moved, px. */
export function remeasureRun(run: Array<{ piece: Rec; mask: Rec | null; n: number; by: 'w' | 'c' }>, lookup: Lookup): number {
  const sorted = [...run].sort((a, b) => a.n - b.n);
  const first = sorted[0];
  if (!first) return 0;
  const style = (first.piece['style'] ?? {}) as Rec;
  const fontSize = num(style['font_size'], 16);
  const metrics = lookup(style);
  const spacing = letterSpacingPx(style['letter_spacing'], fontSize);
  const space = charOffsets(' ', fontSize, metrics, 0.54, spacing).total;
  const texts = sorted.map(u => String((u.piece['content'] as { value?: unknown } | undefined)?.value ?? ''));
  let line = texts[0] ?? '';
  for (let i = 1; i < sorted.length; i++) {
    const gap = num(sorted[i]?.piece['x']) - num(sorted[i - 1]?.piece['x']);
    const glyph = charOffsets(texts[i - 1] ?? '', fontSize, metrics, 0.54, spacing).total;
    line += (first.by === 'w' || gap > glyph + 0.4 * space ? ' ' : '') + (texts[i] ?? '');
  }
  const offsets = charOffsets(line, fontSize, metrics, 0.54, spacing);
  const placed = pieces(offsets.units, first.by === 'w' ? 'word' : 'char');
  const x0 = num(first.piece['x']);
  const pad = Math.round(fontSize * 0.15);
  let moved = 0;
  placed.forEach((p, i) => {
    const u = sorted[i];
    if (!u) return;
    const from = offsets.offsets[p.start] ?? 0;
    const to = p.end < offsets.offsets.length ? (offsets.offsets[p.end] ?? offsets.total) : offsets.total;
    const x = Math.round(x0 + from);
    moved = x - num(u.piece['x']);
    u.piece['x'] = x;
    u.piece['width'] = unitWidth(p.text, style, to - from);
    if (u.mask) { u.mask['x'] = x - pad; u.mask['width'] = num(u.piece['width']) + pad * 2; }
  });
  return moved;
}

export function remeasureText(args: { design_path: string; layer_id?: string; page_id?: string; project_path?: string }): ToolResult {
  const op = 'text';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const dirs = [fontsDir(), projectFontsDir(args.project_path ?? path.dirname(path.dirname(dPath))) ?? ''].filter(Boolean);
  const lookup: Lookup = style => {
    const family = String(style['font_family'] ?? 'Inter').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? 'Inter';
    return metricsForFamily(family, dirs, numericWeight(style['font_weight']));
  };
  const scopes = args.page_id ? [args.page_id] : spec.pages?.length ? spec.pages.map(p => p.id) : [undefined];
  const lines: string[] = [];
  for (const pageId of scopes) {
    const scoped = resolveScope(spec, pageId);
    if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');
    for (const [key, run] of collectRuns(scoped.scope, args.layer_id)) {
      const moved = remeasureRun(run, lookup);
      lines.push(`${pageId ? `${pageId}: ` : ''}${key.split('|')[0]} (${run.length} ${key.split('|')[1] === 'w' ? 'words' : 'characters'}), last piece moved ${moved > 0 ? '+' : ''}${moved}px`);
    }
    commitScope(spec, scoped.page, scoped.scope);
  }
  if (lines.length === 0) {
    return errResult(op, args.layer_id ? `No split pieces of "${args.layer_id}" found.` : 'No split text in this design.',
      'Pieces are the <layer>_w1… / <layer>_c1… layers op:text or split_text made. Line splits never need re-placing.');
  }
  const bak = snapshot(dPath);
  writeYAML(dPath, spec);
  return okResult(op, {
    design_path: dPath, remeasured: lines,
    note: 'Each line kept its first piece\'s left edge; pieces moved to their measured offsets at their own weight, masks with them. Motion is unchanged.',
  }, bak);
}
