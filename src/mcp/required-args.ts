// Enforce, at the server, the arguments each tool already promises.
//
// Every tool's inputSchema declares a `required` array, and the multiplexed
// tools list per-op requirements in their descriptions. Neither was checked
// before the handler ran, so a missing argument reached whatever touched it
// first and the CRASH became the reply:
//
//   seal_design {}              The "path" property must be of type string,
//                               got undefined
//   templates {op:"slots"}      undefined is not an object
//                               (evaluating 'idOrFile.replace')
//   themes {op:"apply"}         The "paths[0]" property must be of type string
//   tasks {op:"resume"}         Task not found: undefined
//   manage_design {op:"delete"} The "path" property must be of type string
//
// That last one is a later find: the per-op half below was written by hand from
// the descriptions, and manage_design — 26 ops, the largest tool — was skipped
// wholesale. A sweep of every op of all eight multiplexers found 15 still
// answering with V8 internals; they are covered now, and the sweep is a test.
//
// None of those names the argument that is missing, which is the only thing the
// caller needs. A conforming MCP client validates `required` for us, which is
// why this went unnoticed — but the HTTP surface takes JSON-RPC from anything,
// and a client that skips validation gets V8 internals instead of an answer.
//
// The single-purpose half is DERIVED from the registries rather than restated,
// so the check and the published contract cannot drift apart.
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';
import { errResult } from './engine/utils';
import { knownOp } from './tool-ops';
import type { ToolResult } from './types';

type Args = Record<string, unknown>;

/**
 * Per-op requirements for the multiplexed tools, from each description's own
 * `req:` list. These cannot come from the schema: `required` there is just
 * ['op'], because which other fields matter depends on which op was picked.
 *
 * Ops that legitimately need nothing are absent by design — `animation
 * {op:"presets"}` is a menu, `presentation {op:"remote"}` returns a start
 * command and a client script rather than starting anything.
 */
export const PER_OP: Record<string, Record<string, string[]>> = {
  templates: {
    slots: ['template_path'],
    inject: ['template_path'],
    export: ['design_path'],
    save_component: ['design_path', 'layer_ids', 'component_name', 'project_path'],
    components: ['project_path'],
    batch: ['project_path', 'template_id', 'slots_array'],
  },
  report: {
    generate: ['project_path', 'name'],
    customize: ['design_path', 'changes'],
    bind_data: ['design_path', 'datasets'],
    validate: ['design_path'],
    export: ['design_path'],
    formula: ['design_path'],
    debug: ['formula'],
  },
  presentation: {
    create: ['project_path', 'name'],
    customize: ['design_path', 'changes'],
    export: ['design_path'],
    collab: ['design_path'],
  },
  themes: {
    list: ['project_path'],
    apply: ['project_path'],
  },
  tasks: {
    list: ['project_path'],
    create: ['project_path', 'task_name'],
    resume: ['task_path'],
  },
  // The largest multiplexer, and the one this table first missed entirely. Its
  // ASSET ops each hand-check their own arguments and name the missing one, so
  // they are left to do that; every DESIGN op went straight to a path resolver
  // and answered with V8 internals instead. Each entry below is the plain
  // conjunction from that op's own `req:` list in the tool description — where
  // the published requirement is an either/or (`resize` wants width AND/OR
  // height) only the unconditional part is listed, because a false rejection
  // would be worse than the crash it replaces.
  manage_design: {
    list: ['project_path'],
    inspect: ['design_path'],
    rename: ['design_path', 'new_name'],
    duplicate: ['design_path', 'new_name'],
    move: ['design_path', 'target_project'],
    delete: ['design_path'],
    resume: ['design_path'],
    get_spec: ['design_path'],
    resize: ['design_path'],
    tokens: ['design_path'],
    lineage: ['design_path'],
    restore: ['design_path'],
    style_history: ['project_path'],
  },
  edit_layer: {
    add: ['design_path', 'layer'],
    update: ['design_path', 'layer_id', 'props'],
    remove: ['design_path', 'layer_id'],
    align: ['design_path', 'layer_ids', 'operation'],
    patch_spec: ['design_path', 'layer_id', 'changes'],
    shape: ['design_path', 'shape_op', 'layer_ids'],
    split_text: ['design_path', 'layer_id'],
  },
  animation: {
    sequence: ['design_path', 'steps'],
    track: ['design_path', 'keyframes'],
    motion: ['design_path'],
    motion_path: ['design_path'],
    keyframe: ['design_path', 'layer_id', 'keyframe'],
    frame: ['design_path'],
    preview: ['design_path'],
    timeline: ['design_path'],
    clear: ['design_path'],
    export: ['design_path'],
  },
};

/** tool name → the `required` array its own inputSchema publishes. */
const SCHEMA_REQUIRED: Record<string, string[]> = Object.fromEntries(
  [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].map(t => {
    const schema = (t as { inputSchema?: { required?: unknown } }).inputSchema;
    const req = Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    // `op` is checked by each multiplexer, which can also list the valid ops.
    return [t.name, req.filter(k => k !== 'op')];
  }),
);

const absent = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** An actionable error when a required argument is missing, else null. */
export function missingArgs(tool: string, a: Args): ToolResult | null {
  const op = typeof a['op'] === 'string' ? a['op'] : undefined;
  // An op the multiplexer does not have is the FIRST thing wrong, so let it say
  // so — it can list the real ones. Naming a missing argument here instead sends
  // the model to fix something that will not help: supply design_path and the
  // very next reply is "Unknown op" anyway.
  if (op !== undefined && !knownOp(tool, op)) return null;
  const need = [
    ...(SCHEMA_REQUIRED[tool] ?? []),
    ...(op ? PER_OP[tool]?.[op] ?? [] : []),
  ];
  if (need.length === 0) return null;

  const gone = [...new Set(need)].filter(k => absent(a[k]));
  if (gone.length === 0) return null;

  const where = op ? `${tool} {op:"${op}"}` : tool;
  return errResult(tool,
    `${where} needs ${gone.map(k => `\`${k}\``).join(' + ')}`,
    `Pass ${gone.join(', ')}. The tool description says what each op requires.`);
}
