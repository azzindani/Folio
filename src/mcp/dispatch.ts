// Consolidation dispatch — the multiplexed tools (manage_design, themes, tasks,
// edit_layer, templates, report, presentation, animation) route on an `op`
// discriminator to the SAME engine functions the per-tool handlers used. The
// merged input schemas reuse the original field names with no collisions, so
// args pass straight through; `op` (and sibling-op fields) are ignored by each
// engine fn. Capability is unchanged — only the tool surface is smaller.
import * as engine from './engine';
import { errResult } from './engine/utils';
import type { ToolResult } from './types';
import { TOOL_OPS } from './tool-ops';

type Args = Record<string, unknown>;

function badOp(tool: string, op: unknown): ToolResult {
  return errResult(tool, `Unknown op: ${op === undefined ? '(missing)' : String(op)}`,
    `Set op to one of: ${(TOOL_OPS[tool] ?? []).join(', ')}.`);
}

// `shape` reaches for polygon-clipping, which is lazy-imported, so this
// multiplexer may answer with a promise — same arrangement as manage_design.
// The sync ops are unchanged.
export function dispatchEditLayer(a: Args): ToolResult | Promise<ToolResult> {
  // Only patch_spec can preview. Every other op took dry_run:true, ignored it and
  // WROTE — the one thing a dry run promises not to do (one-shot benchmark r1).
  if (a['dry_run'] === true && a['op'] !== 'patch_spec') {
    return errResult('edit_layer', `op:${String(a['op'])} has no dry run — nothing was written.`,
      'Send it without dry_run: every edit snapshots the design first, and manage_design {op:"restore"} lists the points to go back to. (dry_run previews op:patch_spec only.)');
  }
  switch (a['op']) {
    case 'add':    return engine.addLayer(a as Parameters<typeof engine.addLayer>[0]);
    case 'update': return engine.updateLayer(a as Parameters<typeof engine.updateLayer>[0]);
    case 'remove': return engine.removeLayer(a as Parameters<typeof engine.removeLayer>[0]);
    case 'align':  return engine.alignLayers(a as Parameters<typeof engine.alignLayers>[0]);
    case 'move':   return engine.moveLayers(a as unknown as Parameters<typeof engine.moveLayers>[0]);
    case 'scale':  return engine.scaleLayers(a as unknown as Parameters<typeof engine.scaleLayers>[0]);
    case 'patch_spec': return engine.patchDesignSpec(a as Parameters<typeof engine.patchDesignSpec>[0]);
    case 'shape':  return engine.shapeOp(a as unknown as Parameters<typeof engine.shapeOp>[0]);
    case 'split_text': return engine.splitText(a as unknown as Parameters<typeof engine.splitText>[0]);
    case 'detach': return engine.detachLayers(a as unknown as Parameters<typeof engine.detachLayers>[0]);
    default:       return badOp('edit_layer', a['op']);
  }
}

// The asset finder reaches the internet, so this multiplexer — alone among the
// eight — may answer with a promise. Callers await; the sync ops are unchanged.
export function dispatchManageDesign(a: Args): ToolResult | Promise<ToolResult> {
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
    case 'asset_process': return engine.assetProcess(a as Parameters<typeof engine.assetProcess>[0]);
    case 'asset_list':   return engine.assetList(a as Parameters<typeof engine.assetList>[0]);
    case 'asset_delete': return engine.assetDelete(a as Parameters<typeof engine.assetDelete>[0]);
    case 'asset_move':   return engine.assetMove(a as Parameters<typeof engine.assetMove>[0]);
    case 'asset_read':   return engine.assetRead(a as Parameters<typeof engine.assetRead>[0]);
    case 'asset_write':  return engine.assetWrite(a as Parameters<typeof engine.assetWrite>[0]);
    case 'asset_search': return engine.assetSearch(a as Parameters<typeof engine.assetSearch>[0]);
    case 'asset_fetch':  return engine.assetFetch(a as Parameters<typeof engine.assetFetch>[0]);
    case 'asset_promote': return engine.assetPromote(a as Parameters<typeof engine.assetPromote>[0]);
    case 'icon_search':  return engine.iconSearch(a as Parameters<typeof engine.iconSearch>[0]);
    case 'get_spec':     return engine.getDesignSpec(a as Parameters<typeof engine.getDesignSpec>[0]);
    case 'resize':       return engine.resizeDesign(a as Parameters<typeof engine.resizeDesign>[0]);
    case 'reframe':      return engine.reframeDesign(a as Parameters<typeof engine.reframeDesign>[0]);
    case 'tokens':       return engine.designTokens(a as Parameters<typeof engine.designTokens>[0]);
    case 'lineage':      return engine.designLineage(a as Parameters<typeof engine.designLineage>[0]);
    case 'restore':      return engine.restoreDesign(a as Parameters<typeof engine.restoreDesign>[0]);
    case 'style_history': return engine.styleHistory(a as Parameters<typeof engine.styleHistory>[0]);
    default:          return badOp('manage_design', a['op']);
  }
}

export function dispatchThemes(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':  return engine.listThemes(a as Parameters<typeof engine.listThemes>[0]);
    case 'apply': return engine.applyTheme(a as Parameters<typeof engine.applyTheme>[0]);
    case 'packs': return engine.listPacks(a as Parameters<typeof engine.listPacks>[0]);
    default:      return badOp('themes', a['op']);
  }
}

export function dispatchTasks(a: Args): ToolResult | Promise<ToolResult> {
  switch (a['op']) {
    case 'execute': return engine.executeSteps(a as Parameters<typeof engine.executeSteps>[0]);
    case 'save_recipe': return engine.saveRecipe(a as Parameters<typeof engine.saveRecipe>[0]);
    case 'run_recipe':  return engine.runRecipe(a as Parameters<typeof engine.runRecipe>[0]);
    case 'recipes':     return engine.listRecipes();
    case 'list':   return engine.listTasks(a as Parameters<typeof engine.listTasks>[0]);
    case 'create': return engine.createTask(a as Parameters<typeof engine.createTask>[0]);
    case 'resume': return engine.resumeTask(a as Parameters<typeof engine.resumeTask>[0]);
    default:       return badOp('tasks', a['op']);
  }
}

export function dispatchTemplates(a: Args): ToolResult {
  switch (a['op']) {
    case 'list':           return engine.listTemplates(a as Parameters<typeof engine.listTemplates>[0]);
    case 'slots':          return engine.listTemplateSlots(a as Parameters<typeof engine.listTemplateSlots>[0]);
    case 'inject':         return engine.injectTemplate(a as Parameters<typeof engine.injectTemplate>[0]);
    case 'export':         return engine.exportTemplate(a as Parameters<typeof engine.exportTemplate>[0]);
    case 'save_component': return engine.saveAsComponent(a as Parameters<typeof engine.saveAsComponent>[0]);
    case 'components':     return engine.listComponents(a as Parameters<typeof engine.listComponents>[0]);
    case 'batch':          return engine.batchCreate(a as Parameters<typeof engine.batchCreate>[0]);
    default:               return badOp('templates', a['op']);
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
    case 'customize': return engine.customizeReport(a as Parameters<typeof engine.customizeReport>[0]);
    default:          return badOp('report', a['op']);
  }
}

export function dispatchPresentation(a: Args): ToolResult {
  switch (a['op']) {
    case 'create': return engine.createPresentation(a as Parameters<typeof engine.createPresentation>[0]);
    case 'export': return engine.exportPresentation(a as Parameters<typeof engine.exportPresentation>[0]);
    case 'remote': return engine.setupRemotePresenter(a as Parameters<typeof engine.setupRemotePresenter>[0]);
    case 'collab': return engine.setupCollab(a as Parameters<typeof engine.setupCollab>[0]);
    case 'customize': return engine.customizePresentation(a as Parameters<typeof engine.customizePresentation>[0]);
    default:       return badOp('presentation', a['op']);
  }
}

export function dispatchAnimation(a: Args): ToolResult | Promise<ToolResult> {
  switch (a['op']) {
    case 'timeline': return a['scenes'] === true
      ? engine.sceneTimeline(a as unknown as Parameters<typeof engine.sceneTimeline>[0])
      : engine.inspectTimeline(a as Parameters<typeof engine.inspectTimeline>[0]);
    case 'scene':    return engine.setScene(a as unknown as Parameters<typeof engine.setScene>[0]);
    case 'keyframe': return engine.addKeyframeToLayer(a as Parameters<typeof engine.addKeyframeToLayer>[0]);
    case 'export':   return engine.exportAnimation(a as unknown as Parameters<typeof engine.exportAnimation>[0]);
    case 'export_status': return engine.exportStatus(a);
    case 'motion':   return engine.applyMotion(a as Parameters<typeof engine.applyMotion>[0]);
    case 'sequence': return engine.sequenceMotion(a as Parameters<typeof engine.sequenceMotion>[0]);
    case 'track':    return engine.setTrack(a as Parameters<typeof engine.setTrack>[0]);
    case 'clear':    return engine.clearMotion(a as Parameters<typeof engine.clearMotion>[0]);
    case 'frame':    return engine.renderFrame(a as Parameters<typeof engine.renderFrame>[0]);
    case 'preview':  return engine.previewMotion(a as unknown as Parameters<typeof engine.previewMotion>[0]);
    case 'motion_path': return engine.setMotionPath(a as unknown as Parameters<typeof engine.setMotionPath>[0]);
    case 'text':     return engine.animateText(a as unknown as Parameters<typeof engine.animateText>[0]);
    case 'wiggle':   return engine.wiggleMotion(a as unknown as Parameters<typeof engine.wiggleMotion>[0]);
    case 'camera':   return engine.cameraMotion(a as unknown as Parameters<typeof engine.cameraMotion>[0]);
    case 'morph':    return engine.morphMotion(a as unknown as Parameters<typeof engine.morphMotion>[0]);
    case 'audio':    return engine.audioMotion(a as unknown as Parameters<typeof engine.audioMotion>[0]);
    case 'video':    return engine.videoMotion(a as unknown as Parameters<typeof engine.videoMotion>[0]);
    case 'beats':    return engine.beatsMotion(a as unknown as Parameters<typeof engine.beatsMotion>[0]);
    case 'captions': return engine.captionsMotion(a as unknown as Parameters<typeof engine.captionsMotion>[0]);
    case 'markers':  return engine.markersMotion(a as unknown as Parameters<typeof engine.markersMotion>[0]);
    case 'span':     return engine.spanMotion(a as unknown as Parameters<typeof engine.spanMotion>[0]);
    case 'retime':   return engine.retimeMotion(a as unknown as Parameters<typeof engine.retimeMotion>[0]);
    case 'loop':     return engine.loopMotion(a as unknown as Parameters<typeof engine.loopMotion>[0]);
    case 'drive':    return engine.driveMotion(a as unknown as Parameters<typeof engine.driveMotion>[0]);
    case 'depth':    return engine.depthMotion(a as unknown as Parameters<typeof engine.depthMotion>[0]);
    case 'storyboard': return engine.storyboardMotion(a as unknown as Parameters<typeof engine.storyboardMotion>[0]);
    case 'lint':     return engine.lintMotion(a as unknown as Parameters<typeof engine.lintMotion>[0]);
    case 'precomp':  return engine.precompMotion(a as unknown as Parameters<typeof engine.precompMotion>[0]);
    case 'link':     return engine.linkMotion(a as unknown as Parameters<typeof engine.linkMotion>[0]);
    case 'parent':   return engine.parentMotion(a as unknown as Parameters<typeof engine.parentMotion>[0]);
    case 'null':     return engine.nullMotion(a as unknown as Parameters<typeof engine.nullMotion>[0]);
    case 'motion_blur': return engine.motionBlurMotion(a as unknown as Parameters<typeof engine.motionBlurMotion>[0]);
    case 'presets':  return engine.listMotionPresets();
    default:         return badOp('animation', a['op']);
  }
}
