/**
 * animation(op:export) — every motion format behind one door.
 *
 * svg/html hand the motion to the browser as CSS and are written here, in
 * process, in milliseconds. gif/mp4/webm are sampled frame by frame and
 * streamed to an encoder (motion-export-raster.ts). Moved out of
 * engine-runtime-tools.ts, which had reached the 700-line limit.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Page } from '../../schema/types';
import type { ToolResult } from '../types';
import { resolveDesignPath, readYAML, errResult, okResult } from './utils';
import { buildAnimatedSVG, wrapAnimatedHTML } from '../../export/svg-animate';
import { renderToSVGString } from './svg-export';
import { resolveImageAssets } from './asset-resolve';
import { exportRasterMotion } from './motion-export-raster';
import { specAt, animationDuration } from '../../export/gif-frames';
import { planScenes } from '../../export/scene-plan';
import { composeSceneFrame } from '../../export/scene-compose';
import { APPROXIMATED } from '../../export/scene-transition';

const TYPES = ['svg', 'html', 'gif', 'mp4', 'webm'] as const;
export type MotionExportType = typeof TYPES[number];

export interface ExportAnimationArgs {
  design_path: string;
  type: MotionExportType;
  output_path?: string;
  fps?: number;
  duration?: number;
  page_id?: string;
  all_pages?: boolean;
  /** Play every page, in order, as one piece — each page a scene. gif/mp4/webm. */
  scenes?: boolean;
  /** How long each scene rests after its motion ends, ms (a page's auto_advance wins). */
  hold_ms?: number;
  project_path?: string;
}

const OP = 'export_animation';

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
 * carousel would silently hand back page 1.
 */
function withActivePage(spec: DesignSpec, pageIndex: number): DesignSpec {
  const pages = spec.pages;
  if (!pages || pages.length <= pageIndex) return spec;
  return { ...spec, pages: [pages[pageIndex]] };
}

export async function exportAnimation(args: ExportAnimationArgs): Promise<ToolResult> {
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(OP, `Design not found: ${dPath}`, 'Check design_path.');
  if (!TYPES.includes(args.type)) {
    const what = args.type === undefined ? 'animation(op:export) needs a `type`.' : `Unknown export type: ${String(args.type)}.`;
    return errResult(OP, what, `Pass type as one of ${TYPES.join(' | ')} — svg/html for vector motion, gif or mp4 for feeds.`);
  }

  const spec = readYAML<DesignSpec>(dPath);
  if (args.scenes && args.all_pages) {
    return errResult(OP, 'scenes and all_pages ask for opposite things.',
      'scenes:true plays every page as ONE file; all_pages:true writes one file PER page. Pass one of them.');
  }
  if (args.all_pages && (spec.pages?.length ?? 0) > 1) return exportAllPages(args, spec, dPath);

  const pageIndex = pageIndexFor(spec, args.page_id);
  const baseName = path.basename(dPath, '.design.yaml');
  const outputPath = args.output_path ?? path.join(path.dirname(dPath), '..', 'exports', `${baseName}.${args.type}`);
  const pageCount = spec.pages?.length ?? 0;

  if (args.type === 'svg' || args.type === 'html') {
    if (args.scenes) {
      return errResult(OP, `scenes play as one file in gif, mp4 or webm — not ${args.type}.`,
        'Export type:"mp4" or "gif" with scenes:true, or presentation(op:export) for an HTML slideshow of the pages.');
    }
    return exportVectorMotion(spec, dPath, pageIndex, outputPath, args);
  }
  const base = { type: args.type, fps: args.fps, duration: args.duration, project_path: args.project_path };

  if (args.scenes) {
    if (pageCount === 0) {
      return errResult(OP, 'scenes:true plays pages in order, and this design has none.',
        'Build the piece as pages (append_page), one scene each, and give each its motion with animation(op:sequence, page_id).');
    }
    const plan = planScenes(spec, { hold_ms: args.hold_ms });
    const approximated = [...new Set(plan.scenes.map(s => s.transition?.type))]
      .flatMap(t => (t && APPROXIMATED[t] ? [`${t} ${APPROXIMATED[t]}.`] : []));
    return exportRasterMotion(spec, dPath, { durationMs: plan.total_ms, at: t => composeSceneFrame(spec, plan, t) }, outputPath, {
      ...base,
      notes: [...plan.warnings, ...approximated],
      extra: {
        scenes: plan.scenes.map(s => ({
          page_id: s.page_id, start_ms: s.start_ms, length_ms: s.length_ms,
          transition: s.transition ? `${s.transition.type} ${s.transition.duration_ms}ms` : 'cut',
        })),
      },
    });
  }

  const layers = spec.pages?.[pageIndex]?.layers ?? spec.layers ?? [];
  const pageNotes = pageCount > 1 && !args.page_id
    ? [`This design has ${pageCount} pages and only the first was exported. Pass scenes:true to play every page as one piece, or page_id for another page.`]
    : [];
  return exportRasterMotion(spec, dPath, { durationMs: animationDuration(layers), at: t => specAt(spec, pageIndex, t) }, outputPath, {
    ...base, notes: pageNotes,
  });
}

/** SVG animates natively, so no encoder is needed — a real file, here, now. */
function exportVectorMotion(spec: DesignSpec, dPath: string, pageIndex: number, outputPath: string, args: ExportAnimationArgs): ToolResult {
  const baseName = path.basename(dPath, '.design.yaml');
  // Inline project assets before rendering. Without this the SVG carries a
  // relative href like "assets/images/logo.png", which resolves to nothing
  // once the file leaves the project directory.
  const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
  let built: { svg: string; animatedLayers: string[] };
  try {
    built = buildAnimatedSVG(spec, {
      pageIndex,
      renderSVG: (s, idx) => renderToSVGString(idx > 0 ? withActivePage(s, idx) : s),
    });
  } catch (e) {
    return errResult(OP, `Failed to render: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.');
  }

  const content = args.type === 'html'
    // A still design gets no Replay control — a button that visibly does
    // nothing is worse than no button.
    ? wrapAnimatedHTML(built.svg, spec.meta?.name ?? baseName, built.animatedLayers.length > 0)
    : built.svg;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');

  // A still file is a legitimate result, but it is almost never what someone
  // asking for an animation wanted — say so rather than letting them find out.
  const still = built.animatedLayers.length === 0;
  return okResult(OP, {
    design_path: dPath,
    output_path: outputPath,
    type: args.type,
    bytes: Buffer.byteLength(content),
    animated_layers: built.animatedLayers,
    ...(assetNotes.length ? { notes: assetNotes } : {}),
    ...(still ? {
      warning: 'No layer carries an animation, so this file is a still image.',
      next_action: 'Add motion with animation(op:keyframe) or animation(op:motion), then export again.',
    } : {}),
  });
}

/**
 * One animated file per carousel page. A PDF carousel cannot animate, so the
 * motion companion to a deck is a file PER PAGE, each through the normal
 * single-page route.
 */
async function exportAllPages(args: ExportAnimationArgs, spec: DesignSpec, dPath: string): Promise<ToolResult> {
  const pages = spec.pages ?? [];
  const base = path.basename(dPath, '.design.yaml');
  const dir = args.output_path ? path.dirname(args.output_path) : path.join(path.dirname(dPath), '..', 'exports');
  const written: string[] = [];
  const failures: string[] = [];
  const pageNotes: string[] = [];
  const rates: Array<{ page: string; fps: number }> = [];
  for (const [i, page] of pages.entries()) {
    const one = await exportAnimation({ ...args, all_pages: false, page_id: page.id, output_path: path.join(dir, `${base}-p${i + 1}.${args.type}`) });
    const rec = one as unknown as { success?: boolean; output_path?: string; error?: string; notes?: string[]; fps?: number };
    if (rec.success && rec.output_path) {
      written.push(rec.output_path);
      // Carry each page's NOTES up — a quality warning that reaches nobody is
      // the same as no warning.
      for (const n of rec.notes ?? []) pageNotes.push(`${page.id}: ${n}`);
      if (typeof rec.fps === 'number') rates.push({ page: page.id, fps: rec.fps });
    } else {
      failures.push(`${page.id}: ${rec.error ?? 'failed'}`);
    }
  }
  if (written.length === 0) {
    return errResult(OP, `No page exported: ${failures.join('; ')}`, 'Add motion with animation(op:motion) first, then export again.');
  }
  // Name the worst page rather than only the best: a caller scanning one
  // number should see the one that will look wrong.
  const worst = rates.slice().sort((a, b) => a.fps - b.fps)[0];
  const choppy = rates.filter(r => r.fps < 8).map(r => `${r.page} (${r.fps}fps)`);
  return okResult(OP, {
    design_path: dPath,
    output_paths: written,
    pages: written.length,
    type: args.type,
    ...(rates.length ? { fps_per_page: Object.fromEntries(rates.map(r => [r.page, r.fps])) } : {}),
    ...(worst ? { slowest_page: `${worst.page} at ${worst.fps}fps` } : {}),
    ...(choppy.length ? {
      warning: `${choppy.length} page(s) exported below 8fps and will look choppy: ${choppy.join(', ')}`,
      hint: 'That is the fps that was asked for. Pass fps 12 or more for smooth motion, or type:"svg" for full smoothness at any length.',
    } : {}),
    ...(pageNotes.length ? { page_notes: pageNotes } : {}),
    ...(failures.length ? { skipped: failures } : {}),
    note: 'One animated file per page — post them as a motion companion to the PDF carousel (a PDF itself cannot animate).',
  });
}
