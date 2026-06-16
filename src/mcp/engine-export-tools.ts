// Folio MCP engine — export/diagnose/render/align/template/component tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page, ComponentSpec } from '../schema/types';
import type { ToolResult } from './types';

import { Resvg } from '@resvg/resvg-js';
import { jsPDF } from 'jspdf';
import type { ProgressItem } from './types';
import { validateDesignSpec } from '../schema/validator';

import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './engine/utils';

import { resvgFontOption, unbundledFonts } from './engine/fonts';

import { analyzeLayers, type Finding } from './engine/diagnose';
import { buildEditorLink } from './engine/editor-link';

import { renderToSVGString, renderToSVGElement, serializeSVGElement } from './engine/svg-export';
import { addVectorPdfPage, type PdfDoc } from './engine/pdf-build';

import type { NextAction } from './types';
import { assembleReportHTML } from '../export/html-assembler';

import type { LoadedDataset } from '../report/data-loader';

import { createDesign } from './engine-project-tools';

import { patchDesign } from './engine-edit-tools';

export function flagMissingImages(spec: DesignSpec, baseDirs: string[]): string[] {
  const notes: string[] = [];
  const dirs = baseDirs.filter(Boolean);
  const visit = (layers: Layer[] | undefined): void => {
    for (const l of layers ?? []) {
      if (l.type === 'image') {
        const img = l as Layer & { src?: string };
        const src = img.src;
        if (typeof src === 'string' && src.trim() && !/^(https?:|data:|file:|\/\/)/i.test(src)) {
          const found = dirs.some(d => { try { return fs.existsSync(path.resolve(d, src)); } catch { return false; } });
          if (!found) {
            img.src = '';
            notes.push(`image "${l.id}": asset "${src}" not found — exported as a placeholder frame. Use a real file path, an https:// URL, or swap it for a fill/shape/icon.`);
          }
        }
      }
      if (l.type === 'group') visit((l as Layer & { layers?: Layer[] }).layers);
    }
  };
  visit(spec.layers);
  for (const p of spec.pages ?? []) visit((p as Page & { layers?: Layer[] }).layers);
  return notes;
}

// Load the project's saved components into a registry so `type:component`
// layers resolve during export (the renderer needs componentRegistry; without
// it a component renders empty). Best-effort — returns undefined on any miss.

export function loadComponentRegistry(projectDir: string | undefined): Map<string, ComponentSpec> | undefined {
  if (!projectDir) return undefined;
  const indexPath = path.join(projectDir, 'components/index.yaml');
  if (!fs.existsSync(indexPath)) return undefined;
  try {
    const index = readYAML<{ components?: { id: string; path: string }[] }>(indexPath);
    const reg = new Map<string, ComponentSpec>();
    for (const entry of index.components ?? []) {
      const cPath = path.join(projectDir, entry.path);
      if (fs.existsSync(cPath)) reg.set(entry.id, readYAML<ComponentSpec>(cPath));
    }
    return reg.size ? reg : undefined;
  } catch { return undefined; }
}

/**
 * Collect absolute-positioned clickable rects from every layer carrying an
 * `href` (recursing into groups — group children are stored in absolute
 * coords). Used to add PDF `/Link` annotations over hyperlinked layers.
 */

export function collectHrefRects(layers: Layer[]): { x: number; y: number; w: number; h: number; href: string }[] {
  const out: { x: number; y: number; w: number; h: number; href: string }[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      const href = (l as { href?: unknown }).href;
      const g = l as { x?: number; y?: number; width?: number; height?: number; layers?: Layer[] };
      if (typeof href === 'string' && href.trim() && (g.width ?? 0) > 0 && (g.height ?? 0) > 0) {
        out.push({ x: g.x ?? 0, y: g.y ?? 0, w: g.width ?? 0, h: g.height ?? 0, href });
      }
      if (Array.isArray(g.layers)) walk(g.layers);
    }
  };
  walk(layers);
  return out;
}

export function exportDesign(args: { design_path: string; format: string; output_path?: string; scale?: number; project_path?: string }): ToolResult {
  const op = 'export_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const criticals = validateDesignSpec(spec).filter(e => e.severity === 'error');
  if (criticals.length > 0) return errResult(op, `Validation errors: ${criticals.map(e => e.message).join('; ')}`, 'Fix errors then retry.', progress);

  const assetNotes = flagMissingImages(spec, [
    path.dirname(dPath), path.dirname(path.dirname(dPath)),
    ...(args.project_path ? [args.project_path, path.join(args.project_path, 'assets')] : []),
  ]);
  for (const n of assetNotes) progress.push(pInfo('Missing asset', n));

  // Load project components so `type:component` layers resolve in the export.
  const componentRegistry = loadComponentRegistry(args.project_path ?? path.dirname(path.dirname(dPath)));

  // Carousels store their content on `pages[]`, not root `layers` — renderDesign
  // only walks root layers, so a whole-spec render of a carousel is blank. Render
  // each page as a synthetic single-page spec (its layers promoted to the root)
  // and emit one file per page. `multiPage` is false for posters/reports.
  const pages = spec.pages ?? [];
  const multiPage = pages.length > 0;
  const renderPageSVG = (page: Page): string =>
    renderToSVGString(
      { ...spec, layers: page.layers ?? [], pages: undefined } as DesignSpec,
      undefined, undefined, componentRegistry,
    );

  const outPath = args.output_path ?? dPath.replace('.design.yaml', `.${args.format}`);
  const link = buildEditorLink(dPath);
  if (args.format === 'svg') {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // Carousel → one SVG per page (`<base>-p1.svg`, `-p2.svg`, …).
      if (multiPage) {
        const base = outPath.replace(/\.svg$/i, '');
        const outPaths: string[] = [];
        const _attachments: unknown[] = [];
        let totalBytes = 0;
        pages.forEach((page, i) => {
          const svgStr = renderPageSVG(page);
          const pPath = `${base}-p${i + 1}.svg`;
          fs.writeFileSync(pPath, svgStr, 'utf-8');
          outPaths.push(pPath);
          totalBytes += svgStr.length;
          progress.push(pOk(`SVG page ${i + 1}/${pages.length}`, `${path.basename(pPath)} (${svgStr.length} bytes)`));
          _attachments.push({ type: 'image' as const, data: Buffer.from(svgStr, 'utf-8').toString('base64'), mimeType: 'image/svg+xml' });
        });
        _attachments.push(link.attachment);
        const context = buildContext(op, `SVG exported for "${spec.meta.name}" — ${outPaths.length} page(s)`, outPaths.map(p => ({ type: 'svg', path: p, role: 'output' })));
        const handover = buildHandover('EXPORT', { design_path: dPath });
        return okResult(op, { format: 'svg', pages: outPaths.length, output_files: outPaths.map(p => path.basename(p)), output_paths: outPaths, output_path: outPaths[0], status: 'ok', bytes: totalBytes, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
      }
      const svgStr = renderToSVGString(spec, undefined, undefined, componentRegistry);
      fs.writeFileSync(outPath, svgStr, 'utf-8');
      progress.push(pOk('SVG written', path.basename(outPath)));
      const context = buildContext(op, `SVG exported for "${spec.meta.name}"`, [
        { type: 'svg', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      // Attach the SVG inline so MCP-aware chat clients can preview the
      // export without opening the file. Also include a resource link to
      // the file path so file-system clients can open it locally.
      const _attachments = [
        { type: 'image' as const, data: Buffer.from(svgStr, 'utf-8').toString('base64'), mimeType: 'image/svg+xml' },
        { type: 'resource' as const, resource: { uri: `file://${outPath}`, mimeType: 'image/svg+xml', text: path.basename(outPath) } },
        link.attachment,
      ];
      return okResult(op, { format: 'svg', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: svgStr.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
    } catch (err) {
      return errResult(op, `SVG render failed: ${(err as Error).message}`, 'Check design spec validity.', progress);
    }
  }
  if (args.format === 'html') {
    try {
      
      const datasets = new Map<string, LoadedDataset>();
      const sources: { id: string; rows?: Record<string, unknown>[] }[] = spec.report?.data?.sources ?? [];
      for (const src of sources) {
        if (src.rows) datasets.set(src.id, { id: src.id, rows: src.rows });
      }
      // Carousel → stack every page's SVG vertically so the single HTML doc
      // shows the whole deck (whole-spec render would be blank — pages aren't
      // root layers). Poster/report keep their existing single-body render.
      const body = multiPage
        ? pages.map((page, i) => `<div class="folio-page" data-page="${i + 1}">${renderPageSVG(page)}</div>`).join('\n')
        : renderToSVGString(spec, undefined, undefined, componentRegistry);
      const html: string = spec.meta.type === 'report'
        ? assembleReportHTML(spec, datasets, {})
        : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${spec.meta.name}</title><style>body{margin:0}.folio-page{display:block;margin:0 auto}.folio-page+.folio-page{margin-top:16px}</style></head><body>${body}</body></html>`;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf-8');
      progress.push(pOk('HTML written', path.basename(outPath)));
      const context = buildContext(op, `HTML exported for "${spec.meta.name}"`, [{ type: 'html', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'html', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: html.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, handover, _attachments: [link.attachment] });
    } catch (err) {
      return errResult(op, `HTML export failed: ${(err as Error).message}`, 'Check design spec.', progress);
    }
  }
  if (args.format === 'pdf') {
    // Hybrid VECTOR PDF, in-container (no browser/Chromium): text is drawn as
    // real, selectable glyphs with embedded bundled fonts (crisp at ANY zoom,
    // copy-paste works) over a high-DPI resvg raster that carries backgrounds,
    // gradients and effects. Text that can't be placed exactly (gradient fill,
    // rotation, curved paths, unbundled fonts) stays in the raster, so the PDF
    // is never worse than the old all-raster output. `/Link` annotations sit
    // over every hyperlinked layer.
    try {
      const scale = typeof args.scale === 'number' && args.scale > 0 ? args.scale : 3;
      const missingFonts = new Set<string>();
      const toPt = (px: number): number => (px * 72) / 96;
      const dim = (el: SVGSVGElement, attr: 'width' | 'height', fallback: number): number => {
        const v = parseFloat(el.getAttribute(attr) ?? '');
        return Number.isFinite(v) && v > 0 ? v : fallback;
      };

      // One render spec per output page. Rendering also applies flow layout +
      // mutates layer geometry in place, so the link rects read post-layout.
      const sheetSpecs = multiPage
        ? pages.map(page => ({ spec: { ...spec, layers: page.layers ?? [], pages: undefined } as DesignSpec, layers: page.layers ?? [] }))
        : [{ spec, layers: spec.layers ?? [] }];

      const registered = new Set<string>();
      let vectorRuns = 0;
      let pdf: jsPDF | null = null;
      sheetSpecs.forEach(s => {
        // Render to a LIVE element (not a string) so the vector-PDF builder can
        // walk <text> nodes directly — re-parsing the string would throw on
        // markdown foreignObject HTML (not valid XML).
        const el = renderToSVGElement(s.spec, undefined, undefined, componentRegistry);
        const w = dim(el, 'width', spec.document.width);
        const h = dim(el, 'height', spec.document.height);
        for (const f of unbundledFonts(serializeSVGElement(el))) missingFonts.add(f);
        const orient = w >= h ? 'landscape' : 'portrait';
        if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [toPt(w), toPt(h)], compress: true });
        else pdf.addPage([toPt(w), toPt(h)], orient);
        vectorRuns += addVectorPdfPage(pdf as unknown as PdfDoc, { svg: el, width: w, height: h }, scale, registered);
        for (const r of collectHrefRects(s.layers)) {
          pdf.link(toPt(r.x), toPt(r.y), toPt(r.w), toPt(r.h), { url: r.href });
        }
      });
      const doc = pdf as unknown as jsPDF;

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const pdfBuf = Buffer.from(doc.output('arraybuffer'));
      fs.writeFileSync(outPath, pdfBuf);
      progress.push(pOk('PDF written', `${path.basename(outPath)} (${pdfBuf.length} bytes @ ${scale}× · ${vectorRuns} vector text run(s))`));
      const linkCount = sheetSpecs.reduce((n, s) => n + collectHrefRects(s.layers).length, 0);
      const notes = [
        `Vector PDF — ${vectorRuns} text run(s) embedded as selectable, zoom-crisp glyphs over a ${scale}× raster (backgrounds/gradients/effects). Copy-paste works; text stays sharp at any zoom.`,
        ...(missingFonts.size ? [`Some text stayed in the raster (font not bundled, so it can't be embedded as vector): ${[...missingFonts].join(', ')}. Use a bundled family (Inter, Space Grotesk, Playfair Display, IBM Plex Mono…) for fully-vector text.`] : []),
      ];
      const context = buildContext(op, `PDF exported for "${spec.meta.name}"`, [{ type: 'pdf', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'pdf', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: pdfBuf.length, scale, pages: multiPage ? pages.length : 1, links: linkCount, vector_runs: vectorRuns, notes, progress, context, handover });
    } catch (err) {
      return errResult(op, `PDF render failed: ${(err as Error).message}`, 'Try format="png" or "svg" to isolate; PDF = resvg raster + jsPDF vector text.', progress);
    }
  }
  if (args.format === 'png') {
    try {
      // @resvg/resvg-js is a pure-Rust SVG renderer; prebuilt binaries
      // ship for linux-x64-musl (alpine), linux-x64-gnu, darwin, win32.
      const scale = typeof args.scale === 'number' && args.scale > 0 ? args.scale : 2;
      // resvg can't fetch web fonts — it only renders fonts we hand it. Point it
      // at the bundled font directory (src/mcp/fonts, COPY'd into the image) so
      // raster output matches the editor's web-font render; DejaVu is the last
      // resort for any family we don't ship. Families a design uses but we DON'T
      // bundle are collected below and surfaced as a note (they'd silently fall
      // back to DejaVu here while rendering fine in the editor).
      const missingFonts = new Set<string>();
      // resvg's `fitTo: { mode: 'zoom' }` scales the rendered raster while
      // keeping the SVG viewBox aspect ratio.
      const rasterize = (svgStr: string): Buffer => {
        for (const f of unbundledFonts(svgStr)) missingFonts.add(f);
        return Buffer.from(new Resvg(svgStr, {
          fitTo: { mode: 'zoom', value: scale },
          background: 'rgba(0,0,0,0)',
          font: resvgFontOption(),
        }).render().asPng());
      };
      const fontNote = (): string[] =>
        missingFonts.size
          ? [`Fonts not bundled for raster export — fell back to a default in PNG/PDF (they render correctly in the editor): ${[...missingFonts].join(', ')}. Use a bundled family (e.g. Inter, Space Grotesk, Playfair Display, IBM Plex Mono) for pixel-matching export.`]
          : [];
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // Carousel → one PNG per page (`<base>-p1.png`, `-p2.png`, …).
      if (multiPage) {
        const base = outPath.replace(/\.png$/i, '');
        const outPaths: string[] = [];
        const _attachments: unknown[] = [];
        let totalBytes = 0;
        pages.forEach((page, i) => {
          const png = rasterize(renderPageSVG(page));
          const pPath = `${base}-p${i + 1}.png`;
          fs.writeFileSync(pPath, png);
          outPaths.push(pPath);
          totalBytes += png.length;
          progress.push(pOk(`PNG page ${i + 1}/${pages.length}`, `${path.basename(pPath)} (${png.length} bytes @ ${scale}×)`));
          _attachments.push({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' });
        });
        const context = buildContext(op, `PNG exported for "${spec.meta.name}" — ${outPaths.length} page(s)`, outPaths.map(p => ({ type: 'png', path: p, role: 'output' })));
        const handover = buildHandover('EXPORT', { design_path: dPath });
        return okResult(op, { format: 'png', pages: outPaths.length, output_files: outPaths.map(p => path.basename(p)), output_paths: outPaths, output_path: outPaths[0], status: 'ok', bytes: totalBytes, scale, ...((): Record<string, unknown> => { const n = [...assetNotes, ...fontNote()]; return n.length ? { notes: n } : {}; })(), progress, context, handover, _attachments });
      }
      const png = rasterize(renderToSVGString(spec, undefined, undefined, componentRegistry));
      fs.writeFileSync(outPath, png);
      progress.push(pOk('PNG written', `${path.basename(outPath)} (${png.length} bytes @ ${scale}×)`));
      const context = buildContext(op, `PNG exported for "${spec.meta.name}"`, [
        { type: 'png', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      const _attachments = [
        { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'resource' as const, resource: { uri: `file://${outPath}`, mimeType: 'image/png', text: path.basename(outPath) } },
      ];
      return okResult(op, { format: 'png', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: png.length, scale, ...((): Record<string, unknown> => { const n = [...assetNotes, ...fontNote()]; return n.length ? { notes: n } : {}; })(), progress, context, handover, _attachments });
    } catch (err) {
      return errResult(op, `PNG render failed: ${(err as Error).message}`, 'Try format="svg" to verify the design renders; PNG layer = SVG layer + resvg rasterizer.', progress);
    }
  }
  return errResult(
    op,
    `Unsupported export format: ${args.format}`,
    `Supported formats: svg, png, pdf (vector, selectable text), html.`,
    progress,
  );
}

// ── diagnose_design ─────────────────────────────────────────
// Built-in troubleshooter: geometry + composition + quality findings with fixes.

export function diagnoseDesign(args: { design_path: string; project_path?: string; page_id?: string }): ToolResult {
  const op = 'diagnose_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;

  const run = (layers: Layer[], pageId?: string): (Finding & { page?: string })[] =>
    analyzeLayers(layers ?? [], W, H).map(f => (pageId ? { ...f, page: pageId } : f));

  let findings: (Finding & { page?: string })[] = [];
  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    findings = run(page.layers ?? [], page.id);
  } else if (spec.pages) {
    for (const page of spec.pages) findings.push(...run(page.layers ?? [], page.id));
  } else {
    findings = run(spec.layers ?? []);
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const suggestions = findings.filter(f => f.severity === 'suggestion');
  progress.push(pOk('Diagnosed', `${errors.length} error(s), ${warnings.length} warning(s), ${suggestions.length} suggestion(s)`));
  const summary = errors.length === 0 && warnings.length === 0
    ? (suggestions.length ? 'No problems — some polish suggestions.' : 'Clean — no problems found.')
    : `${errors.length} error(s) + ${warnings.length} warning(s) to fix.`;
  const context = buildContext(op, `Diagnosed "${spec.meta.name}" — ${summary}`);
  return okResult(op, {
    ok: errors.length === 0, summary,
    counts: { errors: errors.length, warnings: warnings.length, suggestions: suggestions.length },
    findings: findings.slice(0, 40), progress, context,
  });
}

// ── render_preview ──────────────────────────────────────────
// Render the design to a PNG and return it INLINE as an image block, so the
// model can actually SEE what it produced (no file written). Closes the
// "MCP is blind" gap — pair with diagnose_design to verify a fix visually.

export function renderPreview(args: { design_path: string; project_path?: string; page_id?: string; scale?: number }): ToolResult {
  const op = 'render_preview';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const componentRegistry = loadComponentRegistry(args.project_path ?? path.dirname(path.dirname(dPath)));
  const scale = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  try {
    const renderSpec = (spec.pages?.length)
      ? ({ ...spec, layers: (args.page_id ? spec.pages.find(p => p.id === args.page_id) : spec.pages[0])?.layers ?? [], pages: undefined } as DesignSpec)
      : spec;
    const svgStr = renderToSVGString(renderSpec, undefined, undefined, componentRegistry);
    const missing = unbundledFonts(svgStr);
    const png = Buffer.from(new Resvg(svgStr, {
      fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(),
    }).render().asPng());
    progress.push(pOk('Rendered preview', `${png.length} bytes @ ${scale}×`));
    const notes = missing.length ? [`Fonts not bundled for raster (fell back; render correctly in the editor): ${missing.join(', ')}`] : [];
    const context = buildContext(op, `Preview of "${spec.meta.name}"`);
    const _attachments = [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }];
    return okResult(op, { status: 'ok', bytes: png.length, scale, ...(notes.length ? { notes } : {}), progress, context, _attachments });
  } catch (err) {
    return errResult(op, `Preview render failed: ${(err as Error).message}`, 'Try export_design format="svg" to verify the design renders.', progress);
  }
}

// ── align_layers ────────────────────────────────────────────
// Auto-align / distribute / snap-to-grid a set of layers (the fix for the
// misalignment findings). Mutates positions in place and writes the YAML.

export function alignLayers(args: { design_path: string; layer_ids: string[]; operation: string; project_path?: string; page_id?: string; grid?: number }): ToolResult {
  const op = 'align_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const arr: Layer[] = (args.page_id && spec.pages) ? (spec.pages.find(p => p.id === args.page_id)?.layers ?? []) : (spec.pages ? spec.pages[0]?.layers ?? [] : spec.layers ?? []);
  const getXY = (l: Layer): { x: number; y: number; w: number; h: number } | null => {
    const p = (l as { pos?: unknown }).pos;
    if (Array.isArray(p) && p.length >= 4 && p.every(n => typeof n === 'number')) return { x: p[0] as number, y: p[1] as number, w: p[2] as number, h: p[3] as number };
    if ([l.x, l.y, l.width, (l as { height?: unknown }).height].every(v => typeof v === 'number')) return { x: l.x as number, y: l.y as number, w: l.width as number, h: (l as { height: number }).height };
    return null;
  };
  const setXY = (l: Layer, x: number, y: number): void => {
    const p = (l as { pos?: number[] }).pos;
    if (Array.isArray(p)) { p[0] = Math.round(x); p[1] = Math.round(y); }
    else { (l as { x: number }).x = Math.round(x); (l as { y: number }).y = Math.round(y); }
  };
  const targets = args.layer_ids.map(id => arr.find(l => l.id === id)).filter((l): l is Layer => !!l);
  const boxed = targets.map(l => ({ l, b: getXY(l) })).filter((t): t is { l: Layer; b: { x: number; y: number; w: number; h: number } } => !!t.b);
  if (boxed.length < 1) return errResult(op, 'No positioned target layers found.', 'Pass layer_ids that exist on the page and have numeric positions.', progress);

  const o = args.operation;
  const grid = typeof args.grid === 'number' && args.grid > 0 ? args.grid : 8;
  const minX = Math.min(...boxed.map(t => t.b.x)), maxR = Math.max(...boxed.map(t => t.b.x + t.b.w));
  const minY = Math.min(...boxed.map(t => t.b.y)), maxB = Math.max(...boxed.map(t => t.b.y + t.b.h));
  for (const { l, b } of boxed) {
    if (o === 'left') setXY(l, minX, b.y);
    else if (o === 'right') setXY(l, maxR - b.w, b.y);
    else if (o === 'top') setXY(l, b.x, minY);
    else if (o === 'bottom') setXY(l, b.x, maxB - b.h);
    else if (o === 'center_h') setXY(l, (minX + maxR) / 2 - b.w / 2, b.y);
    else if (o === 'center_v') setXY(l, b.x, (minY + maxB) / 2 - b.h / 2);
    else if (o === 'snap_grid') setXY(l, Math.round(b.x / grid) * grid, Math.round(b.y / grid) * grid);
  }
  if ((o === 'distribute_h' || o === 'distribute_v') && boxed.length >= 3) {
    const horiz = o === 'distribute_h';
    const sorted = [...boxed].sort((a, c) => horiz ? a.b.x - c.b.x : a.b.y - c.b.y);
    const first = sorted[0].b, last = sorted[sorted.length - 1].b;
    const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
    const totalSize = sorted.reduce((s, t) => s + (horiz ? t.b.w : t.b.h), 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = horiz ? first.x : first.y;
    for (const t of sorted) { if (horiz) { setXY(t.l, cursor, t.b.y); cursor += t.b.w + gap; } else { setXY(t.l, t.b.x, cursor); cursor += t.b.h + gap; } }
  }

  const backup = snapshot(dPath);
  writeYAML(dPath, spec);
  progress.push(pOk(`Aligned ${boxed.length} layer(s)`, o));
  const context = buildContext(op, `Aligned ${boxed.length} layer(s) (${o}) in "${spec.meta.name}"`);
  const link = buildEditorLink(dPath);
  return okResult(op, { status: 'ok', operation: o, aligned: boxed.map(t => t.l.id), backup, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, _attachments: [link.attachment] });
}

export function batchCreate(args: { project_path: string; template_id: string; slots_array: Record<string, unknown>[] }): ToolResult {
  const op = 'batch_create';
  const progress: ProgressItem[] = [];
  const created: { design_id: string; path: string }[] = [];

  for (let i = 0; i < args.slots_array.length; i++) {
    const slots = args.slots_array[i];
    const name = (slots['name'] as string | undefined) ?? `${args.template_id}-${i + 1}`;
    const r = createDesign({ project_path: args.project_path, name, type: 'poster' });
    if (!r.success) return errResult(op, `Failed at design ${i + 1}: ${r.error ?? ''}`, r.hint ?? '', progress);

    const designPath = r['path'] as string;
    const selectors = Object.entries(slots).filter(([k]) => k !== 'name').map(([k, v]) => ({ path: k, value: v }));
    if (selectors.length > 0) {
      const pr = patchDesign({ design_path: designPath, selectors });
      if (!pr.success) return errResult(op, `Patch failed at design ${i + 1}: ${pr.error ?? ''}`, pr.hint ?? '', progress);
    }
    created.push({ design_id: r['design_id'] as string, path: designPath });
    progress.push(pOk(`Created design ${i + 1}/${args.slots_array.length}`, name));
  }

  const context = buildContext(op, `Batch created ${created.length} design(s)`,
    created.map(c => ({ type: 'design', path: c.path, role: 'created' })));
  const handover = buildHandover('EXPORT', { project_path: args.project_path });
  return okResult(op, { created, count: created.length, progress, context, handover });
}

export function saveAsComponent(args: { design_path: string; layer_ids: string[]; component_name: string; project_path: string }): ToolResult {
  const op = 'save_as_component';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  const extracted = (spec.layers ?? []).filter(l => args.layer_ids.includes(l.id));
  if (extracted.length === 0) return errResult(op, `No matching layers for IDs: ${args.layer_ids.join(', ')}`, 'Use inspect_design to get layer IDs.', progress);

  const componentId = args.component_name.toLowerCase().replace(/\s+/g, '-');
  const componentPath = path.join(args.project_path, `components/${componentId}.component.yaml`);
  writeYAML(componentPath, { _protocol: 'component/v1', name: args.component_name, id: componentId, version: '1.0.0', props: {}, layers: extracted });
  progress.push(pOk(`Wrote component "${args.component_name}"`, path.basename(componentPath)));

  const indexPath = path.join(args.project_path, 'components/index.yaml');
  const index = fs.existsSync(indexPath) ? readYAML<{ components: unknown[] }>(indexPath) : { components: [] };
  index.components = index.components ?? [];
  index.components.push({ id: componentId, path: `components/${componentId}.component.yaml`, name: args.component_name });
  writeYAML(indexPath, index);

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const firstLayer = extracted[0];
  const instance = { id: `${componentId}-instance`, type: 'component', z: firstLayer.z, x: firstLayer.x ?? 0, y: firstLayer.y ?? 0, width: firstLayer.width ?? 0, height: firstLayer.height ?? 0, ref: componentId, slots: {} } as unknown as Layer;
  spec.layers = [...(spec.layers ?? []).filter(l => !args.layer_ids.includes(l.id)), instance].sort((a, b) => a.z - b.z);
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Replaced ${extracted.length} layer(s) with component instance`));

  const context = buildContext(op, `Extracted ${extracted.length} layer(s) into component "${args.component_name}"`, [
    { type: 'component', path: componentPath, role: 'created' },
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, project_path: args.project_path });
  return okResult(op, { component_id: componentId, component_path: componentPath, layers_extracted: extracted.length, instance_id: instance.id, progress, context, handover }, bak);
}

export function exportTemplate(args: { design_path: string; output_path?: string; project_path?: string }): ToolResult {
  const op = 'export_template';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const template = exportAsTemplate(spec);
  const outPath = args.output_path ?? dPath.replace(/\.design\.yaml$/, '.template.yaml');
  writeYAML(outPath, template);
  progress.push(pOk(`Wrote template (${template.slots.length} slot(s))`, path.basename(outPath)));

  const slots = template.slots.map(s => ({ id: s.id, path: s.path, type: s.type, hint: s.hint }));
  const next_action: NextAction = { tool: 'inject_template', params: { template_path: outPath, slots: Object.fromEntries(slots.map(s => [s.id, ''])) }, remaining: 1, hint: 'Fill slot values then call inject_template.' };
  const context = buildContext(op, `Exported template with ${slots.length} slot(s)`, [
    { type: 'template', path: outPath, role: 'created' },
  ]);
  const handover = buildHandover('EXPORT', { template_path: outPath });
  return okResult(op, { template_path: outPath, template_file: path.basename(outPath), slot_count: slots.length, slots, next_action, progress, context, handover });
}

export function injectTemplate(args: { template_path: string; slots: Record<string, unknown>; output_path?: string }): ToolResult {
  const op = 'inject_template';
  const progress: ProgressItem[] = [];
  const tPath = resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);
  progress.push(pOk('Loaded template', path.basename(tPath)));

  const design = injectIntoTemplate(template, args.slots);
  design.meta.modified = new Date().toISOString().split('T')[0];
  const outPath = args.output_path ?? tPath.replace(/\.template\.yaml$/, `.${Date.now().toString(36)}.design.yaml`);
  writeYAML(outPath, design);
  progress.push(pOk(`Injected ${Object.keys(args.slots).length} slot(s)`, path.basename(outPath)));

  const next_action: NextAction = { tool: 'export_design', params: { design_path: outPath, format: 'svg' }, remaining: 1, hint: 'Export with export_design or open in editor.' };
  const context = buildContext(op, `Injected ${Object.keys(args.slots).length} slot(s) → ${path.basename(outPath)}`, [
    { type: 'design', path: outPath, role: 'created' },
  ]);
  const handover = buildHandover('EXPORT', { design_path: outPath });
  return okResult(op, { design_path: outPath, design_file: path.basename(outPath), slots_injected: Object.keys(args.slots).length, next_action, progress, context, handover });
}

export function listTemplateSlots(args: { template_path: string }): ToolResult {
  const op = 'list_template_slots';
  const progress: ProgressItem[] = [];
  const tPath = resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);

  const slots = listSlots(template);
  progress.push(pOk(`Found ${slots.length} slot(s)`, path.basename(tPath)));
  const context = buildContext(op, `Listed ${slots.length} slot(s) in template`);
  const handover = buildHandover('EXPORT', { template_path: tPath });
  return okResult(op, { slots, count: slots.length, progress, context, handover });
}

// ── Presentation MCP tools ───────────────────────────────────
