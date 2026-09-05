// Structured design diagnostics for the diagnose_design MCP tool — the engine's
// built-in troubleshooter. Geometry-aware checks the model is blind to:
// off-canvas, collisions, misalignment (incl. near-miss "almost aligned"),
// tiny text. Folds in the existing composition lint + quality critic, all as
// structured findings with fixes. Pure — no I/O.

import type { Layer } from '../../schema/types';
import { findFlatTextStyle } from '../../schema/validator';
import { lintComposition, reviewComposition } from './design-lint';
import { lintAiSlop } from './ai-slop-lint';
import { findTextOverflows } from './text-measure';

export interface Finding {
  code: string;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  layer_id?: string;
  fix?: string;
}

interface Box { id: string; type: string; z: number; x: number; y: number; w: number; h: number; }

function box(l: Layer): Box | null {
  const p = (l as { pos?: unknown }).pos;
  let x: unknown, y: unknown, w: unknown, h: unknown;
  if (Array.isArray(p) && p.length >= 4) { [x, y, w, h] = p; }
  else { x = l.x; y = l.y; w = l.width; h = l.height; }
  if ([x, y, w, h].some(v => typeof v !== 'number')) return null;
  return { id: l.id, type: l.type, z: typeof l.z === 'number' ? l.z : 0, x: x as number, y: y as number, w: w as number, h: h as number };
}

// Top-level layers only (collision/alignment is judged at the canvas level).
function boxes(layers: Layer[]): Box[] {
  return layers.map(box).filter((b): b is Box => b !== null);
}

// Content-bearing types: what a reader LOSES when it falls off the canvas. A
// decorative rect/path/ellipse bleeding past the edge is a legitimate design
// move; a heading or a chart doing it is lost information.
const CONTENT_TYPES = new Set(['text', 'chart', 'kpi_card', 'image', 'icon', 'code', 'math', 'qrcode', 'table']);

// A group renders as a bare <g> with NO transform — its children carry absolute
// document coordinates — so a group whose declared height is 1080 can still draw
// content at y=2066. Judging off-canvas by the group BOX therefore passes decks
// with half their content clipped ("0 errors" on a visibly broken slide). Walk
// the whole tree and judge every content layer where it actually renders.
function contentDescendants(layers: Layer[], out: Box[] = [], depth = 0): Box[] {
  if (depth > 8) return out;
  for (const l of layers) {
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) {
      contentDescendants(kids, out, depth + 1);
      continue;
    }
    if (depth === 0) continue;                     // top level is checked by its own pass
    if (!CONTENT_TYPES.has(l.type)) continue;
    const b = box(l);
    if (b && b.w > 0 && b.h > 0) out.push(b);
  }
  return out;
}

function overlapArea(a: Box, b: Box): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

const FULL_BG = (b: Box, W: number, H: number): boolean => b.w * b.h >= W * H * 0.85 && b.x <= 2 && b.y <= 2;
const SIZED = new Set(['rect', 'image', 'icon', 'ellipse', 'circle', 'group', 'chart', 'kpi_card', 'path', 'text', 'qrcode', 'polygon']);

// ── geometry checks ─────────────────────────────────────────
function geometryFindings(layers: Layer[], W: number, H: number): Finding[] {
  const out: Finding[] = [];
  const bs = boxes(layers).filter(b => SIZED.has(b.type));

  // Off-canvas.
  for (const b of bs) {
    if (b.x < -4 || b.y < -4 || b.x + b.w > W + 4 || b.y + b.h > H + 4) {
      out.push({
        code: 'off_canvas', severity: 'error', layer_id: b.id,
        message: `"${b.id}" extends outside the ${W}×${H} canvas (x:${Math.round(b.x)} y:${Math.round(b.y)} w:${Math.round(b.w)} h:${Math.round(b.h)}) — it will be clipped.`,
        fix: `Move/resize it inside [0,0,${W},${H}].`,
      });
    }
  }

  // Off-canvas CONTENT nested inside a group — the case a box-level check misses
  // entirely. Always an error: clipped content is lost, never a style choice.
  for (const b of contentDescendants(layers)) {
    const over = Math.max(-b.x, -b.y, b.x + b.w - W, b.y + b.h - H);
    if (over <= 8) continue;
    const lost = Math.round(Math.min(100, (over / Math.max(1, Math.min(b.w, b.h))) * 100));
    out.push({
      code: 'off_canvas', severity: 'error', layer_id: b.id,
      message: `"${b.id}" renders ${Math.round(over)}px outside the ${W}×${H} canvas (x:${Math.round(b.x)} y:${Math.round(b.y)} w:${Math.round(b.w)} h:${Math.round(b.h)}) — ~${lost}% of it is clipped and the reader never sees it.`,
      fix: `It sits inside a group, and a group applies no transform — its children carry absolute coordinates. Move it inside [0,0,${W},${H}], or cut content so the preset fits the canvas.`,
    });
  }

  // Tiny text.
  for (const l of layers) {
    if (l.type !== 'text') continue;
    const fs = (l as { style?: { font_size?: number } }).style?.font_size;
    if (typeof fs === 'number' && fs > 0 && fs < 12) {
      out.push({ code: 'tiny_text', severity: 'warning', layer_id: l.id, message: `text "${l.id}" is ${fs}px — too small to read comfortably.`, fix: 'Use ≥14px for body, ≥12px minimum.' });
    }
  }

  // Serialized-spec leak — a model fumbling patch_design/add_layers can dump the
  // raw shorthand/JSON into a text layer's content, which then renders as a wall
  // of  "bg": "#…", "accent": …  visible on the slide. The model can't SEE it, so
  // flag it as an error with the offending snippet.
  const SPEC_KEY = /["']?(bg_style|text_color|layers_shorthand|accent|kicker|deck|font_weight|pos)["']?\s*:/g;
  for (const l of layers) {
    if (l.type !== 'text') continue;
    const c = (l as { content?: { value?: string } | string }).content;
    const v = (typeof c === 'string' ? c : c?.value) ?? '';
    if (v.length < 30) continue;
    const looksJson = /^\s*[[{]/.test(v) && v.includes('":');
    const keyHits = (v.match(SPEC_KEY) ?? []).length;
    if (looksJson || keyHits >= 2) {
      out.push({
        code: 'serialized_spec', severity: 'error', layer_id: l.id,
        message: `text "${l.id}" contains a serialized design spec / JSON blob ("${v.slice(0, 48).replace(/\s+/g, ' ').trim()}…") — raw markup is showing as visible copy.`,
        fix: 'Replace this layer with the intended human-readable text, or rebuild the slide as ONE preset layer (sections/editorial) via add_layers.',
      });
    }
  }

  // Text overflow — a box too short for its wrapped text spills past it and
  // collides with whatever sits below. Declared boxes DON'T overlap (so the
  // collision check below stays silent), but the rendered text does. This is
  // the failure a vision-less model can't see; it's reported as one actionable
  // finding per overflowing layer instead of N pairwise collisions.
  for (const o of findTextOverflows(layers, H)) {
    const hit = o.collides.length;
    const where = hit
      ? ` and overlaps ${hit} layer(s) below (${o.collides.slice(0, 4).join(', ')}${hit > 4 ? '…' : ''})`
      : o.offBottom ? ' and runs off the bottom of the canvas' : '';
    out.push({
      code: 'text_overflow', severity: hit || o.offBottom ? 'error' : 'warning', layer_id: o.id,
      message: `text "${o.id}" (${o.fontSize}px) wraps to ~${o.lines} lines (~${o.estH}px) but its box is only ${o.declaredH}px tall — it spills ~${o.spill}px past the box${where}.`,
      fix: `Raise its height to ≥${o.estH}px, reduce font_size, shorten the copy, or use the editorial/feature_grid preset (auto-sizes blocks so text never collides).`,
    });
  }

  // Collisions — two same-kind content layers (text↔text, icon↔icon) that overlap
  // are almost always an accidental pile-up (the #1 hand-placement failure).
  const content = bs.filter(b => !FULL_BG(b, W, H) && (b.type === 'text' || b.type === 'icon' || b.type === 'kpi_card'));
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i], c = content[j];
      if (a.type !== c.type) continue;
      const ov = overlapArea(a, c);
      const minArea = Math.min(a.w * a.h, c.w * c.h);
      if (minArea > 0 && ov / minArea > 0.3) {
        out.push({
          code: 'collision', severity: 'warning', layer_id: a.id,
          message: `"${a.id}" and "${c.id}" (both ${a.type}) overlap by ${Math.round((ov / minArea) * 100)}% — likely a collision / illegible pile-up.`,
          fix: 'Space them apart, or use one auto_layout/row/column container so the engine lays them out without overlap.',
        });
      }
    }
  }

  // Alignment near-miss — edges within 1–6px of each other read as a sloppy
  // misalignment (the eye sees "almost lined up"). Suggest snapping.
  const edges: Array<{ id: string; edge: string; v: number }> = [];
  for (const b of bs) {
    if (FULL_BG(b, W, H)) continue;
    edges.push({ id: b.id, edge: 'left', v: b.x }, { id: b.id, edge: 'top', v: b.y });
  }
  const seenPairs = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edges[i].edge !== edges[j].edge || edges[i].id === edges[j].id) continue;
      const d = Math.abs(edges[i].v - edges[j].v);
      const key = [edges[i].id, edges[j].id, edges[i].edge].sort().join('|');
      if (d >= 1 && d <= 6 && !seenPairs.has(key)) {
        seenPairs.add(key);
        out.push({
          code: 'misalignment', severity: 'suggestion', layer_id: edges[i].id,
          message: `"${edges[i].id}" and "${edges[j].id}" are almost ${edges[i].edge}-aligned (off by ${d.toFixed(1)}px).`,
          fix: `Snap both ${edges[i].edge} edges to the same value, or call align_layers.`,
        });
      }
    }
  }

  return out;
}

/** Run all diagnostics over a page's layers. */
export function analyzeLayers(layers: Layer[], W: number, H: number): Finding[] {
  const out = geometryFindings(layers, W, H);
  // Fold composition lint (render-correctness) as warnings/errors. Skip the
  // overflow note — geometryFindings already emits a richer text_overflow
  // finding for it (folding both double-reports the same problem).
  for (const note of lintComposition(layers, W, H)) {
    if (/spills ~\d+px/.test(note)) continue;
    out.push({ code: 'composition', severity: 'warning', message: note });
  }
  // Fold quality critic as suggestions.
  for (const note of reviewComposition(layers, W, H)) {
    out.push({ code: 'quality', severity: 'suggestion', message: note });
  }
  // Fold the AI-slop critic — the "looks generated by default" tells.
  for (const note of lintAiSlop(layers)) {
    out.push({ code: 'ai_slop', severity: 'suggestion', message: note });
  }
  // Sparse-content nudge → enrich_brief. Conservative: only when there's a rich
  // preset group absent AND the canvas is near-empty (≤1 text layer, little copy),
  // so it never fires on a preset (which expands to a many-child group) or a
  // genuinely full hand-placed poster.
  const richGroup = layers.some(l => (l.type === 'group' || l.type === 'auto_layout') && (((l as { layers?: unknown[] }).layers?.length) ?? 0) >= 5);
  const textLayers = layers.filter(l => l.type === 'text');
  const textChars = textLayers.reduce((n, l) => {
    const c = (l as { content?: { value?: string; text?: string } }).content;
    return n + (c?.value ?? c?.text ?? '').length;
  }, 0);
  if (!richGroup && textLayers.length <= 1 && textChars < 140) {
    out.push({
      code: 'sparse_content', severity: 'suggestion',
      message: 'This design is sparse — very little content for the canvas.',
      fix: 'Call enrich_brief with your topic to get a rich content plan (preset + full block outline + research queries), then rebuild with that preset.',
    });
  }
  // Stacked full-canvas preset groups → a model re-ADDED a preset instead of
  // replacing it (dedupe renames them foo_1, foo_1-2, foo_1-3…). They overlap
  // perfectly so no collision fires and only the TOP one renders — the rest are
  // dead weight the model can't SEE. Flag it with the ids to remove.
  const fullGroups = boxes(layers).filter(b => b.type === 'group' && FULL_BG(b, W, H));
  if (fullGroups.length > 1) {
    const ids = fullGroups.map(b => b.id);
    out.push({
      code: 'stacked_presets', severity: 'warning',
      message: `${fullGroups.length} full-canvas layers are stacked (${ids.join(', ')}) — only the top one shows; the rest are duplicates (a preset added repeatedly instead of replaced).`,
      fix: `Keep one and remove_layer the others: ${ids.slice(0, -1).join(', ')}.`,
    });
  }
  return out;
}

/**
 * Styling written at layer level, where the renderer never looks.
 *
 * Typography comes from `layer.style`; normalizeTextLayer lifts only the SHORT
 * aliases (font, size, weight, color, lh, track) off the layer itself. So
 * `font_size: 64` on the layer is dropped and the text renders at the 16px
 * default — a design that looks finished and is quietly wrong, which nothing
 * else in the diagnosis notices because it renders perfectly well.
 *
 * Detection lives in the validator (one definition of the rule); this walks the
 * tree and shapes the result as diagnose findings.
 */
export function flatTextStyleFindings(spec: {
  layers?: Layer[];
  pages?: Array<{ id: string; layers?: Layer[] }>;
}): (Finding & { page?: string })[] {
  const out: (Finding & { page?: string })[] = [];
  const walk = (layers: Layer[] | undefined, base: string, pageId?: string): void => {
    for (const [i, l] of (layers ?? []).entries()) {
      for (const w of findFlatTextStyle(l, `${base}[${i}]`)) {
        out.push({
          code: 'text_style_flat', severity: 'warning', message: w.message,
          layer_id: l.id, fix: 'Nest the property under the layer\'s "style" object.',
          ...(pageId ? { page: pageId } : {}),
        });
      }
      if (l.type === 'group') walk((l as Layer & { layers?: Layer[] }).layers, `${base}[${i}].layers`, pageId);
    }
  };
  walk(spec.layers, 'layers');
  for (const p of spec.pages ?? []) walk(p.layers, `pages.${p.id}.layers`, p.id);
  return out;
}
