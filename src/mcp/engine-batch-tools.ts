// Batch generation — one template × N rows of content.
//
// Split out of engine-export-tools.ts, which had reached the 700-line ceiling.
// This is a self-contained concern (resolve a template, map friendly slot keys
// onto its real slots, write one design per row) and shares nothing with export,
// preview or align beyond the common engine helpers.
import * as fs from 'fs';
import type { DesignSpec } from '../schema/types';
import type { ToolResult, ProgressItem } from './types';
import { exportAsTemplate, injectIntoTemplate } from '../schema/template';
import type { TemplateSpec, TemplateSlot } from '../schema/template';
import { resolveDesignPath, readYAML, writeYAML, errResult, okResult, pOk, buildContext, buildHandover, generateId } from './engine/utils';
import { resolveBuiltinTemplate } from './engine/builtin-templates';

// Friendly slot keys a model naturally sends (title/kicker/…) → substrings of
// the auto-derived slot ids (`<layerId>_text`, e.g. `sections_1_title_text`).
// Lets batch_create fill content without the model knowing the exact slot ids.
const SLOT_KEY_ALIASES: Record<string, string[]> = {
  title: ['title', 'headline', 'head', 'hero'],
  kicker: ['kick', 'eyebrow', 'overline', 'tag', 'label'],
  subtitle: ['sub', 'deck', 'standfirst', 'intro', 'tagline'],
  body: ['body', 'desc', 'paragraph', 'copy'],
  footer: ['footer', 'foot', 'caption', 'credit'],
};

/** Best-effort map a friendly slot key to a real template slot (by exact id/path,
 *  then id-substring, then alias family), skipping slots already claimed. */
function matchSlot(key: string, slots: TemplateSlot[], used: Set<string>): TemplateSlot | null {
  const k = key.toLowerCase();
  const free = (s: TemplateSlot): boolean => !used.has(s.id);
  return slots.find(s => free(s) && (s.id === key || s.path === key))
    ?? slots.find(s => free(s) && s.id.toLowerCase().includes(k))
    ?? (SLOT_KEY_ALIASES[k] ?? []).reduce<TemplateSlot | undefined>(
      (hit, a) => hit ?? slots.find(s => free(s) && s.id.toLowerCase().includes(a)), undefined)
    ?? null;
}

/** Resolve a batch template_id to a TemplateSpec, in precedence order:
 *  1. an explicit project `.template.yaml`,
 *  2. a project design (exported to a template so its dimensions, theme and
 *     layout carry into every variant),
 *  3. a built-in catalog id (the SAME assets `templates {op:inject}` / `{op:slots}`
 *     resolve) — so a catalog id usable for inject also works for batch. */
function resolveBatchTemplate(projectPath: string, templateId: string): TemplateSpec | null {
  const tpl = resolveDesignPath(`templates/${templateId}.template.yaml`, projectPath);
  if (fs.existsSync(tpl)) {
    const t = readYAML<TemplateSpec>(tpl);
    if (t._protocol === 'template/v1') return t;
  }
  const slug = templateId.toLowerCase().replace(/\s+/g, '-');
  for (const id of [templateId, slug]) {
    const dp = resolveDesignPath(`designs/${id}.design.yaml`, projectPath);
    if (fs.existsSync(dp)) return exportAsTemplate(readYAML<DesignSpec>(dp));
  }
  const builtin = resolveBuiltinTemplate(templateId);
  if (builtin && fs.existsSync(builtin)) {
    const t = readYAML<TemplateSpec>(builtin);
    if (t._protocol === 'template/v1') return t;
  }
  return null;
}

/** Register a batch-created design in project.yaml so list_designs (which reads
 *  project.yaml, not the filesystem) shows it. No-op when there's no project.yaml. */
function registerInProject(projectPath: string, designId: string): void {
  const pPath = resolveDesignPath('project.yaml', projectPath);
  if (!fs.existsSync(pPath)) return;
  const project = readYAML<{ designs?: { id: string }[] }>(pPath);
  project.designs = project.designs ?? [];
  if (!project.designs.some(d => d.id === designId)) {
    project.designs.push({ id: designId, path: `designs/${designId}.design.yaml`, type: 'poster', status: 'draft' } as { id: string });
  }
  writeYAML(pPath, project);
}

export function batchCreate(args: { project_path: string; template_id: string; slots_array: Record<string, unknown>[] }): ToolResult {
  const op = 'batch_create';
  const progress: ProgressItem[] = [];
  const created: { design_id: string; path: string }[] = [];

  // Resolve the template FIRST so every variant inherits its dimensions, theme
  // and layout. The old code ignored template_id and created blank default-size
  // (1080×1080 square) posters, then patched non-resolving paths — so a 1080×2000
  // template produced empty squares ("can't generate a proper custom-dimension
  // poster"). Now we clone the real template per row.
  const template = resolveBatchTemplate(args.project_path, args.template_id);
  if (!template) {
    return errResult(op, `Template not found: ${args.template_id}`,
      'template_id must be a built-in catalog id (see templates {op:list}), a project .template.yaml id (see templates {op:export}), OR a design name in this project to clone.', progress);
  }
  const slots = template.slots ?? [];

  for (let i = 0; i < args.slots_array.length; i++) {
    const row = { ...args.slots_array[i] };
    const name = (row['name'] as string | undefined) ?? `${args.template_id}-${i + 1}`;
    delete row['name'];

    // Translate the row's friendly keys → the template's actual slot paths.
    const used = new Set<string>();
    const slotValues: Record<string, unknown> = {};
    let matched = 0;
    for (const [key, value] of Object.entries(row)) {
      const slot = matchSlot(key, slots, used);
      if (slot) { slotValues[slot.path] = value; used.add(slot.id); matched++; }
    }

    const design = injectIntoTemplate(template, slotValues);
    design.meta = { ...design.meta, id: generateId(), name, generator: 'mcp', modified: new Date().toISOString().split('T')[0] };
    const designId = name.toLowerCase().replace(/\s+/g, '-');
    const designPath = resolveDesignPath(`designs/${designId}.design.yaml`, args.project_path);
    writeYAML(designPath, design);
    registerInProject(args.project_path, designId);
    created.push({ design_id: design.meta.id, path: designPath });
    progress.push(pOk(`Created design ${i + 1}/${args.slots_array.length}`,
      `${name} — ${design.document.width}×${design.document.height}, ${matched}/${Object.keys(row).length} slot(s) filled`));
  }

  const context = buildContext(op, `Batch created ${created.length} design(s) from "${args.template_id}"`,
    created.map(c => ({ type: 'design', path: c.path, role: 'created' })));
  const handover = buildHandover('EXPORT', { project_path: args.project_path });
  return okResult(op, { created, count: created.length, progress, context, handover });
}
