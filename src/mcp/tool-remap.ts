// Engine functions emit next_action / handover.suggested_next hints that name
// the ORIGINAL (pre-consolidation) tools. After folding 50 → 21 tools, those
// names would point at tools that no longer exist. Rather than rewrite every
// engine fn, we remap the hints centrally: an old name → its consolidated tool
// + the `op` that selects the same behaviour (injected at the front of params).
import type { ToolResult, NextAction } from './types';

interface Remap { tool: string; op: string; tier: 1 | 2 | 3 }

const REMAP: Record<string, Remap> = {
  // → tasks
  list_tasks:   { tool: 'tasks', op: 'list',   tier: 1 },
  create_task:  { tool: 'tasks', op: 'create', tier: 1 },
  resume_task:  { tool: 'tasks', op: 'resume', tier: 1 },
  // → manage_design
  list_designs:           { tool: 'manage_design', op: 'list',      tier: 1 },
  browse_library:         { tool: 'manage_design', op: 'browse',    tier: 1 },
  inspect_design:         { tool: 'manage_design', op: 'inspect',   tier: 1 },
  rename_design:          { tool: 'manage_design', op: 'rename',    tier: 1 },
  duplicate_design:       { tool: 'manage_design', op: 'duplicate', tier: 1 },
  move_design:            { tool: 'manage_design', op: 'move',      tier: 1 },
  delete_design:          { tool: 'manage_design', op: 'delete',    tier: 1 },
  resume_design:          { tool: 'manage_design', op: 'resume',    tier: 1 },
  export_library_gallery: { tool: 'manage_design', op: 'gallery',   tier: 1 },
  // → themes
  list_themes: { tool: 'themes', op: 'list',  tier: 1 },
  apply_theme: { tool: 'themes', op: 'apply', tier: 1 },
  // → edit_layer
  add_layer:    { tool: 'edit_layer', op: 'add',    tier: 2 },
  update_layer: { tool: 'edit_layer', op: 'update', tier: 2 },
  remove_layer: { tool: 'edit_layer', op: 'remove', tier: 2 },
  align_layers: { tool: 'edit_layer', op: 'align',  tier: 2 },
  // → templates
  list_templates:      { tool: 'templates', op: 'list',           tier: 3 },
  list_template_slots: { tool: 'templates', op: 'slots',          tier: 3 },
  inject_template:     { tool: 'templates', op: 'inject',         tier: 3 },
  export_template:     { tool: 'templates', op: 'export',         tier: 3 },
  save_as_component:   { tool: 'templates', op: 'save_component', tier: 3 },
  batch_create:        { tool: 'templates', op: 'batch',          tier: 3 },
  // → report
  generate_report:     { tool: 'report', op: 'generate',  tier: 3 },
  bind_data:           { tool: 'report', op: 'bind_data', tier: 3 },
  validate_report:     { tool: 'report', op: 'validate',  tier: 3 },
  export_report:       { tool: 'report', op: 'export',    tier: 3 },
  set_formula_context: { tool: 'report', op: 'formula',   tier: 3 },
  debug_formula:       { tool: 'report', op: 'debug',     tier: 3 },
  // → presentation
  create_presentation:    { tool: 'presentation', op: 'create', tier: 3 },
  export_presentation:    { tool: 'presentation', op: 'export', tier: 3 },
  setup_remote_presenter: { tool: 'presentation', op: 'remote', tier: 3 },
  setup_collab:           { tool: 'presentation', op: 'collab', tier: 3 },
  // → animation
  inspect_timeline: { tool: 'animation', op: 'timeline', tier: 3 },
  add_keyframe:     { tool: 'animation', op: 'keyframe', tier: 3 },
  export_animation: { tool: 'animation', op: 'export',   tier: 3 },
};

/** Rewrite any old tool name referenced in the result's forward hints to its
 *  consolidated {tool, op}. Mutates + returns the same result. */
export function remapToolRefs(result: ToolResult): ToolResult {
  const na = (result as ToolResult & { next_action?: NextAction }).next_action;
  if (na && REMAP[na.tool]) {
    const m = REMAP[na.tool];
    na.params = { op: m.op, ...(na.params ?? {}) };
    na.tool = m.tool;
  }
  const sn = result.handover?.suggested_next;
  if (sn) {
    for (const s of sn) {
      const m = REMAP[s.tool];
      if (m) { s.params = { op: m.op, ...(s.params ?? {}) }; s.tool = m.tool; s.tier = m.tier; }
    }
  }
  return result;
}
