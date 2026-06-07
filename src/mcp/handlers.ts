// Single source of truth for stdio tool→engine handler maps.
//
// The three tiers are intentionally EXCLUSIVE: a client registers folio-t1 +
// folio-t2 + folio-t3 as three servers and sees their union (no duplicate tool
// names). For clients that want the full surface from ONE registration, the
// combined `all` server (FOLIO_MCP_TIER=all) serves ALL_HANDLERS.
import * as engine from './engine';
import type { ToolResult } from './types';

export type Handler = (args: Record<string, unknown>) => ToolResult;

export const TIER1_HANDLERS: Record<string, Handler> = {
  get_engine_guide:  (_a) => engine.getEngineGuide({}),
  list_tasks:        (a) => engine.listTasks(a as Parameters<typeof engine.listTasks>[0]),
  create_project:    (a) => engine.createProject(a as Parameters<typeof engine.createProject>[0]),
  list_designs:      (a) => engine.listDesigns(a as Parameters<typeof engine.listDesigns>[0]),
  list_themes:       (a) => engine.listThemes(a as Parameters<typeof engine.listThemes>[0]),
  apply_theme:       (a) => engine.applyTheme(a as Parameters<typeof engine.applyTheme>[0]),
  duplicate_design:  (a) => engine.duplicateDesign(a as Parameters<typeof engine.duplicateDesign>[0]),
  resume_design:     (a) => engine.resumeDesign(a as Parameters<typeof engine.resumeDesign>[0]),
  create_task:       (a) => engine.createTask(a as Parameters<typeof engine.createTask>[0]),
  resume_task:       (a) => engine.resumeTask(a as Parameters<typeof engine.resumeTask>[0]),
};

export const TIER2_HANDLERS: Record<string, Handler> = {
  inspect_design:   (a) => engine.inspectDesign(a as Parameters<typeof engine.inspectDesign>[0]),
  extract_reference: (a) => engine.extractReference(a as Parameters<typeof engine.extractReference>[0]),
  add_layers:     (a) => engine.addLayers(a as Parameters<typeof engine.addLayers>[0]),
  create_design:  (a) => engine.createDesign(a as Parameters<typeof engine.createDesign>[0]),
  append_page:    (a) => engine.appendPage(a as Parameters<typeof engine.appendPage>[0]),
  patch_design:   (a) => engine.patchDesign(a as Parameters<typeof engine.patchDesign>[0]),
  seal_design:    (a) => engine.sealDesign(a as Parameters<typeof engine.sealDesign>[0]),
  add_layer:      (a) => engine.addLayer(a as Parameters<typeof engine.addLayer>[0]),
  update_layer:   (a) => engine.updateLayer(a as Parameters<typeof engine.updateLayer>[0]),
  remove_layer:   (a) => engine.removeLayer(a as Parameters<typeof engine.removeLayer>[0]),
};

export const TIER3_HANDLERS: Record<string, Handler> = {
  open_in_editor:      (a) => engine.openInEditor(a as Parameters<typeof engine.openInEditor>[0]),
  export_design:       (a) => engine.exportDesign(a as Parameters<typeof engine.exportDesign>[0]),
  batch_create:        (a) => engine.batchCreate(a as Parameters<typeof engine.batchCreate>[0]),
  save_as_component:   (a) => engine.saveAsComponent(a as Parameters<typeof engine.saveAsComponent>[0]),
  export_template:     (a) => engine.exportTemplate(a as Parameters<typeof engine.exportTemplate>[0]),
  inject_template:     (a) => engine.injectTemplate(a as Parameters<typeof engine.injectTemplate>[0]),
  list_template_slots: (a) => engine.listTemplateSlots(a as Parameters<typeof engine.listTemplateSlots>[0]),
  generate_report:     (a) => engine.generateReport(a as Parameters<typeof engine.generateReport>[0]),
  bind_data:           (a) => engine.bindData(a as Parameters<typeof engine.bindData>[0]),
  export_report:       (a) => engine.exportReport(a as Parameters<typeof engine.exportReport>[0]),
  validate_report:     (a) => engine.validateReportDesign(a as Parameters<typeof engine.validateReportDesign>[0]),
  create_presentation: (a) => engine.createPresentation(a as Parameters<typeof engine.createPresentation>[0]),
  export_presentation: (a) => engine.exportPresentation(a as Parameters<typeof engine.exportPresentation>[0]),
  set_formula_context: (a) => engine.setFormulaContext(a as Parameters<typeof engine.setFormulaContext>[0]),
  debug_formula:       (a) => engine.debugFormula(a as Parameters<typeof engine.debugFormula>[0]),
  inspect_timeline:       (a) => engine.inspectTimeline(a as Parameters<typeof engine.inspectTimeline>[0]),
  add_keyframe:           (a) => engine.addKeyframeToLayer(a as Parameters<typeof engine.addKeyframeToLayer>[0]),
  export_animation:       (a) => engine.exportAnimation(a as Parameters<typeof engine.exportAnimation>[0]),
  setup_remote_presenter: (a) => engine.setupRemotePresenter(a as Parameters<typeof engine.setupRemotePresenter>[0]),
  setup_collab:           (a) => engine.setupCollab(a as Parameters<typeof engine.setupCollab>[0]),
};

/** Full surface — every tool, for the combined `all` stdio server. */
export const ALL_HANDLERS: Record<string, Handler> = {
  ...TIER1_HANDLERS, ...TIER2_HANDLERS, ...TIER3_HANDLERS,
};
