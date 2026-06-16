// Folio MCP engine — presentation + report tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Page } from '../schema/types';
import type { ToolResult } from './types';

import type { ProgressItem } from './types';

import { validateReport, type ReportDiagnostic } from '../report/report-validator';
import { computeGroupAgg, type GroupAggOp } from '../report/aggregator';

import { resolveDesignPath, readYAML, writeYAML, generateId, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';

import { buildEditorLink, buildReportViewLink } from './engine/editor-link';

import { assembleReportHTML } from '../export/html-assembler';
import { assemblePresentationHTML } from '../export/presentation-assembler';
import type { LoadedDataset } from '../report/data-loader';

export function createPresentation(args: {
  project_path: string;
  name: string;
  pages: { id?: string; label: string; notes?: string }[];
  width?: number;
  height?: number;
  transition?: string;
  auto_advance?: number;
  theme?: 'dark' | 'light';
}): ToolResult {
  const op = 'create_presentation';
  const progress: ProgressItem[] = [];
  const pDir = path.resolve(args.project_path);
  if (!fs.existsSync(pDir)) return errResult(op, `Project not found: ${pDir}`, 'Check project_path.');

  const id = generateId();
  const slug = args.name.toLowerCase().replace(/\s+/g, '-');
  const dPath = path.join(pDir, 'designs', `${slug}.design.yaml`);
  fs.mkdirSync(path.dirname(dPath), { recursive: true });

  const usedIds = new Set<string>();
  const pages = args.pages.map((p, i) => {
    let id = p.id ?? `slide_${i + 1}`;
    for (let n = 2; usedIds.has(id); n++) id = `${p.id ?? `slide_${i + 1}`}-${n}`;
    usedIds.add(id);
    return {
      id,
      label: p.label,
      notes: p.notes,
      layers: [] as unknown[],
      transition: args.transition ? { type: args.transition, duration: 400 } : undefined,
      auto_advance: args.auto_advance,
    };
  });

  const spec = {
    _protocol: 'design/v1',
    _mode: 'in_progress',
    meta: { id, name: args.name, type: 'presentation', created: new Date().toISOString(), modified: new Date().toISOString() },
    document: { width: args.width ?? 1920, height: args.height ?? 1080, unit: 'px', dpi: 96 },
    pages,
    presentation: {
      auto_advance: args.auto_advance ?? 0,
      show_controls: true,
      show_progress: true,
      keyboard: true,
      touch: true,
      aspect_ratio: '16:9',
    },
  };

  writeYAML(dPath, spec);
  progress.push(pOk('Presentation design created', path.basename(dPath)));
  const context = buildContext(op, `Presentation "${args.name}" scaffolded (${pages.length} slides)`, [
    { type: 'design', path: dPath, role: 'presentation' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { design_id: id, design_path: dPath, slide_count: pages.length, progress, context, handover });
}

export function exportPresentation(args: {
  design_path: string;
  output_path?: string;
  theme?: 'light' | 'dark';
  auto_advance?: number;
  project_path?: string;
}): ToolResult {
  const op = 'export_presentation';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<import('../schema/types').DesignSpec>(dPath);
  if (!['presentation', 'carousel', 'motion'].includes(spec.meta.type)) {
    return errResult(op, `Design type "${spec.meta.type}" not supported for presentation export`, 'Use a presentation, carousel, or motion design.', progress);
  }

  const outPath = args.output_path ?? dPath.replace('.design.yaml', '.presentation.html');

  // Load formula context if available (applied at runtime in browser via JS runtime)
  const formulaCtxPath = dPath.replace('.design.yaml', '.formula.json');
  if (fs.existsSync(formulaCtxPath)) {
    try { JSON.parse(fs.readFileSync(formulaCtxPath, 'utf-8')); } catch { /* ignore */ }
  }

  progress.push(pInfo('Assembling presentation HTML'));
  try {
    const html = assemblePresentationHTML(spec, { theme: args.theme ?? 'dark', auto_advance: args.auto_advance });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    progress.push(pOk('Presentation HTML written', path.basename(outPath)));
    const context = buildContext(op, `Presentation exported: ${path.basename(outPath)}`, [
      { type: 'html', path: outPath, role: 'presentation-output' },
    ]);
    const handover = buildHandover('EXPORT', { output_path: outPath });
    return okResult(op, { output_path: outPath, output_file: path.basename(outPath), bytes: html.length, slide_count: (spec.pages ?? []).length, progress, context, handover });
  } catch (err) {
    return errResult(op, `Presentation assembly failed: ${(err as Error).message}`, 'Ensure design has pages.', progress);
  }
}

// ── Report MCP tools ─────────────────────────────────────────

export function generateReport(args: {
  project_path: string;
  name: string;
  layout?: 'paged' | 'scroll' | 'tabs' | 'sidebar' | 'flow';
  nav_type?: 'sidebar' | 'topbar' | 'tabs' | 'dots';
  pages: { id?: string; label: string }[];
  width?: number;
  height?: number;
  data_sources?: { id: string; type: 'inline' | 'json' | 'csv'; path?: string; rows?: Record<string, unknown>[] }[];
  // Flow-report editorial options (used when layout === 'flow'):
  max_width?: number;
  accent?: string;
  font_heading?: string;
  font_body?: string;
}): ToolResult {
  const op = 'generate_report';
  const progress: ProgressItem[] = [];
  const pDir = path.resolve(args.project_path);
  if (!fs.existsSync(pDir)) return errResult(op, `Project not found: ${pDir}`, 'Check project_path.');

  const id = generateId();
  const dPath = path.join(pDir, 'designs', `${args.name.toLowerCase().replace(/\s+/g, '-')}.design.yaml`);
  fs.mkdirSync(path.dirname(dPath), { recursive: true });

  const pages = args.pages.map((p, i) => ({
    id: p.id ?? `page_${i + 1}`,
    label: p.label,
    layers: [] as unknown[],
  }));

  const spec: DesignSpec = {
    _protocol: 'design/v1',
    _mode: 'in_progress',
    meta: { id, name: args.name, type: 'report', created: new Date().toISOString(), modified: new Date().toISOString() },
    document: { width: args.width ?? 1080, height: args.height ?? 1080, unit: 'px' },
    pages: pages as Page[],
    report: {
      layout: args.layout ?? 'paged',
      // Flow reports are single scrolling documents — no chrome unless explicitly asked.
      navigation: args.nav_type
        ? { type: args.nav_type }
        : args.layout === 'flow' || args.layout === 'scroll'
        ? undefined
        : { type: 'sidebar' },
      data: args.data_sources ? { sources: args.data_sources } : undefined,
      ...(args.layout === 'flow' ? { flow: true } : {}),
      ...(args.max_width != null ? { max_width: args.max_width } : {}),
      ...(args.accent ? { accent: args.accent } : {}),
      ...(args.font_heading ? { font_heading: args.font_heading } : {}),
      ...(args.font_body ? { font_body: args.font_body } : {}),
    },
  } as unknown as DesignSpec;

  writeYAML(dPath, spec);
  progress.push(pOk(`Report design created`, path.basename(dPath)));
  const context = buildContext(op, `Report "${args.name}" scaffolded (${pages.length} pages)`, [
    { type: 'design', path: dPath, role: 'report' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { design_id: id, design_path: dPath, page_count: pages.length, progress, context, handover });
}

export function bindData(args: {
  design_path: string;
  datasets: { id: string; rows: Record<string, unknown>[] }[];
  project_path?: string;
}): ToolResult {
  const op = 'bind_data';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  const dataSpec = spec.report?.data ?? { sources: [] };
  const existingIds = new Set((dataSpec.sources ?? []).map((s: { id: string }) => s.id));

  for (const ds of args.datasets) {
    if (!existingIds.has(ds.id)) {
      (dataSpec.sources ?? (dataSpec.sources = [])).push({
        id: ds.id,
        type: 'inline',
        rows: ds.rows,
      });
    } else {
      const src = (dataSpec.sources ?? []).find((s: { id: string }) => s.id === ds.id);
      if (src) src.rows = ds.rows;
    }
    progress.push(pOk(`Bound dataset "${ds.id}"`, `${ds.rows.length} rows`));
  }

  if (!spec.report) spec.report = { layout: 'paged' };
  (spec.report as unknown as Record<string, unknown>)['data'] = dataSpec;
  writeYAML(dPath, spec);

  const context = buildContext(op, `Bound ${args.datasets.length} dataset(s) to report`, [
    { type: 'design', path: dPath, role: 'report' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { bound: args.datasets.map(d => ({ id: d.id, rows: d.rows.length })), progress, context, handover });
}

export function exportReport(args: {
  design_path: string;
  output_path?: string;
  theme?: 'light' | 'dark';
  project_path?: string;
}): ToolResult {
  const op = 'export_report';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  if (spec.meta.type !== 'report') {
    return errResult(op, 'Design is not type "report"', 'Use export_design for non-report types.', progress);
  }

  const outPath = args.output_path ?? dPath.replace('.design.yaml', '.report.html');
  progress.push(pInfo('Assembling report HTML'));

  try {
    
    // Resolve datasets: inline/query → baked rows; transform → aggregate its
    // upstream synchronously so group-by charts populate in the export (not just
    // the editor preview).
    const datasets = new Map<string, LoadedDataset>();
    const allSources = spec.report?.data?.sources ?? [];
    for (const src of allSources) {
      if (src.type !== 'transform' && Array.isArray(src.rows)) datasets.set(src.id, { id: src.id, rows: src.rows });
    }
    for (const src of allSources) {
      if (src.type !== 'transform') continue;
      const fromRows = datasets.get(src.from ?? '')?.rows ?? [];
      const rows = src.group_by ? computeGroupAgg(fromRows, src.group_by, (src.agg ?? 'sum') as GroupAggOp, src.value) : (src.rows ?? []);
      datasets.set(src.id, { id: src.id, rows });
    }

    // Cross-reference validation — surfaced as diagnostics, never blocks export.
    const diagnostics = validateReport(spec);
    for (const issue of diagnostics) {
      progress.push(pWarn(`[${issue.code}] ${issue.message}`, issue.fix));
    }

    const html: string = assembleReportHTML(spec, datasets, { theme: args.theme ?? 'dark' });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    progress.push(pOk('Report HTML written', path.basename(outPath)));

    // The deliverable for an interactive report is the RENDERED HTML — serve it
    // directly so the user sees the final result in a browser (the editor canvas
    // is an authoring view, not a faithful preview of the exported output).
    const view = buildReportViewLink(outPath);
    progress.push(pOk('View rendered report', view.view_url));
    // Editor link stays available as a secondary "edit the source" affordance.
    const edit = buildEditorLink(dPath);

    const errors = diagnostics.filter(x => x.severity === 'error').length;
    const summary = diagnostics.length
      ? `Report exported with ${errors} error(s) + ${diagnostics.length - errors} warning(s) — see diagnostics`
      : `Report exported — open ${view.view_url}`;
    const context = buildContext(op, summary, [
      { type: 'html', path: outPath, role: 'report-output' },
    ]);
    const handover = buildHandover('EXPORT', { output_path: outPath, view_url: view.view_url });
    return okResult(op, {
      view_url: view.view_url,
      output_path: outPath,
      output_file: path.basename(outPath),
      bytes: html.length,
      edit_url: edit.open_url,
      diagnostics,
      progress,
      context,
      handover,
      _attachments: [view.attachment, edit.attachment],
    });
  } catch (err) {
    return errResult(op, `HTML assembly failed: ${(err as Error).message}`, 'Ensure design has pages.', progress);
  }
}

// Standalone cross-reference linter for an interactive report — call anytime to
// check charts/tables/filters/buttons/transforms resolve before exporting.

export function validateReportDesign(args: {
  design_path: string;
  project_path?: string;
}): ToolResult {
  const op = 'validate_report';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  if (spec.meta.type !== 'report') return errResult(op, 'Design is not type "report"', 'validate_report only applies to reports.');

  const diagnostics: ReportDiagnostic[] = validateReport(spec);
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const progress: ProgressItem[] = diagnostics.length
    ? diagnostics.map(d => (d.severity === 'error' ? pWarn(`[${d.code}] ${d.message}`, d.fix) : pInfo('warning', `[${d.code}] ${d.message}`)))
    : [pOk('No issues', 'All datasets, fields, and action targets resolve')];
  const context = buildContext(op, diagnostics.length ? `${errors} error(s), ${warnings} warning(s)` : 'Report is valid');
  return okResult(op, { ok: errors === 0, errors, warnings, diagnostics, progress, context });
}

// ── Formula tools ─────────────────────────────────────────────
