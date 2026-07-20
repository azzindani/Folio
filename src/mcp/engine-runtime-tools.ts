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
import { buildTimelineTracks, renderTimelineASCII, addKeyframe } from '../ui/panels/timeline-panel';
import type { Keyframe } from '../animation/types';
import { getClientScript } from '../export/remote-server';
import { tryFfmpeg } from '../export/animation-export';
import { buildAnimatedSVG, wrapAnimatedHTML } from '../export/svg-animate';
import { renderToSVGString } from './engine/svg-export';

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

export function tokenizePath(dotPath: string): PathTok[] {
  const toks: PathTok[] = [];
  for (const seg of dotPath.split('.')) {
    const m = seg.match(/^([^[\]]*)((?:\[[^\]]+\])*)$/);
    if (!m) return [];
    if (m[1]) toks.push({ kind: 'key', key: m[1] });
    for (const acc of m[2].match(/\[[^\]]+\]/g) ?? []) {
      const inner = acc.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq >= 0) toks.push({ kind: 'filter', k: inner.slice(0, eq), v: inner.slice(eq + 1) });
      else if (/^\d+$/.test(inner)) toks.push({ kind: 'index', i: Number(inner) });
      else toks.push({ kind: 'key', key: inner });
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
    layers = spec.layers ?? [];
  }

  // Flatten before building tracks: buildTimelineTracks takes a flat array, so
  // a timeline built from the top level alone would report zero tracks for any
  // design whose content sits inside a group — which is every carousel page
  // this engine writes, and now every layer op:keyframe can reach.
  const flatten = (ls: Layer[]): Layer[] =>
    ls.flatMap(l => {
      const children = (l as Layer & { layers?: Layer[] }).layers;
      return Array.isArray(children) ? [l, ...flatten(children)] : [l];
    });

  const tracks = buildTimelineTracks(
    flatten(layers).map(l => ({
      id: l.id,
      label: (l as { label?: string }).label,
      animation: l.animation,
    })),
  );
  const ascii = renderTimelineASCII(tracks);

  return okResult(op, { track_count: tracks.length, tracks, ascii });
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
  project_path?: string;
}): ToolResult {
  const op = 'export_animation';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
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
      ? wrapAnimatedHTML(built.svg, spec.meta?.name ?? baseName)
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
      ...(still ? {
        warning: 'No layer carries an animation, so this file is a still image.',
        next_action: 'Add motion with animation(op:keyframe) or animation(op:motion), then export again.',
      } : {}),
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
    fps: args.fps ?? (type === 'gif' ? 10 : 30),
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
