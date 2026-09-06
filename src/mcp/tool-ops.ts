// Every op each multiplexer accepts — the ONE definition, in a module light
// enough for both consumers to import (dispatch.ts pulls in the whole engine,
// so the argument guard cannot import it back).
//
// The lists used to be literals inside each `default:` branch of dispatch.ts,
// which left two callers unable to ask the question: `missingArgs`, which
// therefore answered an unknown op by naming a missing argument
// (`edit_layer {op:"bogus"} needs design_path` — advice for a call that fails
// again, since the very next reply is "Unknown op" anyway), and
// required-args.test.ts, which recovered the lists by regex over the SOURCE of
// dispatch.ts.

export const TOOL_OPS: Record<string, readonly string[]> = {
  edit_layer: ['add', 'update', 'remove', 'align', 'patch_spec', 'shape', 'split_text'],
  manage_design: ['list', 'inspect', 'rename', 'duplicate', 'move', 'delete', 'resume', 'browse', 'gallery',
    'asset_add', 'asset_process', 'asset_list', 'asset_delete', 'asset_move', 'asset_read', 'asset_write',
    'asset_search', 'asset_fetch', 'asset_promote', 'icon_search', 'get_spec', 'resize', 'tokens',
    'lineage', 'restore', 'style_history'],
  themes: ['list', 'apply', 'packs'],
  tasks: ['list', 'create', 'resume'],
  templates: ['list', 'slots', 'inject', 'export', 'save_component', 'components', 'batch'],
  report: ['generate', 'customize', 'bind_data', 'validate', 'export', 'formula', 'debug'],
  presentation: ['create', 'customize', 'export', 'remote', 'collab'],
  animation: ['timeline', 'keyframe', 'export', 'motion', 'motion_path', 'sequence', 'track', 'clear', 'frame', 'presets'],
};

/** Does this tool multiplex, and does it know this op? True for a tool that does
 *  not multiplex at all, so a caller can ask without knowing which is which. */
export function knownOp(tool: string, op: unknown): boolean {
  const ops = TOOL_OPS[tool];
  return !ops || (typeof op === 'string' && ops.includes(op));
}
