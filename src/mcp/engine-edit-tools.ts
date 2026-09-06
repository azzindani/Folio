// Folio MCP engine — patch/seal/add/update/remove layer tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult } from './types';

import type { ProgressItem } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';

import { buildEditorLink } from './engine/editor-link';

import type { NextAction } from './types';

import { pageHasReadableContent } from './engine-layer-tools';
import { finalizeSpecPages } from './engine-finalize-pages';
import { collapseDuplicateSections } from './engine-finalize-dedupe';
import { trimTrailingDeadBand } from './engine-finalize-geom';
import { pruneEmptyDrafts } from './engine-project-tools';

import { setNestedValue, inertPresetKeyWarning } from './engine-runtime-tools';

// Global hex recolor: walk the whole spec and replace any color string that
// exactly matches a key in `map` (case-insensitive) with its mapped value.
// Lets a model RESTYLE a whole design ("make it darker", flip the palette) in ONE
// patch_design selector — {path:"recolor", value:{"#FAF5EC":"#0A0A0A", …}} — instead
// of N fragile per-layer paths. This is the only thing that recolors the COMMON
// case: baked-in hexes (apply_theme only sets the project default, never re-skins a
// design; most MCP designs use hardcoded hexes, not theme tokens, so apply_theme is
// a no-op on them). Pairs with the invisible-text rescue: darken the bg here, and a
// now-too-dark text is re-lit on the next add_layers/finalize pass.
function recolorSpec(spec: unknown, map: Record<string, string>): number {
  const lut: Record<string, string> = {};
  for (const k of Object.keys(map)) if (typeof map[k] === 'string') lut[k.toLowerCase()] = map[k];
  let n = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') { const hit = lut[v.toLowerCase()]; if (hit !== undefined) { n++; return hit; } return v; }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
    if (v && typeof v === 'object') { const o = v as Record<string, unknown>; for (const k of Object.keys(o)) o[k] = walk(o[k]); return v; }
    return v;
  };
  walk(spec);
  return n;
}
const isRecolorSelector = (p: string): boolean => p === 'recolor' || p === 'recolor_all';
const asHexMap = (v: unknown): Record<string, string> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : null;

export function patchDesign(args: { design_path: string; selectors: { path: string; value: unknown }[]; dry_run?: boolean; project_path?: string }): ToolResult {
  const op = 'patch_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const invalid = args.selectors.filter(s => typeof s.path !== 'string' || !s.path);
  if (invalid.length > 0) return errResult(op, 'Selectors missing path field', 'Each selector needs { path: "dot.path", value: ... }', progress);

  if (args.dry_run) {
    // Validate without touching the file
    const spec = readYAML<Record<string, unknown>>(dPath);
    const wouldPatch: string[] = [];
    const errors: string[] = [];
    for (const sel of args.selectors) {
      if (isRecolorSelector(sel.path)) {
        const map = asHexMap(sel.value);
        if (map && recolorSpec(spec, map) > 0) wouldPatch.push(`recolor (${Object.keys(map).length} color(s))`);
        else errors.push(`recolor: value must be a {oldHex:newHex} map and at least one color must match`);
      } else if (setNestedValue(spec, sel.path, sel.value)) wouldPatch.push(sel.path);
      else errors.push(`${sel.path}: path did not resolve (missing parent, out-of-range index, or no filter match)`);
    }
    progress.push(errors.length === 0 ? pOk(`Dry-run: ${wouldPatch.length} path(s) valid`) : pWarn('Dry-run: some paths invalid', errors.join('; ')));
    const context = buildContext(op, `Dry-run validated ${wouldPatch.length} selector(s)`);
    const handover = buildHandover('PATCH', { design_path: dPath });
    return okResult(op, { dry_run: true, would_patch: wouldPatch, errors, progress, context, handover });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<Record<string, unknown>>(dPath);
  const patched: string[] = [];
  const unresolved: string[] = [];
  const inert: string[] = [];
  for (const sel of args.selectors) {
    if (isRecolorSelector(sel.path)) {
      const map = asHexMap(sel.value);
      const hits = map ? recolorSpec(spec, map) : 0;
      if (hits > 0) patched.push(`recolor:${hits}`);
      else unresolved.push('recolor (no color matched — pass {oldHex:newHex} from the design\'s actual colors)');
    } else if (setNestedValue(spec, sel.path, sel.value)) {
      patched.push(sel.path);
      const w = inertPresetKeyWarning(spec, sel.path);
      if (w) inert.push(w);
    } else {
      unresolved.push(sel.path);
    }
  }
  // Every selector missed — almost always `layers[0].x` against a design whose
  // shape the model guessed wrong. Fail loudly instead of reporting a phantom
  // success the model can't see through (it has no render).
  if (patched.length === 0 && unresolved.length > 0) {
    return errResult(op,
      `None of the ${unresolved.length} patch path(s) resolved: ${unresolved.join(', ')}`,
      'Run inspect_design first to read exact paths. Layers are addressable by index (layers[0].x) or id filter (layers[id=foo].x).',
      progress);
  }
  writeYAML(dPath, spec);
  progress.push(pOk(`Patched ${patched.length} field(s)`, patched.join(', ')));
  if (unresolved.length) progress.push(pWarn(`${unresolved.length} path(s) did not resolve — not applied`, unresolved.join(', ')));
  for (const w of inert) progress.push(pWarn('Patch has no render effect', w));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: inert.length ? 'Some patches hit an expanded preset (no effect) — remove_layer + add_layers to change it. Otherwise seal_design.' : 'Fields patched. Call seal_design or make further patches.' };
  const context = buildContext(op, `Patched ${patched.length} field(s) in ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { patched_paths: patched, count: patched.length, ...(unresolved.length ? { unresolved } : {}), ...(inert.length ? { inert_no_effect: inert } : {}), next_action, progress, context, handover }, bak);
}

// Does the design carry anything that actually RENDERS as content — not just a
// background wash and empty groups? A weak model sometimes seals a shell: a
// background rect + an empty {type:"group", layers:[]} it forgot to fill, or a
// payload that degraded to nothing — every such design renders BLANK. Recurse
// for a single text layer with real copy, or a content leaf (icon/image/chart/
// callout/…). Plain rects/ellipses are treated as decor/background, so a design
// that is ONLY shapes does not count (the rare pure-shape poster trades off
// against reliably catching the blank-poster class).

export function hasRenderableContent(spec: DesignSpec): boolean {
  const CONTENT_LEAF = new Set(['icon', 'image', 'chart', 'interactive_chart', 'interactive_table',
    'kpi_card', 'mermaid', 'math', 'qrcode', 'map', 'embed_code', 'callout', 'button', 'code', 'particle']);
  const hasText = (o: Record<string, unknown>): boolean => {
    const c = o['content'];
    const v = typeof c === 'string' ? c
      : (c && typeof c === 'object' ? (c as Record<string, unknown>)['value'] : (o['text'] ?? o['value']));
    return typeof v === 'string' && v.trim().length > 0;
  };
  const visit = (ls?: Layer[]): boolean => {
    for (const l of ls ?? []) {
      if (!l || typeof l !== 'object') continue;
      const o = l as unknown as Record<string, unknown>;
      const t = o['type'];
      if ((t === 'text' || t === 'rich_text') && hasText(o)) return true;
      if (typeof t === 'string' && CONTENT_LEAF.has(t)) return true;
      if (Array.isArray(o['layers']) && visit(o['layers'] as Layer[])) return true;
      if (Array.isArray(o['tabs'])) for (const tab of o['tabs'] as Record<string, unknown>[]) if (visit(tab?.['layers'] as Layer[] | undefined)) return true;
      if (Array.isArray(o['items'])) for (const it of o['items'] as Record<string, unknown>[]) if (it && Array.isArray(it['layers']) && visit(it['layers'] as Layer[])) return true;
    }
    return false;
  };
  for (const p of spec.pages ?? []) if (visit(p.layers)) return true;
  return visit(spec.layers);
}

// A poster that IS a single full-bleed preset group should size the document to
// that group. The add_layers auto-fit does this when the preset is first added,
// but a blind model often RESIZES the canvas afterward (and writes a string dim
// like '2000') — leaving the preset floating in a half-empty page (the
// feature_grid "bottom 40% blank" the harness test exposed). Re-fit at seal so
// the finished poster is always sized to its content. Also normalizes string dims.

export function fitDocumentToSolePreset(spec: DesignSpec): boolean {
  if (spec.pages && spec.pages.length) return false;
  const doc = spec.document as unknown as { width: number; height: number };
  const dw = Number(doc.width), dh = Number(doc.height);
  if (!Number.isFinite(dw) || !Number.isFinite(dh)) return false;
  let changed = false;
  if (doc.width !== dw) { doc.width = dw; changed = true; }    // normalize '2000' → 2000
  if (doc.height !== dh) { doc.height = dh; changed = true; }
  const layers = spec.layers ?? [];
  if (layers.length !== 1) return changed;
  const g = layers[0] as Layer & { type?: string; x?: number; y?: number; width?: number; height?: number };
  const gw = Number(g.width), gh = Number(g.height);
  if (g.type !== 'group' || !(gw > 0) || !(gh > 0)) return changed;
  if ((g.x ?? 0) > dw * 0.02 || (g.y ?? 0) > dh * 0.02) return changed;   // must be full-bleed at origin
  if (doc.width !== gw) { doc.width = gw; changed = true; }
  if (doc.height !== gh) { doc.height = gh; changed = true; }
  return changed;
}

export function sealDesign(args: { design_path: string; project_path?: string }): ToolResult {
  const op = 'seal_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  // Never seal a BLANK poster. A weak model that thrashed (hallucinated tool
  // names, looped, or built a {type:"group",layers:[]} shell it forgot to fill)
  // can reach seal_design with no renderable content — sealing then ships an
  // empty design + a blank link. Refuse when the canvas has no layers OR every
  // layer is just a background/empty group, and point it back at add_layers.
  // (Carousels have a `pages` key and their own page-completion flow — skip them.)
  if (!spec.pages && !hasRenderableContent(spec)) {
    return errResult(op, 'Cannot seal a blank design — it has no visible content (every layer is a background or an empty group), so it would render empty.',
      'Call add_layers FIRST with ONE FILLED preset layer (use the prefixed tool name mcp__folio__add_layers), e.g. layers_shorthand:[{type:"sections", title:"…", subtitle:"…", blocks:[{type:"stats",items:[{value:"…",label:"…"}]},{type:"heading_text",heading:"…",body:"…"},{type:"bars",items:[…]},{type:"callout",text:"…"}]}]; then diagnose_design; then seal_design.', progress);
  }
  // A carousel must not seal with a BLANK slide — a page that's empty or only
  // background shapes (no text/image/preset) renders blank but the model reports
  // success (live find: a 5-slide deck whose 4 content slides were two bg rects
  // each, sealed "0 errors"). Name the blank pages and send it back to fill them.
  if (spec.pages && spec.pages.length) {
    const blank = spec.pages.filter(p => !pageHasReadableContent(p.layers ?? []));
    if (blank.length) {
      const ids = blank.map(p => p.id).join(', ');
      return errResult(op, `Cannot seal — ${blank.length} carousel page(s) have no readable content (empty or only background shapes), so they render blank: ${ids}.`,
        'Add each slide\'s title + content before sealing. Easiest: one preset per page, e.g. add_layers/append_page with layers_shorthand:[{type:"list", title:"…", marker:"number", items:[{title:"…",desc:"…"}], footer:"…"}] or {type:"feature_grid", title:"…", items:[{icon,title,desc}]}.', progress);
    }
  }
  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  if (fitDocumentToSolePreset(spec)) progress.push(pInfo('Fitted canvas to content', `${spec.document.width}×${spec.document.height}`));
  // Duplicate-SECTION collapse BEFORE the sweep, so decollide/re-light run on
  // the deduped set. A thrashing model stacks the same preset block down the
  // page (live 120B: "What's Inside" ×5 → 4826px canvas); keep the first copy
  // of any repeated content block, close the gaps.
  {
    let deduped = 0;
    if (Array.isArray(spec.layers)) deduped += collapseDuplicateSections(spec.layers, spec.document.width, spec.document.height);
    for (const p of spec.pages ?? []) if (Array.isArray(p.layers)) deduped += collapseDuplicateSections(p.layers, spec.document.width, spec.document.height);
    if (deduped) progress.push(pInfo(`Collapsed ${deduped} duplicated content block(s)`, 'identical sections stacked by rebuild passes — kept the first of each'));
  }
  // Final per-page rescue sweep: strip null layers, flow positionless ones,
  // de-collide overlaps, re-light dark-on-dark — over the ROOT layers AND every
  // page. Catches a multi-page design written in one shot (whose page layers no
  // earlier pass touched) and self-heals an older broken file on re-seal.
  const swept = finalizeSpecPages(spec);
  // Requested-ratio hardening: a poster whose height ballooned (thrash, model-
  // set height) gets the dead-band trim at SEAL too, then a loud warning +
  // carousel hint if it still isn't a poster ratio.
  if (!spec.pages && Array.isArray(spec.layers)) {
    const trimmed = trimTrailingDeadBand(spec.layers, spec.document.width, spec.document.height);
    if (trimmed) { spec.document.height = trimmed; progress.push(pInfo(`Trimmed the canvas to ${trimmed}px`, 'removed the dead band below the last content')); }
    const ratio = spec.document.height / Math.max(1, spec.document.width);
    if ((spec.meta.type ?? 'poster') === 'poster' && ratio > 2.0) {
      progress.push(pWarn('Canvas is a scroll, not a poster', `${spec.document.width}×${spec.document.height} (${ratio.toFixed(1)}:1) — a poster should be 4:5/9:16/1:1. Split the content into a CAROUSEL (create_design type:"carousel" + append_page per section) or cut sections.`));
    }
  }
  if (swept.nulls) progress.push(pInfo(`Dropped ${swept.nulls} null layer(s)`, 'editor-crash guard'));
  if (swept.recovered) progress.push(pInfo(`Recovered ${swept.recovered} embedded JSON-in-text layer(s)`, 'stringified layer array → real layers (or dropped)'));
  if (swept.placed) progress.push(pInfo(`Placed ${swept.placed} positionless layer(s)`, 'flowed into a centered column'));
  if (swept.bgFilled) progress.push(pInfo(`Filled ${swept.bgFilled} empty background(s)`, 'transparent bg → solid from text polarity'));
  if (swept.reflowed) progress.push(pInfo(`Reflowed ${swept.reflowed} overlapping layer(s)`, 'measured text → no overprint'));
  if (swept.relit) progress.push(pInfo(`Re-lit ${swept.relit} low-contrast layer(s)`, 'dark-on-dark / pale-on-pale → legible'));
  spec._mode = 'complete';
  if (spec.meta.generation) spec.meta.generation.status = 'complete';
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk('Design sealed', `${spec.pages?.length ?? 0} page(s), ${spec.layers?.length ?? 0} root layer(s)`));

  // Prune abandoned empty in-progress drafts left beside this now-sealed design —
  // a model that created a draft, never filled it, then built the real design in
  // a new file leaves an orphan ~280-byte blank stub (suite-021/034/053/056/058/
  // 084). Safe at seal time: a sibling still empty when THIS design is done is
  // abandoned. Never touches a sealed design or one with any content.
  const projDir = path.dirname(path.dirname(dPath));
  const pruned = pruneEmptyDrafts(projDir, dPath);
  if (pruned.length) {
    progress.push(pInfo(`Pruned ${pruned.length} empty draft(s)`, pruned.join(', ')));
    const projYaml = path.join(projDir, 'project.yaml');
    if (fs.existsSync(projYaml)) {
      const proj = readYAML<{ designs?: { path?: string }[] }>(projYaml);
      if (Array.isArray(proj.designs)) {
        proj.designs = proj.designs.filter(d => !(typeof d.path === 'string' && pruned.includes(path.basename(d.path))));
        writeYAML(projYaml, proj);
      }
    }
  }

  const link = buildEditorLink(dPath);
  progress.push(pOk('Editor link', link.short_url ?? link.open_url));
  // Hand the SHORT link to the user — a small model mangles the long tokenized
  // URL (truncates / re-encodes it). share_url is ~40 chars and copy-safe.
  const next_action: NextAction = { tool: 'export_design', params: { design_path: dPath, format: 'svg' }, remaining: 0, hint: `Export with export_design. To open or share the design, give the user this link EXACTLY as written (do not retype or re-encode it): ${link.short_url ?? link.open_url}` };
  const context = buildContext(op, `Sealed design "${spec.meta.name}"`, [
    { type: 'design', path: dPath, role: 'sealed' },
  ]);
  const handover = buildHandover('SEAL', { design_path: dPath }, { type: spec.meta.type });
  return okResult(op, { status: 'sealed', pages: spec.pages?.length ?? 0, layers: spec.layers?.length ?? 0, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, next_action, progress, context, handover, _attachments: [link.attachment] }, bak);
}

// Known layer types — kept in sync with LayerType in src/schema/types.ts.
// Used to reject garbage like type:"frobozz" before it lands on disk.

export const VALID_LAYER_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line',
  'connector', 'background', 'backdrop',
  'text', 'image', 'icon', 'component', 'component_list',
  'mermaid', 'chart', 'code', 'math', 'group', 'qrcode',
  'auto_layout', 'interactive_chart', 'interactive_table',
  'rich_text', 'kpi_card', 'map', 'embed_code', 'popup', 'particle',
  'button', 'tabs', 'accordion', 'filter_bar', 'toggle',
  'tooltip', 'callout', 'progress',
]);

// Layer types that render INVISIBLY when width or height is 0 / missing.
// LLM agents commonly omit these in verbose form, producing a blank canvas
// that no test catches. Reject at write time with an actionable error so
// the agent fixes the YAML immediately instead of debugging from the SVG.

export const SIZED_LAYER_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'image', 'icon', 'group',
  'chart', 'interactive_chart', 'interactive_table', 'rich_text', 'kpi_card',
  'mermaid', 'code', 'math', 'qrcode', 'map', 'embed_code',
]);

export function dimError(l: Layer): string | null {
  if (!SIZED_LAYER_TYPES.has(l.type)) return null;
  // Flow-report layers are positioned by `span` (responsive grid), not px dimensions.
  const span = (l as Layer & { span?: number }).span;
  if (typeof span === 'number' && span > 0) return null;
  const w = (l as Layer & { width?: number }).width;
  const h = (l as Layer & { height?: number }).height;
  // pos:[x,y,w,h] shorthand still pending expansion — accept it.
  const pos = (l as Layer & { pos?: number[] }).pos;
  if (Array.isArray(pos) && pos.length >= 4 && pos[2] && pos[3]) return null;
  if (typeof w !== 'number' || w <= 0) return `Layer "${l.id}" (${l.type}) needs a positive width — got ${w}`;
  if (typeof h !== 'number' || h <= 0) return `Layer "${l.id}" (${l.type}) needs a positive height — got ${h}`;
  return null;
}

export function addLayer(args: { design_path: string; page_id?: string; layer: Layer; project_path?: string }): ToolResult {
  const op = 'add_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  if (!args.layer || !args.layer.type || !VALID_LAYER_TYPES.has(args.layer.type)) {
    return errResult(
      op,
      `Invalid layer.type: "${args.layer?.type}"`,
      `Allowed: ${[...VALID_LAYER_TYPES].join(', ')}`,
    );
  }
  const dimMsg = dimError(args.layer);
  if (dimMsg) return errResult(op, dimMsg, 'Pass explicit width + height (px) or use pos:[x,y,w,h] shorthand.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    if (!page.layers) page.layers = [];
    page.layers.push(args.layer);
  } else {
    if (!spec.layers) spec.layers = [];
    spec.layers.push(args.layer);
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Added layer "${args.layer.id}"`, args.layer.type));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Continue adding layers or call seal_design.' };
  const context = buildContext(op, `Added layer "${args.layer.id}" to ${path.basename(dPath)}`);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { layer_id: args.layer.id, next_action, progress, context, handover }, bak);
}

// Which scopes (root + page ids) carry a top-level layer with this id. >1 means
// an unscoped remove/update would hit multiple pages — carousel preset groups
// share ids (sections_1 / editorial_1), so this guards the silent-nuke footgun.

export function pagesWithLayer(spec: DesignSpec, layerId: string): string[] {
  const hits: string[] = [];
  if (spec.layers?.some(l => l.id === layerId)) hits.push('(root)');
  for (const p of spec.pages ?? []) if (p.layers?.some(l => l.id === layerId)) hits.push(p.id);
  return hits;
}

/**
 * Carry a line's endpoints along when its BOX moves.
 *
 * `line` and `connector` keep x1/y1/x2/y2 in ABSOLUTE document coordinates, and
 * the renderer draws from those — the box is only what every other subsystem
 * measures. So `update {y: 800}` on a line at y=200 moved the box 600px and
 * left the ink where it was: inspect, diagnose, align and collision detection
 * all reported the new place, and the picture showed the old one. Same
 * disagreement pass 10 found in the expander, reached here by mutation instead.
 *
 * An endpoint named in the SAME patch wins — the caller said where it goes, so
 * that value is used as given rather than shifted on top.
 */
/** Flat authoring alias → the canonical `style` key it belongs in. */
const TYPO_ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ['font_size', ['font_size', 'size', 'fontSize']],
  ['font_family', ['font_family', 'font', 'fontFamily']],
  ['font_weight', ['font_weight', 'weight', 'fontWeight']],
  ['color', ['color']],
  ['text_align', ['text_align', 'align', 'textAlign']],
  ['line_height', ['line_height', 'lineHeight', 'leading']],
  ['letter_spacing', ['letter_spacing', 'letterSpacing', 'tracking', 'track']],
];

/**
 * Route a flat authoring alias into the canonical field that would SHADOW it.
 *
 * A stored text layer keeps its words in `content:{type,value}` and its
 * typography in `style:{}`. `update` merged props in shallow, so the natural
 * way to ask for a change wrote a sibling the renderer never reads:
 *
 *     props {text:"NEW"}       → text: NEW      beside content.value: OLD
 *     props {font_size: 90}    → font_size: 90  beside style.font_size: 40
 *     props {color:"#EE0000"}  → color: #EE0000 beside style.color: #111111
 *
 * In all three the renderer keeps the canonical value, `update` reports
 * success, and nothing changes. Verified by rendering a layer holding both.
 *
 * Only applied where a canonical field EXISTS to do the shadowing — a layer
 * with no `style` reads a flat size correctly, so there is nothing to fix and
 * nothing is touched. An explicit `style` in the same patch keeps its own keys;
 * the alias only fills what that patch left unsaid.
 */
export function canonicalizeProps(layer: Layer, props: Record<string, unknown>): Record<string, unknown> {
  const l = layer as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...props };

  const content = l['content'];
  if (out['text'] !== undefined && out['content'] === undefined && content !== undefined) {
    const value = out['text'];
    out['content'] = (content && typeof content === 'object' && !Array.isArray(content))
      ? { ...(content as Record<string, unknown>), value }
      : { type: 'plain', value };
    delete out['text'];
  }

  const style = l['style'];
  if (style && typeof style === 'object' && !Array.isArray(style)) {
    let alias: Record<string, unknown> | undefined;
    for (const [canonical, keys] of TYPO_ALIASES) {
      for (const k of keys) {
        if (out[k] === undefined) continue;
        alias = alias ?? {};
        if (alias[canonical] === undefined) alias[canonical] = out[k];
        delete out[k];
      }
    }
    if (alias) {
      const patched = out['style'];
      const explicit = (patched && typeof patched === 'object' && !Array.isArray(patched))
        ? patched as Record<string, unknown> : undefined;
      const base = explicit ?? (style as Record<string, unknown>);
      out['style'] = { ...base, ...alias, ...(explicit ?? {}) };
    }
  }
  return out;
}

export function dragEndpoints(before: Layer, after: Layer, props: Record<string, unknown>): Layer {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (num(a['x1']) === undefined && num(a['y1']) === undefined) return after;

  const dx = (num(a['x']) ?? 0) - (num(b['x']) ?? 0);
  const dy = (num(a['y']) ?? 0) - (num(b['y']) ?? 0);
  if (dx === 0 && dy === 0) return after;

  const out: Record<string, unknown> = { ...a };
  for (const [k, d] of [['x1', dx], ['x2', dx], ['y1', dy], ['y2', dy]] as const) {
    if (props[k] !== undefined) continue;             // explicitly set by this patch
    const v = num(out[k]);
    if (v !== undefined) out[k] = v + d;
  }
  return out as unknown as Layer;
}

export function updateLayer(args: { design_path: string; layer_id: string; props: Partial<Layer>; page_id?: string; project_path?: string }): ToolResult {
  const op = 'update_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  let found = false;
  let lockedBy: string | null = null; // nearest locked ANCESTOR of the target, if any

  // Recurse into groups so children of a group (every MCP poster is ONE
  // group) are editable — matching what the editor can already do. A child
  // under a LOCKED group is reported, not silently skipped: unlocking the
  // GROUP itself stays possible because the group has no locked ancestor.
  const patch = (layers: Layer[], lockedAncestor?: string): Layer[] =>
    layers.map(l => {
      if (l.id === args.layer_id) {
        found = true;
        if (lockedAncestor) { lockedBy = lockedAncestor; return l; }
        const props = canonicalizeProps(l, args.props as Record<string, unknown>);
        return dragEndpoints(l, { ...l, ...props } as Layer, props);
      }
      const children = (l as Layer & { layers?: Layer[] }).layers;
      if (l.type === 'group' && Array.isArray(children)) {
        const nextLock = lockedAncestor ?? ((l as { locked?: unknown }).locked ? l.id : undefined);
        return { ...l, layers: patch(children, nextLock) } as Layer;
      }
      return l;
    });

  // page_id scopes the edit to ONE carousel page — without it the same id on
  // sibling pages would all be patched (carousel groups share ids).
  if (args.page_id) {
    const page = spec.pages?.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Use manage_design {op:"inspect"} to list page IDs.', progress);
    if (page.layers) page.layers = patch(page.layers);
  } else {
    const hits = pagesWithLayer(spec, args.layer_id);
    if (hits.length > 1) return errResult(op, `Layer id "${args.layer_id}" exists on ${hits.length} pages (${hits.join(', ')}) — refusing to patch all of them.`, 'Pass page_id to update ONE page (carousel pages share layer IDs).', progress);
    if (spec.layers) spec.layers = patch(spec.layers);
    if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = patch(page.layers); }
  }
  if (!found) return errResult(op, `Layer not found: ${args.layer_id}`, 'Use manage_design {op:"inspect"} to find layer IDs — group children are listed with a parent field.', progress);
  if (lockedBy) {
    return errResult(op, `Layer "${args.layer_id}" is inside the LOCKED group "${lockedBy}" — not modified.`,
      `Unlock first: edit_layer {op:"update", layer_id:"${lockedBy}", props:{locked:false}}, apply your edit, then re-lock with props:{locked:true}. (locked also exempts the group from engine heal passes.)`, progress);
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Updated layer "${args.layer_id}"`, Object.keys(args.props).join(', ')));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Continue editing or call seal_design.' };
  const context = buildContext(op, `Updated layer "${args.layer_id}" in ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { updated: args.layer_id, next_action, progress, context, handover }, bak);
}

export function removeLayer(args: { design_path: string; layer_id: string; page_id?: string; project_path?: string }): ToolResult {
  const op = 'remove_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  let removed = 0;
  const drop = (layers: Layer[]): Layer[] => { const k = layers.filter(l => l.id !== args.layer_id); removed += layers.length - k.length; return k; };
  // page_id scopes removal to ONE carousel page. WITHOUT it the same id on
  // sibling pages is removed too (carousel groups share ids) — the footgun that
  // silently emptied 3 pages when one page's group was deleted by id.
  if (args.page_id) {
    const page = spec.pages?.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Use manage_design {op:"inspect"} to list page IDs.', progress);
    if (page.layers) page.layers = drop(page.layers);
  } else {
    const hits = pagesWithLayer(spec, args.layer_id);
    if (hits.length > 1) return errResult(op, `Layer id "${args.layer_id}" exists on ${hits.length} pages (${hits.join(', ')}) — refusing to remove from all (this silently empties sibling slides).`, 'Pass page_id to remove it from ONE page (carousel pages share layer IDs).', progress);
    if (spec.layers) spec.layers = drop(spec.layers);
    if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = drop(page.layers); }
  }
  if (removed === 0) return errResult(op, `Layer not found: ${args.layer_id}`, args.page_id ? `No layer "${args.layer_id}" on page "${args.page_id}".` : 'Use manage_design {op:"inspect"} to find layer IDs.', progress);

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Removed layer "${args.layer_id}"`, removed > 1 ? `${removed} matches across pages — pass page_id to scope` : undefined));

  const next_action: NextAction = { tool: 'inspect_design', params: { design_path: dPath }, remaining: -1, hint: 'Verify removal with inspect_design, then continue or seal.' };
  const context = buildContext(op, `Removed layer "${args.layer_id}" from ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { removed: args.layer_id, next_action, progress, context, handover }, bak);
}

// ── Tier 3 — Export & Templates ──────────────────────────────

// Blank image srcs pointing at a local file we can't find, so the renderer
// shows its placeholder frame instead of a blank gap on export. Mutates the
// (export-only, non-persisted) spec and returns a note per blanked layer so
// the caller can tell the model to fix the asset. Skips http(s)/data/file URIs.
