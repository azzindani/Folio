// Folio MCP engine — template tools (export/inject/list slots + built-in
// catalog browse). Split from engine-export-tools.ts to keep files ≤700 lines.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec } from '../schema/types';
import type { ToolResult, ProgressItem, NextAction } from './types';
import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';
import { resolveDesignPath, readYAML, writeYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './engine/utils';
import { resolveBuiltinTemplate, builtinInjectOutputDir, listBuiltinTemplates } from './engine/builtin-templates';

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
  // A built-in catalog id ("tmpl-…") / filename reads from the read-only asset
  // dir; everything else is a user path through the projects sandbox.
  const builtin = resolveBuiltinTemplate(args.template_path);
  const tPath = builtin ?? resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, builtin ? 'Built-in template asset missing.' : 'Check the template_path value — or call list_templates to find a built-in id.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);
  progress.push(pOk('Loaded template', path.basename(tPath)));

  const design = injectIntoTemplate(template, args.slots);
  design.meta.modified = new Date().toISOString().split('T')[0];
  // A built-in source is read-only, so a design can't be written beside it —
  // default its output into the projects dir (sandbox-allowed) instead.
  const defaultOut = builtin
    ? path.join(builtinInjectOutputDir(), `${path.basename(tPath).replace(/\.template\.yaml$/, '')}-${Date.now().toString(36)}.design.yaml`)
    : tPath.replace(/\.template\.yaml$/, `.${Date.now().toString(36)}.design.yaml`);
  const outPath = args.output_path ?? defaultOut;
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
  const builtin = resolveBuiltinTemplate(args.template_path);
  const tPath = builtin ?? resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, builtin ? 'Built-in template asset missing.' : 'Check the template_path value — or call list_templates to find a built-in id.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);

  const slots = listSlots(template);
  progress.push(pOk(`Found ${slots.length} slot(s)`, path.basename(tPath)));
  const next_action: NextAction = { tool: 'inject_template', params: { template_path: args.template_path, slots: Object.fromEntries(slots.map(s => [s.id, ''])) }, remaining: 1, hint: 'Fill slot values then call inject_template with the same template_path.' };
  const context = buildContext(op, `Listed ${slots.length} slot(s) in template`);
  const handover = buildHandover('EXPORT', { template_path: tPath });
  return okResult(op, { slots, count: slots.length, next_action, progress, context, handover });
}

/**
 * Discover built-in catalog templates (the 432 browsed in the editor Catalog)
 * so a model can pick one to inject — the MCP counterpart to the editor's
 * Catalog browser. Returns slim metadata; feed an id straight to
 * list_template_slots / inject_template.
 */
export function listTemplates(args: { search?: string; tag?: string; limit?: number } = {}): ToolResult {
  const op = 'list_templates';
  const progress: ProgressItem[] = [];
  const { templates, count, total } = listBuiltinTemplates(args);
  if (total === 0 && count === 0) {
    progress.push(pInfo('No built-in templates found', 'The catalog asset dir/index was not located on the server.'));
  } else {
    progress.push(pOk(`Matched ${total} template(s)`, count < total ? `showing ${count}` : undefined));
  }
  const next_action: NextAction | undefined = templates[0]
    ? { tool: 'list_template_slots', params: { template_path: templates[0].id }, remaining: 1, hint: 'Inspect a template’s slots, then inject_template with the same id.' }
    : undefined;
  const context = buildContext(op, `Listed ${count} of ${total} built-in template(s)`);
  const handover = buildHandover('EXPORT', {});
  return okResult(op, { templates, count, total, next_action, progress, context, handover });
}
