// Folio MCP engine — export/diagnose/render/align/template/component tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page, ComponentSpec } from '../schema/types';
import type { ToolResult } from './types';

import { Resvg } from '@resvg/resvg-js';
import { jsPDF } from 'jspdf';
import { FAVICON_LINK } from '../utils/favicon';
import type { ProgressItem } from './types';
import { validateDesignSpec } from '../schema/validator';

import { resolveDesignPath, readYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './engine/utils';

import { resvgFontOption, unbundledFonts } from './engine/fonts';
import { looksLikeMark, auditMark, type MarkAudit } from './engine/mark-audit';

import { type Finding } from './engine/diagnose';
import { collectFindings, rankForDisplay } from './engine/diagnose-collect';
import { echoFinding } from './design-history';
import { buildEditorLink } from './engine/editor-link';
import { willOverwrite, collisionReport } from './engine/export-collisions';
import { readBaseline, writeBaseline, diffPages } from './engine/preview-diff';
import { buildManifest, embedManifest, sourceHash } from './engine/export-manifest';
import { exportKey, findReusable, recordExport } from './engine/export-receipt';

import { renderToSVGString, renderToSVGElement, serializeSVGElement } from './engine/svg-export';
import { resolveImageAssets } from './engine/asset-resolve';
import { addVectorPdfPage, type PdfDoc } from './engine/pdf-build';
import { buildPptx, type PptxSlide } from '../export/pptx-export';
import { extractPptxTexts } from '../export/pptx-text-extract';

/**
 * The design's own resolution, for px → PostScript-point conversion in the PDF.
 *
 * The schema has carried `document.dpi` all along, but the PDF exporter used to
 * hard-code 96 — so a poster authored for PRINT came out physically wrong: an A2
 * sheet drawn at 2480×3508 (150 dpi) produced a 656×928 mm page instead of
 * 420×594. Correct proportions, 1.56× too big, and the print shop has to rescale
 * it. Honoring the field puts that same canvas on an exact A2 page.
 *
 * Falls back to 96 (the CSS reference dpi) when absent or nonsense, so every
 * existing screen design exports byte-identically.
 */
export function documentDpi(spec: { document?: { dpi?: unknown } }): number {
  const dpi = Number(spec.document?.dpi);
  return Number.isFinite(dpi) && dpi > 0 ? dpi : 96;
}

import { assembleReportHTML } from '../export/html-assembler';

import type { LoadedDataset } from '../report/data-loader';

// Image/asset resolution lives in engine/asset-resolve.ts — ONE resolver for
// render_preview and export_design (embed file-backed srcs, placeholder +
// note everything unrenderable; no silent blanks).

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

export function exportDesign(args: { design_path: string; format: string; output_path?: string; scale?: number; project_path?: string; force?: boolean }): ToolResult {
  // Project dir for project-scoped fonts (WP-1.6) — resolvable even when only
  // design_path was passed (designs live at <project>/designs/<file>).
  const op = 'export_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  const projDir = args.project_path ?? path.dirname(path.dirname(dPath));
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const criticals = validateDesignSpec(spec).filter(e => e.severity === 'error');
  if (criticals.length > 0) return errResult(op, `Validation errors: ${criticals.map(e => e.message).join('; ')}`, 'Fix errors then retry.', progress);

  const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
  for (const n of assetNotes) progress.push(pInfo('Image note', n));

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
  // Read the disk BEFORE writing: after the write every target exists, so the
  // question "did this replace something?" can only be asked now. `collision`
  // is spread into each format's reply — see engine/export-collisions.ts for
  // why orphaned `-pN` files are reported rather than deleted.
  const firstTarget = multiPage && args.format === 'svg' ? outPath.replace(/\.svg$/i, '-p1.svg') : outPath;
  const existedBefore = willOverwrite(firstTarget);
  const collision = (): ReturnType<typeof collisionReport> =>
    collisionReport(outPath, multiPage && args.format === 'svg' ? pages.length : 0, existedBefore);
  // Idempotency — see engine/export-receipt.ts. Scoped to SINGLE-FILE outputs:
  // a multi-page SVG or PNG writes N files, and proving all N intact is more
  // machinery than the retry it would save. `scale` is folded in raw because each branch
  // resolves its own default from the same argument.
  const singleFile = !(multiPage && (args.format === 'svg' || args.format === 'png'));
  const key = exportKey(sourceHash(dPath), args.format, Number(args.scale) || 0, outPath);
  if (singleFile && !args.force) {
    const done = findReusable(dPath, key);
    if (done) {
      progress.push(pOk('Already exported', `${path.basename(done.output)} (${done.bytes} bytes) — same design, format, scale, destination and renderer`));
      return okResult(op, {
        format: args.format, output_file: path.basename(done.output), output_path: done.output,
        status: 'ok', bytes: done.bytes, reused: true, exported_at: done.at,
        note: 'Nothing was re-rendered: neither this design NOR the rendering engine has changed since it was last exported to this path at this scale, so the file on disk is already the answer. Pass force:true to render it again.',
        progress, context: buildContext(op, `Reused existing ${args.format.toUpperCase()} for "${spec.meta.name}"`, [{ type: args.format, path: done.output, role: 'output' }]),
        handover: buildHandover('EXPORT', { design_path: dPath }),
      });
    }
  }
  // Measure the FILE, never a count the caller passes in. Recording doc.length
  // (UTF-16 code units) against a UTF-8 file meant an 8.8 MB export was logged
  // 27 bytes short, so the receipt's own size check rejected it on every retry
  // and the reuse path never once fired. The number that matters is the one on
  // disk, so read it from disk.
  const finish = (out: string): number => {
    let size = 0;
    try { size = fs.statSync(out).size; } catch { return 0; }
    if (singleFile) recordExport(dPath, key, out, size);
    return size;
  };

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
        return okResult(op, { ...collision(), format: 'svg', pages: outPaths.length, output_files: outPaths.map(p => path.basename(p)), output_paths: outPaths, output_path: outPaths[0], status: 'ok', bytes: totalBytes, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
      }
      const svgStr = renderToSVGString(spec, undefined, undefined, componentRegistry);
      fs.writeFileSync(outPath, svgStr, 'utf-8');
      const svgBytes = finish(outPath);
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
      return okResult(op, { ...collision(), format: 'svg', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: svgBytes, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
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
        : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${spec.meta.name}</title>${FAVICON_LINK}<style>body{margin:0}.folio-page{display:block;margin:0 auto}.folio-page+.folio-page{margin-top:16px}</style></head><body>${body}</body></html>`;
      // Provenance rides in the file itself — see engine/export-manifest.ts.
      const manifest = buildManifest(spec, dPath);
      const doc = embedManifest(html, manifest);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, doc, 'utf-8');
      const htmlBytes = finish(outPath);
      progress.push(pOk('HTML written', path.basename(outPath)));
      const context = buildContext(op, `HTML exported for "${spec.meta.name}"`, [{ type: 'html', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { ...collision(), format: 'html', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: htmlBytes, embedded_specs: manifest.specs.length, source_hash: manifest.source.hash, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, handover, _attachments: [link.attachment] });
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
      const dpi = documentDpi(spec);
      const toPt = (px: number): number => (px * 72) / dpi;
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
      // Per-PAGE isolation: one slide that fails to render used to throw out of
      // the whole forEach, so an 8-slide deck returned an error and NO file —
      // the model lost seven good pages to one bad one. Now a failed page
      // becomes a blank sheet (page numbering stays true to the design) and the
      // response names it, so the fix is one patch_design away instead of a
      // full re-export.
      const failedPages: { page: number; error: string }[] = [];
      sheetSpecs.forEach((s, i) => {
        const W = spec.document.width, H = spec.document.height;
        try {
          // Render to a LIVE element (not a string) so the vector-PDF builder can
          // walk <text> nodes directly — re-parsing the string would throw on
          // markdown foreignObject HTML (not valid XML).
          const el = renderToSVGElement(s.spec, undefined, undefined, componentRegistry);
          const w = dim(el, 'width', W);
          const h = dim(el, 'height', H);
          for (const f of unbundledFonts(serializeSVGElement(el), projDir)) missingFonts.add(f);
          const orient = w >= h ? 'landscape' : 'portrait';
          if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [toPt(w), toPt(h)], compress: true });
          else pdf.addPage([toPt(w), toPt(h)], orient);
          vectorRuns += addVectorPdfPage(pdf as unknown as PdfDoc, { svg: el, width: w, height: h }, scale, registered, projDir);
          for (const r of collectHrefRects(s.layers)) {
            pdf.link(toPt(r.x), toPt(r.y), toPt(r.w), toPt(r.h), { url: r.href });
          }
        } catch (pageErr) {
          failedPages.push({ page: i + 1, error: (pageErr as Error).message });
          const orient = W >= H ? 'landscape' : 'portrait';
          if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [toPt(W), toPt(H)], compress: true });
          else pdf.addPage([toPt(W), toPt(H)], orient);
        }
      });
      if (failedPages.length === sheetSpecs.length) {
        return errResult(op, `PDF render failed on every page — first error: ${failedPages[0].error}`, 'Try format="png" or "svg" to isolate; PDF = resvg raster + jsPDF vector text.', progress);
      }
      const doc = pdf as unknown as jsPDF;

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const pdfBuf = Buffer.from(doc.output('arraybuffer'));
      fs.writeFileSync(outPath, pdfBuf);
      finish(outPath);
      progress.push(pOk('PDF written', `${path.basename(outPath)} (${pdfBuf.length} bytes @ ${scale}× · ${vectorRuns} vector text run(s))`));
      const linkCount = sheetSpecs.reduce((n, s) => n + collectHrefRects(s.layers).length, 0);
      const notes = [
        `Vector PDF — ${vectorRuns} text run(s) embedded as selectable, zoom-crisp glyphs over a ${scale}× raster (backgrounds/gradients/effects). Copy-paste works; text stays sharp at any zoom.`,
        ...(missingFonts.size ? [`Some text stayed in the raster (font not bundled, so it can't be embedded as vector): ${[...missingFonts].join(', ')}. Use a bundled family (Inter, Space Grotesk, Playfair Display, IBM Plex Mono…) for fully-vector text.`] : []),
        ...(failedPages.length ? [`${failedPages.length} of ${sheetSpecs.length} page(s) failed to render and are BLANK in this PDF: ${failedPages.map(f => `p${f.page} (${f.error})`).join('; ')}. The rest exported normally — fix those pages and re-export.`] : []),
      ];
      const context = buildContext(op, `PDF exported for "${spec.meta.name}"`, [{ type: 'pdf', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { ...collision(), format: 'pdf', output_file: path.basename(outPath), output_path: outPath, status: failedPages.length ? 'partial' : 'ok', bytes: pdfBuf.length, scale, pages: multiPage ? pages.length : 1, ...(failedPages.length ? { failed_pages: failedPages } : {}), links: linkCount, vector_runs: vectorRuns, notes, progress, context, handover });
    } catch (err) {
      return errResult(op, `PDF render failed: ${(err as Error).message}`, 'Try format="png" or "svg" to isolate; PDF = resvg raster + jsPDF vector text.', progress);
    }
  }
  if (args.format === 'pptx') {
    try {
      // One full-bleed image slide per page (resvg raster, same path as PNG/PDF),
      // packed into a dependency-free PPTX. Editable container, pixel-faithful slides.
      const scale = typeof args.scale === 'number' && args.scale > 0 ? args.scale : 2;
      const missingFonts = new Set<string>();
      const rasterize = (svgStr: string): Buffer => {
        for (const f of unbundledFonts(svgStr, projDir)) missingFonts.add(f);
        return Buffer.from(new Resvg(svgStr, {
          fitTo: { mode: 'zoom', value: scale },
          background: '#FFFFFF',
          font: resvgFontOption(projDir),
        }).render().asPng());
      };
      const W = spec.document.width, H = spec.document.height;
      // WP-5.1 — promote reproducible text to NATIVE editable/selectable boxes;
      // hide those layers in the background raster so nothing is drawn twice.
      const hideInLayers = (layers: Layer[], ids: Set<string>): Layer[] =>
        layers.map(l => {
          const g = l as { id?: string; type?: string; layers?: Layer[] };
          if (g.type === 'group' && Array.isArray(g.layers)) return { ...l, layers: hideInLayers(g.layers, ids) } as Layer;
          return g.id && ids.has(g.id) ? ({ ...l, visible: false } as Layer) : l;
        });
      const slideFor = (layers: Layer[], renderLayers: (ls: Layer[]) => string): PptxSlide => {
        const { texts, hideIds } = extractPptxTexts(layers);
        const bg = hideIds.size ? hideInLayers(layers, hideIds) : layers;
        return { png: rasterize(renderLayers(bg)), width: W, height: H, texts };
      };
      const renderLs = (ls: Layer[]): string =>
        renderToSVGString({ ...spec, layers: ls, pages: undefined } as DesignSpec, undefined, undefined, componentRegistry);
      const slides: PptxSlide[] = multiPage
        ? pages.map(page => slideFor(page.layers ?? [], renderLs))
        : [slideFor(spec.layers ?? [], renderLs)];
      const totalTexts = slides.reduce((s, sl) => s + (sl.texts?.length ?? 0), 0);
      const pptx = buildPptx(slides, spec.meta.name || 'Folio Deck');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, pptx);
      finish(outPath);
      progress.push(pOk('PPTX written', `${path.basename(outPath)} (${pptx.length} bytes · ${slides.length} slide(s) @ ${scale}× · ${totalTexts} editable text box(es))`));
      const notes = [...assetNotes, ...(missingFonts.size ? [`Fonts not bundled for raster export — slides used a fallback (they render correctly in the editor): ${[...missingFonts].join(', ')}.`] : []),
        `PPTX slides = a pixel-faithful background image + ${totalTexts} NATIVE text box(es) you can select/edit in PowerPoint/Impress (solid-hex text with no rotation/effect is promoted; the rest stays baked in the image).`];
      const context = buildContext(op, `PPTX exported for "${spec.meta.name}" — ${slides.length} slide(s)`, [{ type: 'pptx', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { ...collision(), format: 'pptx', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: pptx.length, slides: slides.length, scale, notes, progress, context, handover });
    } catch (err) {
      return errResult(op, `PPTX render failed: ${(err as Error).message}`, 'Try format="png" or "pdf" to isolate; PPTX = resvg raster slides in an OOXML zip.', progress);
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
        for (const f of unbundledFonts(svgStr, projDir)) missingFonts.add(f);
        return Buffer.from(new Resvg(svgStr, {
          fitTo: { mode: 'zoom', value: scale },
          background: 'rgba(0,0,0,0)',
          font: resvgFontOption(projDir),
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
      finish(outPath);
      progress.push(pOk('PNG written', `${path.basename(outPath)} (${png.length} bytes @ ${scale}×)`));
      const context = buildContext(op, `PNG exported for "${spec.meta.name}"`, [
        { type: 'png', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      const _attachments = [
        { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'resource' as const, resource: { uri: `file://${outPath}`, mimeType: 'image/png', text: path.basename(outPath) } },
      ];
      return okResult(op, { ...collision(), format: 'png', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: png.length, scale, ...((): Record<string, unknown> => { const n = [...assetNotes, ...fontNote()]; return n.length ? { notes: n } : {}; })(), progress, context, handover, _attachments });
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
  if (args.page_id && spec.pages && !spec.pages.some(p => p.id === args.page_id)) {
    return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
  }

  // One composition of the checks, shared with seal_design — see
  // engine/diagnose-collect.ts for why the gate needs the same answer.
  const findings: (Finding & { page?: string })[] =
    collectFindings(spec, dPath, args.project_path, args.page_id);

  // Mark geometry — only for designs shaped like an identity mark. Measuring a
  // nine-page carousel at six raster sizes would cost seconds and say nothing.
  let mark: MarkAudit | undefined;
  if (!args.page_id && looksLikeMark(spec)) {
    try {
      const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
      const svg = renderToSVGString(spec);
      const rendered = new Resvg(svg, { font: resvgFontOption(path.dirname(path.dirname(dPath))) }).render();
      mark = auditMark({
        width: rendered.width,
        height: rendered.height,
        pixels: new Uint8ClampedArray(rendered.pixels),
      });
      for (const note of mark.notes) progress.push(pInfo('Mark', note));
    } catch { /* measurement is best-effort; the rest of the diagnosis still stands */ }
  }

  // Does this design already exist in the project under another name? Always a
  // SUGGESTION: sameness is only a fault when it was not asked for, and the
  // engine cannot know the brief (see design-history.ts).
  const echo = echoFinding(spec, dPath, args.project_path);
  if (echo) findings.push(echo);

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
    // `counts` is the truth; this list is capped to keep the reply small. Say so
    // when it is — reading the array and believing it complete under-counted a
    // 109-error design as 40, which is exactly the mistake to make it impossible.
    //
    // Ranked, not collection order — see rankForDisplay. The cap used to take
    // whichever 40 were gathered first, so late passes were cut wholesale and
    // forty copies of one problem hid every other kind.
    findings: rankForDisplay(findings, 40),
    ...(findings.length > 40 ? { findings_truncated: findings.length - 40 } : {}),
    ...(mark ? { mark } : {}),
    progress, context,
  });
}

// ── render_preview ──────────────────────────────────────────
// Render the design to a PNG and return it INLINE as an image block, so the
// model can actually SEE what it produced (no file written). Closes the
// "MCP is blind" gap — pair with diagnose_design to verify a fix visually.

// A preview is the QA gate, so it gets called ~20× in a real session — at full
// canvas resolution that single tool dominates the cost of the whole job. A
// 960px longest edge is enough to judge layout, hierarchy, overlap and colour
// (what previews are FOR) at roughly a quarter of the image tokens; reading fine
// copy is what `full` and an explicit `scale` are for.
const PREVIEW_MAX_EDGE = 960;
// How many changed pages one changed_only reply will rasterise. A deck where
// everything moved would otherwise hand back 20 images in a single response —
// the exact cost §3.1 is about.
const PREVIEW_DIFF_MAX = 6;

/** Claude bills an image at about (w × h) / 750 tokens — quoted back on every
 *  preview so an agent can budget its verification loop instead of guessing. */
function estImageTokens(w: number, h: number): number {
  return Math.round((w * h) / 750);
}

export function renderPreview(args: { design_path: string; project_path?: string; page_id?: string; scale?: number; max_edge?: number; full?: boolean; changed_only?: boolean }): ToolResult {
  const op = 'render_preview';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const componentRegistry = loadComponentRegistry(args.project_path ?? path.dirname(path.dirname(dPath)));
  // An explicit scale or full:true is the opt-in to full resolution; otherwise
  // fit the longest edge to max_edge so the default preview stays cheap.
  const asked = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  const longest = Math.max(spec.document?.width ?? 0, spec.document?.height ?? 0);
  const maxEdge = typeof args.max_edge === 'number' && args.max_edge > 0 ? Math.min(4096, args.max_edge) : PREVIEW_MAX_EDGE;
  const capped = longest > 0 && !args.full && !(typeof args.scale === 'number' && args.scale > 0);
  const scale = capped ? Math.min(asked, maxEdge / longest) : asked;
  try {
    // Same asset resolution as export_design — preview must show the truth.
    const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
    const rasterise = (svg: string, dir: string): Buffer => Buffer.from(new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(dir),
    }).render().asPng());

    const allPages = spec.pages ?? [];
    if (args.changed_only && allPages.length > 1 && !args.page_id) {
      const projDir = args.project_path ?? path.dirname(path.dirname(dPath));
      // Render every page's SVG — vectors are cheap; the raster is the bill.
      const rendered = allPages.map(p => ({
        id: p.id,
        svg: renderToSVGString({ ...spec, layers: p.layers ?? [], pages: undefined } as DesignSpec, undefined, undefined, componentRegistry),
      }));
      const { diffs, next } = diffPages(readBaseline(dPath), rendered);
      const stored = writeBaseline(dPath, next);
      const show = diffs.filter(d => d.changed || d.first_look);
      const shown = show.slice(0, PREVIEW_DIFF_MAX);
      const _attachments = shown.map(d => ({
        type: 'image' as const,
        data: rasterise(rendered[d.index]?.svg ?? '', projDir).toString('base64'),
        mimeType: 'image/png',
      }));
      const firstLook = diffs.filter(d => d.first_look).map(d => d.id);
      const changed = diffs.filter(d => d.changed).map(d => d.id);
      const unchanged = diffs.filter(d => !d.changed && !d.first_look).map(d => d.id);
      const outW = Math.round((spec.document?.width ?? 0) * scale);
      const outH = Math.round((spec.document?.height ?? 0) * scale);
      progress.push(pOk(`${shown.length} of ${allPages.length} page(s) rendered`,
        `${changed.length} changed · ${firstLook.length} never seen · ${unchanged.length} unchanged and skipped`));
      return okResult(op, {
        status: 'ok', mode: 'changed_only', pages_total: allPages.length,
        pages_changed: changed, pages_first_look: firstLook, pages_unchanged: unchanged,
        rendered: shown.map(d => d.id), scale, pixels: `${outW}×${outH}`,
        est_image_tokens: estImageTokens(outW, outH) * shown.length,
        ...(show.length > shown.length ? { capped: `${show.length} pages needed a look; showing the first ${PREVIEW_DIFF_MAX}. Call again to advance, or pass page_id for a specific one.` } : {}),
        ...(unchanged.length ? { skipped_note: `${unchanged.length} page(s) render byte-identically to the last preview — nothing to see, and nothing charged for them.` } : {}),
        ...(firstLook.length && !changed.length && !unchanged.length ? { baseline_note: 'First changed_only call on this design: there was nothing to compare against, so every page counts as a first look. The next call will skip whatever has not moved.' } : {}),
        ...(stored ? {} : { baseline_warning: 'Could not write the preview baseline, so the next changed_only call will again treat every page as new.' }),
        ...(assetNotes.length ? { notes: assetNotes } : {}),
        progress, context: buildContext(op, `Preview of "${spec.meta.name}" — ${shown.length}/${allPages.length} page(s)`), _attachments,
      });
    }

    const renderSpec = (spec.pages?.length)
      ? ({ ...spec, layers: (args.page_id ? spec.pages.find(p => p.id === args.page_id) : spec.pages[0])?.layers ?? [], pages: undefined } as DesignSpec)
      : spec;
    const svgStr = renderToSVGString(renderSpec, undefined, undefined, componentRegistry);
    const previewProjDir = args.project_path ?? path.dirname(path.dirname(dPath));
    const missing = unbundledFonts(svgStr, previewProjDir);
    const png = Buffer.from(new Resvg(svgStr, {
      fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(previewProjDir),
    }).render().asPng());
    const outW = Math.round((spec.document?.width ?? 0) * scale);
    const outH = Math.round((spec.document?.height ?? 0) * scale);
    const tokens = estImageTokens(outW, outH);
    progress.push(pOk('Rendered preview', `${outW}×${outH}, ${png.length} bytes @ ${scale.toFixed(2)}× (~${tokens} image tokens)`));
    const notes = [
      ...assetNotes,
      ...(missing.length ? [`Fonts not bundled for raster (fell back; render correctly in the editor): ${missing.join(', ')}`] : []),
      ...(capped && scale < 1 ? [`Preview downscaled to ${outW}×${outH} (longest edge ${maxEdge}px, ~${tokens} image tokens) — enough to judge layout, overlap, hierarchy and colour. To read fine copy pass full:true or scale:1, which costs ~${estImageTokens(spec.document.width, spec.document.height)} tokens.`] : []),
    ];
    const context = buildContext(op, `Preview of "${spec.meta.name}"`);
    const _attachments = [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }];
    return okResult(op, { status: 'ok', bytes: png.length, scale, pixels: `${outW}×${outH}`, est_image_tokens: tokens, ...(notes.length ? { notes } : {}), progress, context, _attachments });
  } catch (err) {
    return errResult(op, `Preview render failed: ${(err as Error).message}`, 'Try export_design format="svg" to verify the design renders.', progress);
  }
}



// batch_create and its template/slot helpers live in engine-batch-tools.ts —
// this file was at the 700-line ceiling and they share nothing with export.
// Re-exported here so existing importers keep working (facade, §0.3).
export { batchCreate } from './engine-batch-tools';

// align_layers moved to engine-align-tools.ts for the same reason.
export { alignLayers } from './engine-align-tools';
