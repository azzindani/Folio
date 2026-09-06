// `edit_layer {op:"split_text"}` — one text layer becomes one layer per
// character or word, so each piece can be animated on its own.
//
// docs/MOTION.md §5: "per-character/word reveal needs the text layer split into
// spans". Nothing here is a new animation feature: once the pieces are real
// layers, `animation {op:"sequence", stagger_ms}` already staggers them and the
// flipbook already samples them. The missing part was the split, and the split
// is a MEASUREMENT problem — the engine has to place each piece where the
// renderer would have drawn it.
//
// That is why this reads real advance widths from the bundled TTFs rather than
// the layout heuristic used elsewhere: that heuristic gives every glyph one
// average width, which is fine for "is this box too short" and useless here.
// In Plus Jakarta Sans "iii" is 68.7px where "WWW" is 295.2px at the same size;
// splitting on the average would spread a word apart as it revealed.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, pWarn, buildContext, buildHandover, collectLayerIds, freeLayerId } from './utils';
import { metricsForFamily, charOffsets } from '../../utils/font-metrics';
import { fontsDir, projectFontsDir } from './fonts';
import { resolveScope, commitScope } from './motion';
import { pagesWithLayer } from '../engine-edit-tools';

export interface SplitTextArgs {
  design_path: string;
  project_path?: string;
  page_id?: string;
  layer_id?: string;
  /** 'char' (default) or 'word'. */
  by?: 'char' | 'word';
  /** Keep the source layer, hidden, so the split can be undone by hand. */
  keep_source?: boolean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function findLayer(scope: Layer[], id: string): Layer | null {
  for (const l of scope) {
    if (String((l as { id?: unknown }).id ?? '') === id) return l;
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) { const hit = findLayer(kids, id); if (hit) return hit; }
  }
  return null;
}

interface Piece { text: string; start: number }

/** Split into characters or words, remembering where each piece starts. */
function pieces(text: string, by: 'char' | 'word'): Piece[] {
  if (by === 'char') return [...text].map((c, i) => ({ text: c, start: i }));
  const out: Piece[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], start: m.index });
  return out;
}

export function splitText(args: SplitTextArgs): ToolResult {
  const op = 'split_text';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const id = String(args.layer_id ?? '');
  if (!id) return errResult(op, 'No layer_id given', 'Name the text layer to split, e.g. layer_id:"headline".');

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);
  // Carousel pages share layer ids, and an unscoped split silently took the
  // FIRST page — so splitting a headline across a 7-page deck did one page and
  // said nothing. `update` already refuses this ambiguity rather than guessing;
  // matching it is what makes the tool predictable across its own ops.
  if (!args.page_id) {
    const hits = pagesWithLayer(spec, id);
    if (hits.length > 1) {
      return errResult(op, `Layer id "${id}" exists on ${hits.length} pages (${hits.join(', ')}) — refusing to guess which one.`,
        'Pass page_id to split ONE page (carousel pages share layer IDs).');
    }
  }
  const scoped = resolveScope(spec, args.page_id);
  if ('error' in scoped) return errResult(op, scoped.error, 'Check page_id.');

  const src = findLayer(scoped.scope, id);
  if (!src) return errResult(op, `No such layer: ${id}`, 'manage_design {op:"inspect"} lists the ids on this page.');
  if (src.type !== 'text') return errResult(op, `"${id}" is a ${src.type}, not text`, 'Only a text layer can be split.');

  const o = src as unknown as Record<string, unknown>;
  const content = o['content'] as { value?: unknown } | undefined;
  const text = typeof content?.value === 'string' ? content.value : '';
  if (!text.trim()) return errResult(op, `"${id}" has no text to split`, 'Give it content first.');
  if (text.includes('\n')) {
    return errResult(op, `"${id}" spans multiple lines`,
      'Splitting places each piece by measured advance along ONE line; a wrapped or multi-line layer would '
      + 'need line-breaking too. Split each line into its own text layer first.');
  }

  const style = (o['style'] ?? {}) as Record<string, unknown>;
  const fontSize = num(style['font_size']) ?? 16;
  const family = typeof style['font_family'] === 'string' ? style['font_family'] : '';
  const dirs = [fontsDir(), projectFontsDir(args.project_path ?? path.dirname(path.dirname(dPath))) ?? ''].filter(Boolean);
  const metrics = family ? metricsForFamily(family, dirs) : null;

  const { offsets, total, exact } = charOffsets(text, fontSize, metrics);
  const parts = pieces(text, args.by === 'word' ? 'word' : 'char');
  if (parts.length === 0) return errResult(op, 'Nothing to split', 'The layer holds only whitespace.');

  const x0 = num(o['x']) ?? 0;
  const y0 = num(o['y']) ?? 0;
  const boxW = num(o['width']) ?? total;
  // Honour the layer's own alignment: the run is laid out from x0 for left,
  // and shifted for centre/right so the pieces sit where the text was drawn.
  const align = String(style['align'] ?? style['text_align'] ?? 'left');
  const shift = align === 'center' ? (boxW - total) / 2 : align === 'right' ? boxW - total : 0;

  // Claimed against what the page already holds: with keep_source the same
  // layer can be split twice, and reusing `word_c1` gave the design two layers
  // with one id — after which `remove word_c1` deleted both.
  const taken = collectLayerIds(scoped.scope);
  const made: Layer[] = parts.map((p, i) => {
    const startX = x0 + shift + (offsets[p.start] ?? 0);
    const endIdx = p.start + [...p.text].length;
    const w = (endIdx < offsets.length ? (offsets[endIdx] as number) : total) - (offsets[p.start] ?? 0);
    return {
      ...o,
      id: freeLayerId(taken, `${id}_${args.by === 'word' ? 'w' : 'c'}${i + 1}`),
      x: Math.round(startX), y: y0, width: Math.max(1, Math.round(w)),
      content: { type: 'plain', value: p.text },
      // Each piece is measured and placed; letting it re-align inside its own
      // narrow box would move it off the run.
      style: { ...style, align: 'left' },
    } as unknown as Layer;
  });

  const keep = args.keep_source ?? false;
  const rest = keep
    ? scoped.scope.map(l => (String((l as { id?: unknown }).id ?? '') === id ? { ...(l as object), visible: false } as Layer : l))
    : scoped.scope.filter(l => String((l as { id?: unknown }).id ?? '') !== id);
  commitScope(spec, scoped.page, [...rest, ...made]);
  writeYAML(dPath, spec);

  progress.push(pOk(`Split into ${made.length} ${args.by === 'word' ? 'word' : 'character'} layer(s)`, `${id} → ${made[0]?.id}…`));
  if (!exact) {
    progress.push(pWarn('Placed from an ESTIMATE, not real metrics',
      family
        ? `No readable font file for "${family}", so each piece used an average advance and the run may drift. Bundle the font, or split by word, where drift is less visible.`
        : 'The layer names no font_family, so an average advance was used and the run may drift.'));
  }
  progress.push(pInfo('Next', 'animation {op:"sequence", steps:[{preset:"rise", stagger_ms:40}]} staggers them into a reveal.'));

  return okResult(op, {
    status: 'ok', source: id, created: made.map(l => String((l as { id?: unknown }).id)),
    count: made.length, by: args.by === 'word' ? 'word' : 'char',
    measured: exact ? 'font metrics' : 'estimate',
    ...(exact ? {} : { measurement_warning: 'Pieces were placed from an average advance width; the run can drift. Bundle the family, or split by word.' }),
    source_kept: keep,
    note: 'Each piece is a real text layer, so animation {op:"sequence"} with a stagger reveals them one at a time, '
      + 'and the flipbook samples them like anything else. Re-joining is manual — keep_source:true leaves the '
      + 'original hidden underneath.',
    progress,
    context: buildContext(op, `Split "${id}" into ${made.length} layer(s)`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}
