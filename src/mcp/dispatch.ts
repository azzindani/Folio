// Consolidation dispatch — the multiplexed tools (manage_design, themes, tasks,
// edit_layer, templates, report, presentation, animation) route on an `op`
// discriminator to the SAME engine functions the per-tool handlers used. The
// merged input schemas reuse the original field names with no collisions, so
// args pass straight through; `op` (and sibling-op fields) are ignored by each
// engine fn. Capability is unchanged — only the tool surface is smaller.
import * as engine from './engine';
import { errResult } from './engine/utils';
import type { ToolResult } from './types';

type Args = Record<string, unknown>;

function badOp(tool: string, op: unknown, ops: string[]): ToolResult {
  return errResult(tool, `Unknown op: ${op === undefined ? '(missing)' : String(op)}`,
    `Set op to one of: ${ops.join(', ')}.`);
}

export function dispatchEditLayer(a: Args): ToolResult {
  switch (a['op']) {
    case 'add':    return engine.addLayer(a as Parameters<typeof engine.addLayer>[0]);
    case 'update': return engine.updateLayer(a as Parameters<typeof engine.updateLayer>[0]);
    case 'remove': return engine.removeLayer(a as Parameters<typeof engine.removeLayer>[0]);
    case 'align':  return engine.alignLayers(a as Parameters<typeof engine.alignLayers>[0]);
    default:       return badOp('edit_layer', a['op'], ['add', 'update', 'remove', 'align']);
  }
}

export function dispatchManageDesign(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':      return engine.listDesigns(a as Parameters<typeof engine.listDesigns>[0]);
    case 'inspect':   return engine.inspectDesign(a as Parameters<typeof engine.inspectDesign>[0]);
    case 'rename':    return engine.renameDesign(a as Parameters<typeof engine.renameDesign>[0]);
    case 'duplicate': return engine.duplicateDesign(a as Parameters<typeof engine.duplicateDesign>[0]);
    case 'move':      return engine.moveDesign(a as Parameters<typeof engine.moveDesign>[0]);
    case 'delete':    return engine.deleteDesign(a as Parameters<typeof engine.deleteDesign>[0]);
    case 'resume':    return engine.resumeDesign(a as Parameters<typeof engine.resumeDesign>[0]);
    case 'browse':    return engine.browseLibrary(a as Parameters<typeof engine.browseLibrary>[0]);
    case 'gallery':   return engine.exportLibraryGallery(a as Parameters<typeof engine.exportLibraryGallery>[0]);
    case 'asset_add':    return engine.assetAdd(a as Parameters<typeof engine.assetAdd>[0]);
    case 'asset_list':   return engine.assetList(a as Parameters<typeof engine.assetList>[0]);
    case 'asset_delete': return engine.assetDelete(a as Parameters<typeof engine.assetDelete>[0]);
    default:          return badOp('manage_design', a['op'],
      ['list', 'inspect', 'rename', 'duplicate', 'move', 'delete', 'resume', 'browse', 'gallery', 'asset_add', 'asset_list', 'asset_delete']);
  }
}

export function dispatchThemes(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':  return engine.listThemes(a as Parameters<typeof engine.listThemes>[0]);
    case 'apply': return engine.applyTheme(a as Parameters<typeof engine.applyTheme>[0]);
    default:      return badOp('themes', a['op'], ['list', 'apply']);
  }
}

export function dispatchTasks(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':   return engine.listTasks(a as Parameters<typeof engine.listTasks>[0]);
    case 'create': return engine.createTask(a as Parameters<typeof engine.createTask>[0]);
    case 'resume': return engine.resumeTask(a as Parameters<typeof engine.resumeTask>[0]);
    default:       return badOp('tasks', a['op'], ['list', 'create', 'resume']);
  }
}

export function dispatchTemplates(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':           return engine.listTemplates(a as Parameters<typeof engine.listTemplates>[0]);
    case 'slots':          return engine.listTemplateSlots(a as Parameters<typeof engine.listTemplateSlots>[0]);
    case 'inject':         return engine.injectTemplate(a as Parameters<typeof engine.injectTemplate>[0]);
    case 'export':         return engine.exportTemplate(a as Parameters<typeof engine.exportTemplate>[0]);
    case 'save_component': return engine.saveAsComponent(a as Parameters<typeof engine.saveAsComponent>[0]);
    case 'batch':          return engine.batchCreate(a as Parameters<typeof engine.batchCreate>[0]);
    default:               return badOp('templates', a['op'],
      ['list', 'slots', 'inject', 'export', 'save_component', 'batch']);
  }
}

export function dispatchReport(a: Args): ToolResult {
  switch (a['op']) {
    case 'generate':  return engine.generateReport(a as Parameters<typeof engine.generateReport>[0]);
    case 'bind_data': return engine.bindData(a as Parameters<typeof engine.bindData>[0]);
    case 'validate':  return engine.validateReportDesign(a as Parameters<typeof engine.validateReportDesign>[0]);
    case 'export':    return engine.exportReport(a as Parameters<typeof engine.exportReport>[0]);
    case 'formula':   return engine.setFormulaContext(a as Parameters<typeof engine.setFormulaContext>[0]);
    case 'debug':     return engine.debugFormula(a as Parameters<typeof engine.debugFormula>[0]);
    default:          return badOp('report', a['op'],
      ['generate', 'bind_data', 'validate', 'export', 'formula', 'debug']);
  }
}

export function dispatchPresentation(a: Args): ToolResult {
  switch (a['op']) {
    case 'create': return engine.createPresentation(a as Parameters<typeof engine.createPresentation>[0]);
    case 'export': return engine.exportPresentation(a as Parameters<typeof engine.exportPresentation>[0]);
    case 'remote': return engine.setupRemotePresenter(a as Parameters<typeof engine.setupRemotePresenter>[0]);
    case 'collab': return engine.setupCollab(a as Parameters<typeof engine.setupCollab>[0]);
    default:       return badOp('presentation', a['op'], ['create', 'export', 'remote', 'collab']);
  }
}

export function dispatchAnimation(a: Args): ToolResult {
  switch (a['op']) {
    case 'timeline': return engine.inspectTimeline(a as Parameters<typeof engine.inspectTimeline>[0]);
    case 'keyframe': return engine.addKeyframeToLayer(a as Parameters<typeof engine.addKeyframeToLayer>[0]);
    case 'export':   return engine.exportAnimation(a as Parameters<typeof engine.exportAnimation>[0]);
    default:         return badOp('animation', a['op'], ['timeline', 'keyframe', 'export']);
  }
}
