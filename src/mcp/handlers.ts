// Single source of truth for stdio tool→engine handler maps.
//
// The three tiers are intentionally EXCLUSIVE: a client registers folio-t1 +
// folio-t2 + folio-t3 as three servers and sees their union (no duplicate tool
// names). For clients that want the full surface from ONE registration, the
// combined `all` server (FOLIO_MCP_TIER=all) serves ALL_HANDLERS.
//
// The surface is CONSOLIDATED to 21 tools: hot core-loop tools stay 1:1 with an
// engine fn; the long tail is folded into multiplexed tools that route on an
// `op` discriminator (see dispatch.ts). Every engine capability is still
// reachable — only the tool count shrank (50 → 21).
import * as engine from './engine';
import * as d from './dispatch';
import { remapToolRefs } from './tool-remap';
import type { ToolResult } from './types';

// Most ops are pure local filesystem work and answer synchronously. The asset
// finder talks to the internet, so a handler may also return a promise; every
// call site awaits, which is a no-op for the sync majority.
export type Handler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

// Every handler's forward hints (next_action / suggested_next) still speak the
// pre-consolidation tool names; remap them to the consolidated {tool, op} so a
// model that follows a hint calls a tool that actually exists.
const remap = (m: Record<string, Handler>): Record<string, Handler> =>
  Object.fromEntries(Object.entries(m).map(([k, h]) => [k, (a: Record<string, unknown>) => {
    const r = h(a);
    return r instanceof Promise ? r.then(remapToolRefs) : remapToolRefs(r);
  }]));

// Tier 1 — guidance, project, discovery/library, theming, tasks.
const TIER1_RAW: Record<string, Handler> = {
  get_engine_guide: (a) => engine.getEngineGuide(a as Parameters<typeof engine.getEngineGuide>[0]),
  enrich_brief:     (a) => engine.enrichBrief(a as Parameters<typeof engine.enrichBrief>[0]),
  create_project:   (a) => engine.createProject(a as Parameters<typeof engine.createProject>[0]),
  manage_design:    (a) => d.dispatchManageDesign(a),
  themes:           (a) => d.dispatchThemes(a),
  tasks:            (a) => d.dispatchTasks(a),
};

// Tier 2 — design lifecycle + layer composition/editing + reference.
const TIER2_RAW: Record<string, Handler> = {
  create_design:     (a) => engine.createDesign(a as Parameters<typeof engine.createDesign>[0]),
  add_layers:        (a) => engine.addLayers(a as Parameters<typeof engine.addLayers>[0]),
  edit_layer:        (a) => d.dispatchEditLayer(a),
  patch_design:      (a) => engine.patchDesign(a as Parameters<typeof engine.patchDesign>[0]),
  append_page:       (a) => engine.appendPage(a as Parameters<typeof engine.appendPage>[0]),
  seal_design:       (a) => engine.sealDesign(a as Parameters<typeof engine.sealDesign>[0]),
  extract_reference: (a) => engine.extractReference(a as Parameters<typeof engine.extractReference>[0]),
};

// Tier 3 — inspect/output + the advanced subsystems (templates, reports,
// presentations, animation), each folded into one multiplexed tool.
const TIER3_RAW: Record<string, Handler> = {
  render_preview:  (a) => engine.renderPreview(a as Parameters<typeof engine.renderPreview>[0]),
  diagnose_design: (a) => engine.diagnoseDesign(a as Parameters<typeof engine.diagnoseDesign>[0]),
  export_design:   (a) => engine.exportDesign(a as Parameters<typeof engine.exportDesign>[0]),
  open_in_editor:  (a) => engine.openInEditor(a as Parameters<typeof engine.openInEditor>[0]),
  templates:       (a) => d.dispatchTemplates(a),
  report:          (a) => d.dispatchReport(a),
  presentation:    (a) => d.dispatchPresentation(a),
  animation:       (a) => d.dispatchAnimation(a),
};

export const TIER1_HANDLERS: Record<string, Handler> = remap(TIER1_RAW);
export const TIER2_HANDLERS: Record<string, Handler> = remap(TIER2_RAW);
export const TIER3_HANDLERS: Record<string, Handler> = remap(TIER3_RAW);

/** Full surface — every tool, for the combined `all` stdio server + HTTP. */
export const ALL_HANDLERS: Record<string, Handler> = {
  ...TIER1_HANDLERS, ...TIER2_HANDLERS, ...TIER3_HANDLERS,
};
