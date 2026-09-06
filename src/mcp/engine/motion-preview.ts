/**
 * `animation(op:preview)` — see the whole scene in one call.
 *
 * `op:frame` renders ONE pose, so checking a scene meant guessing which
 * millisecond mattered and calling it again and again; `op:timeline` gives the
 * structure but not the picture; and the only way to actually WATCH the motion
 * was `animation(op:export, type:"html")` and opening the file.
 *
 * This returns both halves at once, because the two audiences cannot use the
 * same artefact:
 *
 *   • a FILMSTRIP png, inline — N poses across the scene in a labelled grid.
 *     A model cannot watch a GIF (an image block is one frame), but it can read
 *     a contact sheet in a single look and say "the title arrives before the
 *     kicker has left".
 *   • a looping GIF written next to the design, for a person to open.
 *
 * Both come off the same sampler the exporter uses (`specAt`), so what the strip
 * shows is what the export will contain.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, readYAML, errResult, okResult, pOk, pInfo, buildContext } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { resolveImageAssets } from './asset-resolve';
import { buildEditorLink } from './editor-link';
import { specAt, animationDuration } from '../../export/gif-frames';
import { encodeGIF, type GifFrame } from '../../export/gif-encode';

/** Evenly spaced sample times across a scene, first and last included. */
export function previewTimes(sceneMs: number, count: number): number[] {
  const n = Math.max(2, Math.min(24, Math.floor(count)));
  if (!(sceneMs > 0)) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((sceneMs * i) / (n - 1)));
  return out;
}

/** Columns for a filmstrip of n cells — wide enough to read, never a long row. */
export function stripColumns(n: number): number {
  if (n <= 3) return n;
  if (n <= 8) return Math.ceil(n / 2);
  return Math.ceil(n / 3);
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/**
 * A contact sheet of rendered poses, as SVG (rasterised by the caller).
 *
 * Each cell is the frame with its timecode under it, so the reader can tell
 * WHEN as well as what — a strip of six near-identical stills is only useful
 * if you can see that five of them are after the motion has finished.
 */
/** Mono where the renderer has one, and a family that is definitely PRESENT
 *  last — `monospace` alone is a generic, and resvg drops text it cannot
 *  resolve rather than substituting. DejaVu Sans ships with the image. */
const STRIP_FONT = 'ui-monospace, monospace, DejaVu Sans';

export function filmstripSVG(
  cells: Array<{ png: Buffer; t: number }>,
  cellW: number,
  cellH: number,
  sceneMs: number,
): string {
  const cols = stripColumns(cells.length);
  const rows = Math.ceil(cells.length / cols);
  const PAD = 12, LABEL = 20;
  const w = PAD + cols * (cellW + PAD);
  const h = PAD + rows * (cellH + LABEL + PAD) + 10;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#14161A"/>`,
  ];
  cells.forEach((c, i) => {
    const cx = PAD + (i % cols) * (cellW + PAD);
    const cy = PAD + Math.floor(i / cols) * (cellH + LABEL + PAD);
    parts.push(
      `<rect x="${cx - 1}" y="${cy - 1}" width="${cellW + 2}" height="${cellH + 2}" fill="none" stroke="#2A2F37"/>`,
      `<image x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${c.png.toString('base64')}"/>`,
      `<text x="${cx}" y="${cy + cellH + 14}" font-family="${STRIP_FONT}" font-size="11" fill="#8892A4">${esc(`${c.t}ms`)}</text>`,
    );
  });
  parts.push(
    `<text x="${PAD}" y="${h - 4}" font-family="${STRIP_FONT}" font-size="11" fill="#5A6270">scene ${Math.round(sceneMs)}ms · ${cells.length} poses</text>`,
    '</svg>',
  );
  return parts.join('');
}

export interface PreviewArgs {
  design_path: string;
  project_path?: string;
  page_id?: string;
  /** How many poses to sample (2–24, default 6). */
  frames?: number;
  /** Longest edge of each cell, px (default 260). */
  cell?: number;
  /** Skip the GIF and return only the strip. */
  strip_only?: boolean;
}

export function previewMotion(args: PreviewArgs): ToolResult {
  const op = 'preview_motion';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const projDir = args.project_path ?? path.dirname(path.dirname(dPath));

  const pages = spec.pages ?? [];
  const pageIndex = args.page_id ? pages.findIndex(p => p.id === args.page_id) : 0;
  if (args.page_id && pageIndex < 0) {
    return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${pages.map(p => p.id).join(', ')}`, progress);
  }
  const layers = pages[Math.max(0, pageIndex)]?.layers ?? spec.layers ?? [];
  const sceneMs = animationDuration(layers);
  if (!(sceneMs > 0)) {
    return errResult(op,
      'Nothing on this surface is animated, so a preview would be one still.',
      'Write a scene first — animation(op:sequence) does it in one call, and animation(op:presets) lists the vocabulary. For a still, use render_preview.',
      progress);
  }

  // Unresolved hrefs would be a hole in every cell, exactly as for the exporter.
  for (const n of resolveImageAssets(spec, dPath, args.project_path)) progress.push(pInfo('Image note', n));

  const count = Math.max(2, Math.min(24, Math.floor(Number(args.frames) || 6)));
  const times = previewTimes(sceneMs, count);
  const docW = spec.document?.width ?? 1080, docH = spec.document?.height ?? 1080;
  const cellLong = Math.max(80, Math.min(480, Math.floor(Number(args.cell) || 260)));
  const zoom = cellLong / Math.max(docW, docH);
  const cellW = Math.max(1, Math.round(docW * zoom)), cellH = Math.max(1, Math.round(docH * zoom));

  const cells: Array<{ png: Buffer; t: number }> = [];
  try {
    for (const t of times) {
      const svg = renderToSVGString(framedSpec(spec, Math.max(0, pageIndex), t));
      const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: cellW }, background: '#FFFFFF', font: resvgFontOption(projDir),
      }).render().asPng();
      cells.push({ png: Buffer.from(png), t });
    }
  } catch (e) {
    return errResult(op, `Frame render failed: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.', progress);
  }
  progress.push(pOk(`Sampled ${cells.length} poses`, `${times[0]}–${times[times.length - 1]}ms of a ${Math.round(sceneMs)}ms scene`));

  // The strip draws its OWN text — a timecode under each cell and the scene
  // summary — so it needs a font database exactly as much as the cells above
  // do. Without one, resvg finds no match for the generic `monospace` family
  // and silently drops every label: the poses looked right on a developer
  // machine and arrived unlabelled from the container, where the font set is
  // different. A filmstrip with no timecodes is a contact sheet with no
  // contact sheet.
  const stripPng = new Resvg(filmstripSVG(cells, cellW, cellH, sceneMs), {
    background: '#14161A', font: resvgFontOption(projDir),
  }).render().asPng();

  const out: Record<string, unknown> = {
    design_path: dPath, scene_ms: Math.round(sceneMs), poses: cells.length,
    times, cell: `${cellW}×${cellH}`, strip_bytes: stripPng.length,
  };

  if (!args.strip_only) {
    const gif = writeLoopGif(spec, dPath, Math.max(0, pageIndex), sceneMs, projDir, cellW, cellH);
    if (gif) {
      out['gif_path'] = gif.path;
      out['gif_frames'] = gif.frames;
      progress.push(pOk('Wrote a looping GIF', `${gif.frames} frames · ${gif.bytes} bytes`));
      const link = buildEditorLink(dPath);
      out['open_url'] = link.short_url ?? link.open_url;
    } else {
      progress.push(pInfo('No GIF written', 'the scene rendered, but the encoder declined this canvas'));
    }
  }

  return okResult(op, {
    ...out,
    next_action: {
      tool: 'animation', params: { op: 'timeline', design_path: dPath }, remaining: 0,
      hint: 'The strip shows WHAT each pose looks like; animation(op:timeline) shows which track owns which moment. Adjust with animation(op:track) or op:sequence, then preview again.',
    },
    progress,
    context: buildContext(op, `Previewed ${cells.length} poses of a ${Math.round(sceneMs)}ms scene`),
    _attachments: [{ type: 'image' as const, data: Buffer.from(stripPng).toString('base64'), mimeType: 'image/png' }],
  });
}

/** The design as it looks at `t`, with the previewed page promoted to the root. */
function framedSpec(spec: DesignSpec, pageIndex: number, t: number): DesignSpec {
  const at = specAt(spec, pageIndex, t);
  const pages = at.pages ?? [];
  if (!pages.length) return at;
  return { ...at, layers: pages[pageIndex]?.layers ?? at.layers ?? [], pages: undefined } as DesignSpec;
}

/** A small looping GIF beside the design — the half a person can actually watch. */
function writeLoopGif(
  spec: DesignSpec, dPath: string, pageIndex: number, sceneMs: number,
  projDir: string, cellW: number, cellH: number,
): { path: string; frames: number; bytes: number } | null {
  // 12fps, capped so a long scene cannot blow the frame budget the exporter
  // documents — this is a preview, not the deliverable.
  const fps = 12;
  const wanted = Math.max(2, Math.round((sceneMs / 1000) * fps));
  const n = Math.min(48, wanted);
  const times = previewTimes(sceneMs, n);
  const frames: GifFrame[] = [];
  try {
    for (const t of times) {
      const svg = renderToSVGString(framedSpec(spec, pageIndex, t));
      const r = new Resvg(svg, { fitTo: { mode: 'width', value: cellW }, background: '#FFFFFF', font: resvgFontOption(projDir) }).render();
      frames.push({ pixels: new Uint8ClampedArray(r.pixels), delayMs: Math.max(20, Math.round(sceneMs / times.length)) });
    }
    const gif = encodeGIF(frames, { width: cellW, height: cellH, loopCount: 0 });
    const outPath = dPath.replace(/\.design\.yaml$/, '.preview.gif');
    fs.writeFileSync(outPath, gif);
    return { path: outPath, frames: frames.length, bytes: gif.length };
  } catch { return null; }
}
