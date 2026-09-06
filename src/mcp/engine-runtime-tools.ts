// Folio MCP engine — formula/timeline/animation/presenter/collab/editor tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page } from '../schema/types';
import type { ToolResult } from './types';

import type { ProgressItem } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, buildContext, buildHandover } from './engine/utils';

import { buildEditorLink } from './engine/editor-link';

import { assemblePresentationHTML } from '../export/presentation-assembler';

import { evaluateFormula, isFormula } from '../scripting/formula';
import type { FormulaContext } from '../scripting/formula';
import { addKeyframe } from '../ui/panels/timeline-panel';
import { sceneTracks, sceneLength, renderSceneASCII } from './engine/timeline-ascii';
import type { Keyframe } from '../animation/types';
import { getClientScript } from '../export/remote-server';
import { tryFfmpeg } from '../export/animation-export';
import { buildAnimatedSVG, wrapAnimatedHTML } from '../export/svg-animate';
import { renderToSVGString } from './engine/svg-export';
import { resvgFontOption } from './engine/fonts';
import { resolveImageAssets } from './engine/asset-resolve';
import { syncAnimationsToSpec } from './engine/animation-sync';
import { encodeGIF, type GifFrame } from '../export/gif-encode';
import { specAt, frameTimes, animationDuration } from '../export/gif-frames';

/** True when Puppeteer can actually be loaded — the raster routes need it to capture frames. */
function tryPuppeteer(): boolean {
  if (typeof require === 'undefined') return false;
  try { require.resolve('puppeteer'); return true; } catch { return false; }
}

/** Resolve a page_id to its index; 0 when absent or unmatched (a poster has one page). */
function pageIndexFor(spec: DesignSpec, pageId?: string): number {
  if (!pageId) return 0;
  const idx = (spec.pages ?? []).findIndex((p: Page) => p.id === pageId);
  return idx >= 0 ? idx : 0;
}

/**
 * Narrow a multi-page spec to the single page being exported.
 *
 * renderToSVGString always renders the first page, so exporting page 4 of a
 * carousel would silently hand back page 1. Slicing the spec is honest about
 * what is being rendered and keeps the render path itself untouched.
 */
function withActivePage(spec: DesignSpec, pageIndex: number): DesignSpec {
  const pages = spec.pages;
  if (!pages || pages.length <= pageIndex) return spec;
  return { ...spec, pages: [pages[pageIndex]] };
}

export function setFormulaContext(args: {
  design_path: string;
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  project_path?: string;
}): ToolResult {
  const op = 'set_formula_context';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const ctxPath = dPath.replace('.design.yaml', '.formula.json');
  const payload = { state: args.state ?? {}, data: args.data ?? {} };
  fs.writeFileSync(ctxPath, JSON.stringify(payload, null, 2), 'utf-8');

  return okResult(op, {
    context_path: ctxPath,
    keys: {
      state: Object.keys(args.state ?? {}),
      data: Object.keys(args.data ?? {}),
    },
  });
}

export function debugFormula(args: {
  formula: string;
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  design_path?: string;
  project_path?: string;
}): ToolResult {
  const op = 'debug_formula';
  if (!isFormula(args.formula)) {
    return errResult(op, 'Formula must start with =', 'Formula must start with =');
  }

  let state: Record<string, unknown> = args.state ?? {};
  let data: Record<string, unknown> = args.data ?? {};

  if (args.design_path) {
    const dPath = resolveDesignPath(args.design_path, args.project_path);
    const ctxPath = dPath.replace('.design.yaml', '.formula.json');
    if (fs.existsSync(ctxPath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(ctxPath, 'utf-8')) as Record<string, unknown>;
        state = { ...(loaded['state'] as Record<string, unknown> ?? {}), ...state };
        data  = { ...(loaded['data']  as Record<string, unknown> ?? {}), ...data };
      } catch { /* ignore malformed .formula.json */ }
    }
  }

  const ctx: FormulaContext = { state, data };
  const result = evaluateFormula(args.formula, ctx);
  return okResult(op, { result, type: typeof result, formula: args.formula });
}

// ── Internal shared helpers ───────────────────────────────────

export type PathTok =
  | { kind: 'key'; key: string }
  | { kind: 'index'; i: number }
  | { kind: 'filter'; k: string; v: string };

// Tokenize a selector path into keys, array INDICES (`[0]`), and array FILTERS
// (`[id=foo]`). Earlier this only understood `[key=value]`, so `layers[0].x`
// silently resolved to nothing — and patch_design still reported success. Both
// forms are now first-class.

/**
 * Keys that reach OUT of the document and into the JavaScript object graph.
 *
 * `patch_design` takes a dot path straight from the model, and the walker
 * followed `__proto__` like any other key: the selector
 * `layers[0].__proto__.polluted` descended to Object.prototype and assigned
 * there, so a single tool call set a property on EVERY object in the running
 * server — proven by a probe watching `({}).polluted` flip from undefined to
 * the supplied value. Nothing appeared in the design file, because nothing was
 * written to it, and the call reported one field successfully patched.
 *
 * Rejected at the tokenizer so both the setter and every reader built on it are
 * covered by one guard, and so the whole path fails rather than silently
 * resolving to something the caller did not name.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function tokenizePath(dotPath: string): PathTok[] {
  const toks: PathTok[] = [];
  for (const seg of dotPath.split('.')) {
    const m = seg.match(/^([^[\]]*)((?:\[[^\]]+\])*)$/);
    if (!m) return [];
    if (m[1]) {
      if (UNSAFE_KEYS.has(m[1])) return [];
      toks.push({ kind: 'key', key: m[1] });
    }
    for (const acc of m[2].match(/\[[^\]]+\]/g) ?? []) {
      const inner = acc.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq >= 0) {
        // A filter key is compared, never followed — but it is still read off
        // every element, so it gets the same guard rather than an exception.
        if (UNSAFE_KEYS.has(inner.slice(0, eq))) return [];
        toks.push({ kind: 'filter', k: inner.slice(0, eq), v: inner.slice(eq + 1) });
      } else if (/^\d+$/.test(inner)) toks.push({ kind: 'index', i: Number(inner) });
      else {
        if (UNSAFE_KEYS.has(inner)) return [];
        toks.push({ kind: 'key', key: inner });
      }
    }
  }
  return toks;
}

export function descend(cur: unknown, t: PathTok): unknown {
  if (cur == null || typeof cur !== 'object') return undefined;
  if (t.kind === 'key') return (cur as Record<string, unknown>)[t.key];
  if (t.kind === 'index') return Array.isArray(cur) ? cur[t.i] : undefined;
  return Array.isArray(cur) ? cur.find((it) => it != null && String((it as Record<string, unknown>)[t.k]) === t.v) : undefined;
}

// Returns true iff the value was actually written. A false return means the path
// did not resolve (missing parent, out-of-range index, no filter match) — the
// caller surfaces that instead of pretending the patch landed.

export function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): boolean {
  const toks = tokenizePath(dotPath);
  if (toks.length === 0) return false;
  let cur: unknown = obj;
  for (let i = 0; i < toks.length - 1; i++) {
    cur = descend(cur, toks[i]);
    if (cur == null || typeof cur !== 'object') return false;
  }
  const last = toks[toks.length - 1];
  if (last.kind === 'key') {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return false;
    (cur as Record<string, unknown>)[last.key] = value;
    return true;
  }
  if (last.kind === 'index') {
    if (!Array.isArray(cur) || last.i < 0 || last.i >= cur.length) return false;
    cur[last.i] = value;
    return true;
  }
  if (!Array.isArray(cur)) return false;
  const idx = cur.findIndex((it) => it != null && String((it as Record<string, unknown>)[last.k]) === last.v);
  if (idx < 0) return false;
  cur[idx] = value;
  return true;
}

// Shorthand-only authoring keys. They drive a PRESET at expansion time, but once
// add_layers has expanded the preset into a concrete group (real x/y/width/height
// + child layers), re-setting them does NOTHING — the renderer reads the children,
// not these. A vision-less model patching `layers[0].pos`/`bg`/`stat` sees
// success but no change, and loops. Detect it and point at the real recovery.

export const INERT_ON_EXPANDED = new Set([
  'pos', 'bg', 'bg_style', 'background_style', 'bg_treatment', 'accent', 'text_color',
  'color', 'muted', 'kicker', 'label', 'eyebrow', 'stat', 'value', 'number',
  'subtitle', 'deck', 'caption', 'desc', 'body', 'footer', 'source', 'credit',
  'items', 'blocks', 'rows', 'data', 'series', 'bars', 'steps', 'points', 'metrics',
  'kpis', 'stats', 'values', 'details', 'palette', 'icon', 'mood', 'title',
]);

export function inertPresetKeyWarning(spec: Record<string, unknown>, dotPath: string): string | null {
  const toks = tokenizePath(dotPath);
  if (toks.length < 2) return null;
  const last = toks[toks.length - 1];
  if (last.kind !== 'key' || !INERT_ON_EXPANDED.has(last.key)) return null;
  let cur: unknown = spec;
  for (let i = 0; i < toks.length - 1; i++) {
    cur = descend(cur, toks[i]);
    if (cur == null || typeof cur !== 'object') return null;
  }
  const g = cur as Record<string, unknown>;
  const expanded = (g['type'] === 'group' || g['type'] === 'auto_layout')
    && Array.isArray(g['layers']) && (g['layers'] as unknown[]).length > 0
    && typeof g['width'] === 'number' && typeof g['height'] === 'number';
  if (!expanded) return null;
  const gid = typeof g['id'] === 'string' ? g['id'] : '(group)';
  return `"${dotPath}" sets shorthand key "${last.key}" on already-expanded preset "${gid}" — no render effect (it is now concrete child layers). To change its size, position, colour or content: remove_layer "${gid}", then add_layers a fresh preset with the corrected values.`;
}

export function isConstrained(): boolean {
  return process.env['MCP_CONSTRAINED_MODE'] === 'true';
}

// ── Animation timeline tools ──────────────────────────────────

export function inspectTimeline(args: {
  design_path: string;
  page_id?: string;
  project_path?: string;
}): ToolResult {
  const op = 'inspect_timeline';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  let layers: Layer[];

  if (args.page_id) {
    const page = (spec.pages ?? []).find((p: Page) => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Check page_id.');
    layers = page.layers ?? [];
  } else {
    // A poster keeps layers at the root; a carousel's first page is the
    // default, the same choice every other motion op makes.
    layers = spec.pages?.[0]?.layers ?? spec.layers ?? [];
  }

  // Scene view: every track (groups descended) as a bar from its delay to its
  // end, so a stagger, a late exit and a loop each read as what they are.
  const tracks = sceneTracks(layers);
  const ascii = renderSceneASCII(layers, tracks);

  return okResult(op, {
    track_count: tracks.length,
    scene_ms: sceneLength(tracks),
    tracks,
    ascii,
    ...(tracks.length === 0 ? { hint: 'No motion yet — animation(op:sequence) builds a scene in one call; op:presets lists the vocabulary.' } : {}),
  });
}

export function addKeyframeToLayer(args: {
  design_path: string;
  layer_id: string;
  keyframe: Keyframe;
  project_path?: string;
}): ToolResult {
  const op = 'add_keyframe';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);

  // Search top-level layers first, then each page — descending into groups.
  //
  // The walk has to recurse: every carousel page this engine authors is ONE
  // locked group wrapping the whole composition, so a top-level-only search
  // found nothing on any MCP-built deck and reported "Layer not found" for ids
  // that were plainly there. Nested groups are legal at any depth, so recurse
  // rather than special-casing one level.
  let found = false;
  const applyToLayer = (layer: Layer): Layer => {
    if (found) return layer;
    if (layer.id === args.layer_id) {
      found = true;
      return { ...layer, animation: addKeyframe(layer.animation ?? {}, args.keyframe) };
    }
    const children = (layer as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(children)) {
      const next = children.map(applyToLayer);
      if (found) return { ...layer, layers: next } as Layer;
    }
    return layer;
  };

  if (spec.layers) {
    spec.layers = spec.layers.map(applyToLayer);
  }
  if (!found && spec.pages) {
    for (const page of spec.pages) {
      if (page.layers) {
        page.layers = page.layers.map(applyToLayer);
        if (found) break;
      }
    }
  }

  if (!found) {
    return errResult(
      op,
      `Layer not found: ${args.layer_id}`,
      'Run manage_design(op:inspect) to list the real layer ids, including those inside groups.',
    );
  }

  // Mirror into spec.animations, which is the field the EDITOR reads. Without
  // it the design exports with motion and opens in the editor perfectly static.
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);
  return okResult(op, { layer_id: args.layer_id, keyframe: args.keyframe }, bak);
}

// ── Phase 5 — Animation / Remote / Collab ────────────────────

export function exportAnimation(args: {
  design_path: string;
  type: 'svg' | 'html' | 'gif' | 'mp4' | 'webm';
  output_path?: string;
  fps?: number;
  duration?: number;
  page_id?: string;
  all_pages?: boolean;
  project_path?: string;
}): ToolResult {
  const op = 'export_animation';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);

  // ── all_pages: one animated file per carousel page ──────────
  // A PDF carousel cannot animate, so the motion companion to a deck is a file
  // PER PAGE. Each page is exported through the normal single-page route, which
  // keeps asset inlining, the still-frame warning and the encoders identical.
  if (args.all_pages && (spec.pages?.length ?? 0) > 1) {
    const pages = spec.pages ?? [];
    const base = path.basename(dPath, '.design.yaml');
    const kind = args.type === 'html' ? 'html' : args.type === 'svg' ? 'svg' : args.type;
    const dir = args.output_path ? path.dirname(args.output_path) : path.join(path.dirname(dPath), '..', 'exports');
    const written: string[] = [];
    const failures: string[] = [];
    for (const [i, page] of pages.entries()) {
      const one = exportAnimation({
        ...args, all_pages: false,
        page_id: page.id,
        output_path: path.join(dir, `${base}-p${i + 1}.${kind}`),
      });
      const rec = one as unknown as { success?: boolean; output_path?: string; error?: string };
      if (rec.success && rec.output_path) written.push(rec.output_path);
      else failures.push(`${page.id}: ${rec.error ?? 'failed'}`);
    }
    if (written.length === 0) {
      return errResult(op, `No page exported: ${failures.join('; ')}`, 'Add motion with animation(op:motion) first, then export again.');
    }
    return okResult(op, {
      design_path: dPath,
      output_paths: written,
      pages: written.length,
      type: args.type,
      ...(failures.length ? { warning: `${failures.length} page(s) skipped`, skipped: failures } : {}),
      note: 'One animated file per page — post them as a motion companion to the PDF carousel (a PDF itself cannot animate).',
    });
  }

  const type = args.type;
  const baseName = path.basename(dPath, '.design.yaml');
  const ext = type === 'html' ? 'html' : type === 'svg' ? 'svg' : type;
  const outputPath = args.output_path ?? path.join(path.dirname(dPath), '..', 'exports', `${baseName}.${ext}`);

  // ── Binary-free routes: produce a real file, here, now ──────
  //
  // These exist because the raster routes below cannot run on a deployment
  // without Puppeteer and ffmpeg — which is the normal case, including
  // folio.casava.space. SVG animates natively, so no encoder is needed.
  if (type === 'svg' || type === 'html') {
    const pageIndex = pageIndexFor(spec, args.page_id);
    // Inline project assets before rendering. Without this the SVG carries a
    // relative href like "assets/images/logo.png", which resolves to nothing
    // once the file leaves the project directory — the export looked fine and
    // shipped with a missing image. export_design has always done this; these
    // routes were rendering straight past it.
    const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
    let built: { svg: string; animatedLayers: string[] };
    try {
      built = buildAnimatedSVG(spec, {
        pageIndex,
        renderSVG: (s, idx) => renderToSVGString(idx > 0 ? withActivePage(s, idx) : s),
      });
    } catch (e) {
      return errResult(op, `Failed to render: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.');
    }

    const content = type === 'html'
      // A still design gets no Replay control — a button that visibly does
      // nothing is worse than no button.
      ? wrapAnimatedHTML(built.svg, spec.meta?.name ?? baseName, built.animatedLayers.length > 0)
      : built.svg;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');

    // A still file is a legitimate result, but it is almost never what someone
    // asking for an animation wanted — say so rather than letting them find out.
    const still = built.animatedLayers.length === 0;
    return okResult(op, {
      design_path: dPath,
      output_path: outputPath,
      type,
      bytes: Buffer.byteLength(content),
      animated_layers: built.animatedLayers,
      ...(assetNotes.length ? { notes: assetNotes } : {}),
      ...(still ? {
        warning: 'No layer carries an animation, so this file is a still image.',
        next_action: 'Add motion with animation(op:keyframe) or animation(op:motion), then export again.',
      } : {}),
    });
  }

  // ── GIF: rendered and encoded in-process, no ffmpeg ────────
  if (type === 'gif') {
    const pageIndex = pageIndexFor(spec, args.page_id);
    const layers = spec.pages?.[pageIndex]?.layers ?? spec.layers ?? [];
    // Same reason as the SVG route: every frame is a real render, so an
    // unresolved asset href means a hole in all of them.
    const gifAssetNotes = resolveImageAssets(spec, dPath, args.project_path);
    const runMs = args.duration ?? animationDuration(layers);
    if (runMs <= 0) {
      return errResult(
        op,
        'Nothing in this design is animated, so a GIF would be a single still frame.',
        'Add motion with animation(op:motion) or animation(op:keyframe) first, ' +
        'or use export_design(format:"png") if a still is what you want.',
      );
    }

    const fps = args.fps ?? 12;

    // Cap the frame count against a memory budget, not a fixed number.
    //
    // Every frame is held as RGBA until the encoder runs, so the cost scales
    // with canvas AREA: one 1080x1080 frame is 4.6 MB, and a design whose
    // longest loop is 6s at 12fps wants 72 of them — 335 MB, in a 4g container
    // that is also serving requests. At 1440x1440 the same animation would not
    // fit at all. Budgeting ~180 MB of frame buffer keeps a big canvas to few
    // frames and a small one to many, which is the right trade in both cases.
    const FRAME_BUDGET_BYTES = 180 * 1024 * 1024;
    const perFrame = Math.max(1, spec.document.width * spec.document.height * 4);
    const maxFrames = Math.max(2, Math.min(150, Math.floor(FRAME_BUDGET_BYTES / perFrame)));

    let times = frameTimes(runMs, fps);
    let capNote: string | undefined;
    if (times.length > maxFrames) {
      // Drop the frame RATE rather than truncating the run: a shorter, smoother
      // clip would cut the animation off mid-move, while a coarser one still
      // shows the whole thing. Never silently — say what was reduced.
      const cappedFps = Math.max(1, Math.floor((maxFrames / runMs) * 1000));
      times = frameTimes(runMs, cappedFps);
      capNote = `Sampled at ${cappedFps}fps instead of ${fps}: ${Math.round(runMs)}ms at ${fps}fps needs ` +
        `${Math.round((runMs / 1000) * fps)} frames of ${spec.document.width}x${spec.document.height}, ` +
        `beyond this host's frame-memory budget. Pass a shorter duration, or export type:"svg" for full smoothness at any length.`;
    }

    const frames: GifFrame[] = [];
    try {
      const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
      for (const t of times) {
        const svg = renderToSVGString(withActivePage(specAt(spec, pageIndex, t), 0));
        const rendered = new Resvg(svg, { font: resvgFontOption(path.dirname(path.dirname(dPath))) }).render();
        frames.push({
          pixels: new Uint8ClampedArray(rendered.pixels),
          delayMs: Math.max(10, Math.round(runMs / times.length)),
        });
      }
    } catch (e) {
      return errResult(op, `Frame rendering failed: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.');
    }

    const gif = encodeGIF(frames, {
      width: spec.document.width,
      height: spec.document.height,
      loopCount: 0,
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, gif);

    return okResult(op, {
      design_path: dPath,
      output_path: outputPath,
      type,
      frames: frames.length,
      fps: Math.round((frames.length / runMs) * 1000),
      duration: runMs,
      bytes: gif.length,
      ...((): Record<string, unknown> => {
        const n = [...gifAssetNotes, ...(capNote ? [capNote] : [])];
        return n.length ? { notes: n } : {};
      })(),
      note: 'Encoded in-process — no ffmpeg or Puppeteer involved. ' +
        'For anywhere that renders SVG, type:"svg" is smaller and stays sharp at any size.',
    });
  }

  // ── Raster routes: honest about what the host can actually do ──
  const hasFfmpeg = tryFfmpeg();
  const hasPuppeteer = tryPuppeteer();
  if (!hasFfmpeg || !hasPuppeteer) {
    const missing = [!hasPuppeteer && 'puppeteer', !hasFfmpeg && 'ffmpeg'].filter(Boolean).join(' + ');
    return errResult(
      op,
      `${type} export needs ${missing}, which this host does not have.`,
      'Use type:"svg" for a vector animation or type:"html" for a shareable file — ' +
      'both are produced in-process with no extra software, and stay sharp at any size.',
    );
  }

  let html: string;
  try {
    html = assemblePresentationHTML(spec, {});
  } catch (e) {
    return errResult(op, `Failed to render HTML: ${(e as Error).message}`, 'Ensure the design has valid pages.');
  }

  const htmlPath = outputPath + '.tmp.html';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);

  return okResult(op, {
    design_path: dPath,
    output_path: outputPath,
    source_html: htmlPath,
    type,
    fps: args.fps ?? 30, // only mp4/webm reach here; gif is encoded in-process above
    duration: args.duration ?? 3000,
    ffmpeg_available: hasFfmpeg,
    next_action: 'Encode the captured HTML with exportToAnimation() from src/export/animation-export.ts.',
  });
}

export function setupRemotePresenter(args: {
  port?: number;
  design_path?: string;
  project_path?: string;
}): ToolResult {
  const op = 'setup_remote_presenter';
  const port = args.port ?? 3737;

  const clientScript = getClientScript(port);

  const curlNext = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"next"}'`;
  const curlPrev = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"prev"}'`;
  const curlGoto = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"goto","slide":0}'`;

  return okResult(op, {
    port,
    server_start_command: `node -e "const{startRemoteServer}=require('./dist/export/remote-server');startRemoteServer(${port}).then(()=>console.log('Remote clicker running on :${port}'))"`,
    client_script: clientScript,
    commands: { next: curlNext, prev: curlPrev, goto: curlGoto },
    hint: `Embed client_script in your presentation HTML inside a <script> tag, then start the server and use curl commands or any HTTP client to control slides.`,
  });
}

export function setupCollab(args: {
  design_path: string;
  port?: number;
  project_path?: string;
}): ToolResult {
  const op = 'setup_collab';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const port = args.port ?? 3738;

  return okResult(op, {
    design_path: dPath,
    port,
    server_start_command: `node -e "const{startCollabServer}=require('./dist/collab/collab-server');startCollabServer({design_path:'${dPath}',port:${port}}).then(s=>console.log('Collab server on :'+s.port))"`,
    endpoints: {
      events: `http://localhost:${port}/events`,
      design: `http://localhost:${port}/design`,
      patch:  `http://localhost:${port}/patch`,
    },
    hint: 'Start the collab server, then connect any client to /events (SSE) to receive design-changed events. POST to /patch with {content:"<yaml>"} to push changes.',
  });
}

// ── open_in_editor — return a URL the user can click to open Folio ──
//
// The Anthropic chat UI renders text content as Markdown, so a plain URL
// becomes a clickable link. We also attach a `resource` block so MCP
// clients that support resource previews can render the link richly.

export function openInEditor(args: {
  design_path?: string;
  project_path?: string;
  editor_url?: string;
  page?: number;
}): ToolResult {
  const op = 'open_in_editor';
  const progress: ProgressItem[] = [];

  let dPath = '';
  if (args.design_path) {
    dPath = resolveDesignPath(args.design_path, args.project_path);
    if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  }

  const link = buildEditorLink(dPath || undefined, {
    ...(typeof args.page === 'number' ? { page: args.page } : {}),
    ...(args.editor_url ? { editorUrl: args.editor_url } : {}),
  });
  // Lead with the SHORT link: it's ~40 chars (no JWT, no percent-encoding) so it
  // survives copy/paste into a chat, and it mints a fresh auth token server-side
  // on each click — the long open_url is a 300+ char JWT URL that mangles when
  // relayed by a human (the "the link is not working / give me a shorter link"
  // report). The short link is stable per design path, so re-opening the SAME
  // design returns the SAME short link (not a "new link for the same design").
  const share = link.short_url ?? link.open_url;
  progress.push(pOk('Editor link', share));

  const context = buildContext(op, `Editor link generated`,
    dPath ? [{ type: 'design', path: dPath, role: 'opened' }] : []);
  const handover = buildHandover('EXPORT', dPath ? { design_path: dPath } : {});

  return okResult(op, {
    url: share,
    share_url: link.short_url,
    open_url: link.open_url,
    editor_url: link.editor_url,
    design_path: dPath || undefined,
    hint: `Give the user this link: ${share} — it's short, survives copy/paste, and opens the live editor (live-refreshes as MCP edits the file).`,
    progress,
    context,
    handover,
    _attachments: [link.attachment],
  });
}
