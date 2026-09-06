import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import type { ToolResult, ProgressItem, ContextField, Handover, SuggestedNext } from '../types';
import { builtinTemplatesDir } from './builtin-templates';
import { noteDesignWrite } from '../design-lineage';

// §18 — reject paths outside the allowed roots. Four roots accepted:
//   1. user home dir
//   2. OS temp dir
//   3. FOLIO_PROJECTS_DIR (set when running in docker where projects/ is
//      bind-mounted to /home/folio/projects but also so LLMs guessing
//      "/var/folio/projects/<x>" / similar paths get a useful error).
//   4. FOLIO_SHARED_DIRS — comma-separated roots shared with SIBLING services
//      (a data/ML server's /workspace/data, say). Without it an agent that
//      generated a chart with one server literally cannot hand the file to
//      this one: asset_add is refused reading it, export_design is refused
//      writing beside it, and the failures only surface late, one error at a
//      time. Opt-in, so the sandbox stays closed unless a deployment says
//      otherwise.
//
// Bare names like "my-project" or "designs/foo.design.yaml" are not absolute
// and the caller is expected to resolve them against a project_path first;
// resolveDesignPath() and resolveProjectPath() do this lookup.

/** Extra roots this deployment shares with sibling MCP servers. */
export function sharedDirs(): string[] {
  return String(process.env['FOLIO_SHARED_DIRS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).map(p => path.resolve(p));
}

export function resolvePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  const tmp = os.tmpdir();
  const projects = process.env['FOLIO_PROJECTS_DIR'];
  const under = (root: string): boolean =>
    resolved === root || resolved.startsWith(root + path.sep);
  if (under(home) || under(tmp)) return resolved;
  if (projects && under(path.resolve(projects))) return resolved;
  const shared = sharedDirs();
  if (shared.some(under)) return resolved;
  // The app's own built-in template catalog (dist/public assets) is a
  // legitimate read root so MCP can inject the templates the editor browses.
  const builtin = builtinTemplatesDir();
  if (builtin && under(path.resolve(builtin))) return resolved;
  // Name the roots that DO work — the boundary stated once, here, instead of
  // being discovered one refused call at a time.
  const roots = [home, tmp, ...(projects ? [path.resolve(projects)] : []), ...shared];
  throw new Error(
    `Path outside allowed directories: ${filePath}. This server can read and write under: ${roots.join(', ')}. `
    + `To bring in a file from another service, either copy it under one of those roots, pass it inline `
    + `(manage_design {op:"asset_add", data:"data:image/png;base64,…"}), or have the deployment add its `
    + `directory to FOLIO_SHARED_DIRS.`,
  );
}

// Resolve a project path. Bare names like "my-project" are treated as
// relative to FOLIO_PROJECTS_DIR so LLM agents don't need to know the
// absolute path. Absolute paths pass through resolvePath() unchanged.
export function resolveProjectPath(projectPath: string): string {
  if (path.isAbsolute(projectPath)) return resolvePath(projectPath);
  if (projectPath.startsWith('~/')) return resolvePath(path.join(os.homedir(), projectPath.slice(2)));
  const base = process.env['FOLIO_PROJECTS_DIR'];
  if (base) return resolvePath(path.join(base, projectPath));
  return resolvePath(projectPath);
}

// Resolve design_path relative to project_path when path is partial/relative.
// Allows small models to say "designs/foo.design.yaml" instead of full absolute paths.
export function resolveDesignPath(designPath: string, projectPath?: string): string {
  if (path.isAbsolute(designPath)) return resolvePath(designPath);
  if (designPath.startsWith('~/')) return resolvePath(path.join(os.homedir(), designPath.slice(2)));
  if (projectPath) return resolvePath(path.join(projectPath, designPath));
  return resolvePath(designPath);
}

// §19 — atomic snapshot with Windows collision guard + retention cap.
// Each mutating tool call writes one .bak per touched file; without a cap
// the .mcp_versions/ dir grows unboundedly under heavy MCP use.
// Override the per-file retention via FOLIO_SNAPSHOT_KEEP (default 20).
const SNAPSHOT_KEEP_DEFAULT = 20;

function pruneSnapshots(versionsDir: string, stem: string): void {
  let keep = parseInt(process.env['FOLIO_SNAPSHOT_KEEP'] ?? '', 10);
  if (!Number.isFinite(keep) || keep < 1) keep = SNAPSHOT_KEEP_DEFAULT;
  try {
    const entries = fs.readdirSync(versionsDir)
      .filter(n => n.startsWith(`${stem}_`) && n.endsWith('.bak'))
      .map(n => ({ name: n, mtime: fs.statSync(path.join(versionsDir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first
    for (const e of entries.slice(keep)) {
      try { fs.unlinkSync(path.join(versionsDir, e.name)); } catch { /* best-effort */ }
    }
  } catch { /* never fail the write on a prune error */ }
}

export function snapshot(filePath: string): string {
  const p = resolvePath(filePath);
  const versionsDir = path.join(path.dirname(p), '.mcp_versions');
  fs.mkdirSync(versionsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23) + 'Z';
  const stem = path.basename(p, path.extname(p));
  let backupPath = path.join(versionsDir, `${stem}_${ts}.bak`);
  let counter = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(versionsDir, `${stem}_${ts}_${counter}.bak`);
    counter++;
  }
  const tmpPath = backupPath + '.tmp';
  try {
    fs.copyFileSync(p, tmpPath);
    fs.renameSync(tmpPath, backupPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  // Prune oldest snapshots so the dir doesn't grow without bound.
  pruneSnapshots(versionsDir, stem);
  return backupPath;
}

export function readYAML<T>(filePath: string): T {
  const content = fs.readFileSync(resolvePath(filePath), 'utf-8');
  const data = yaml.load(content) as T;
  // A weak model (via patch_design) sometimes writes `layers` as a SINGLE object
  // instead of a list — `layers: {type: rect}` not `layers: [ … ]`. Everything
  // downstream calls `layers.map(...)` / `layers.push(...)`, so that one bad write
  // crashed render/export/diagnose with "layers.map is not a function" (g_summit)
  // and would break a repair attempt too. Coerce a lone-object layers container
  // back to a one-element array so the malformed design self-heals on read.
  const fix = (c: { layers?: unknown } | null | undefined): void => {
    if (c && c.layers != null && !Array.isArray(c.layers) && typeof c.layers === 'object') {
      c.layers = [c.layers];
    }
  };
  if (data && typeof data === 'object') {
    fix(data as { layers?: unknown });
    const pages = (data as { pages?: unknown }).pages;
    if (Array.isArray(pages)) for (const p of pages) fix(p as { layers?: unknown });
    assertAcyclic(data as { layers?: unknown; pages?: { layers?: unknown }[] });
  }
  return data;
}

/**
 * Refuse a layer tree that contains itself.
 *
 * YAML anchors are ordinary YAML — `- &g {…, layers: [*g]}` loads as a REAL
 * cyclic object graph, and every walker in the engine is a plain recursion over
 * `layers`. Reading one blew the stack: `manage_design {op:"inspect"}` answered
 * "Maximum call stack size exceeded", which names nothing and suggests nothing.
 * It fails fast rather than hanging, but it is still a crash reported as prose.
 *
 * Checked once, here, because every design load passes through this function —
 * so the guard covers every walker downstream instead of each growing its own.
 * The engine never WRITES a cycle (writeYAML dumps with noRefs), so this only
 * ever fires on a hand-edited file, which is exactly the case worth naming.
 *
 * Ancestors-on-the-current-path, not a global visited set: the same layer
 * object appearing twice as siblings is unusual but terminates fine, and only a
 * node that is its own ancestor can loop forever.
 */
function assertAcyclic(doc: { layers?: unknown; pages?: { layers?: unknown }[] }): void {
  const path = new Set<object>();
  const walk = (layers: unknown): void => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) {
      if (!l || typeof l !== 'object') continue;
      const node = l as object & { id?: unknown; layers?: unknown };
      if (path.has(node)) {
        throw new Error(
          `Design contains a reference cycle: layer "${String(node.id ?? '(unnamed)')}" contains itself. `
          + 'A YAML anchor (&name / *name) was used to nest a group inside itself — give the inner layer its own definition.',
        );
      }
      path.add(node);
      walk(node.layers);
      path.delete(node);
    }
  };
  walk(doc.layers);
  for (const p of doc.pages ?? []) walk(p?.layers);
}

// Atomic write: temp file → rename, prevents partial writes
export function writeYAML(filePath: string, data: unknown): void {
  const resolved = resolvePath(filePath);
  const content = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });
  // Lineage is recorded HERE, at the one place every design write passes
  // through, so coverage is a property of the architecture rather than of each
  // tool remembering to log. (The review's complaint was a receipt that
  // silently covered only some operations — see design-lineage.ts.)
  noteDesignWrite(resolved, content);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = resolved + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, resolved);
}

/** Write bytes back VERBATIM — the restore path.
 *
 *  A restore must reproduce the exact content a snapshot holds: re-dumping it
 *  through yaml.dump would re-order and re-wrap it, changing the hash, so the
 *  restored file could no longer be checked against the hash the log recorded.
 *  Same lineage hook as writeYAML, so a restore is itself history. */
export function writeRaw(filePath: string, content: string): void {
  const resolved = resolvePath(filePath);
  noteDesignWrite(resolved, content);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = resolved + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, resolved);
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// §20-21 — read at call time so env changes take effect between calls
export function isConstrained(): boolean {
  return process.env['MCP_CONSTRAINED_MODE'] === 'true';
}

// Hard response size limits — checked at call time via isConstrained()
export const LIMITS = {
  get list_rows()    { return isConstrained() ? 20  : 100; },
  get search_rows()  { return isConstrained() ? 10  : 50;  },
  get list_items()   { return isConstrained() ? 40  : 200; },
  get log_lines()    { return isConstrained() ? 50  : 200; },
  get layer_rows()   { return isConstrained() ? 20  : 80;  },
  get json_depth()   { return isConstrained() ? 3   : 6;   },
} as const;

// §16 — token budget caps (reference ceilings; enforced via LIMITS above)
export const READ_TOKEN_CAP  = 500;
export const WRITE_TOKEN_CAP = 150;

// Output budget: max tokens per tool response. Read from env at call time.
// Set FOLIO_OUTPUT_BUDGET=1000 (default) for local models; higher for cloud APIs.
export function getOutputBudget(): number {
  return parseInt(process.env['FOLIO_OUTPUT_BUDGET'] ?? '1000', 10);
}

export function tokenEstimate(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

// ── Progress helpers (Ring-1 pure) ────────────────────────────
export const pOk   = (msg: string, detail?: string): ProgressItem => ({ status: 'ok',   message: msg, detail });
export const pFail = (msg: string, detail?: string): ProgressItem => ({ status: 'fail', message: msg, detail });
export const pWarn = (msg: string, detail?: string): ProgressItem => ({ status: 'warn', message: msg, detail });
export const pInfo = (msg: string, detail?: string): ProgressItem => ({ status: 'info', message: msg, detail });

// ── Context builder ───────────────────────────────────────────
export function buildContext(
  op: string,
  summary: string,
  artifacts: { type: string; path: string; role: string }[] = [],
): ContextField {
  return { op, summary, artifacts, timestamp: new Date().toISOString() };
}

// ── Handover builder ──────────────────────────────────────────
// Workflow: PROJECT → DESIGN → COMPOSE → SEAL → EXPORT
//           PATCH loops back to SEAL; RECOVER routes to COMPOSE
const HANDOVER_MAP: Record<string, { next: string; suggestions: SuggestedNext[] }> = {
  PROJECT: {
    next: 'DESIGN',
    suggestions: [
      { tool: 'create_design', tier: 2, reason: 'create a new design in this project' },
      { tool: 'create_task',   tier: 1, reason: 'plan a multi-page carousel task' },
      { tool: 'list_designs',  tier: 1, reason: 'list designs already in this project' },
    ],
  },
  DESIGN: {
    next: 'COMPOSE',
    suggestions: [
      { tool: 'add_layers',      tier: 2, reason: 'add layers using shorthand syntax' },
      { tool: 'append_page',     tier: 2, reason: 'add a page to a carousel design' },
      { tool: 'inspect_design',  tier: 2, reason: 'inspect current design state' },
    ],
  },
  COMPOSE: {
    next: 'SEAL',
    suggestions: [
      { tool: 'seal_design',    tier: 2, reason: 'finalize when all layers are added' },
      { tool: 'add_layers',     tier: 2, reason: 'add more layers' },
      { tool: 'inspect_design', tier: 2, reason: 'verify state before sealing' },
    ],
  },
  PATCH: {
    next: 'SEAL',
    suggestions: [
      { tool: 'seal_design',    tier: 2, reason: 'finalize after patches' },
      { tool: 'patch_design',   tier: 2, reason: 'apply more surgical patches' },
      { tool: 'inspect_design', tier: 2, reason: 'verify changes before sealing' },
    ],
  },
  SEAL: {
    next: 'EXPORT',
    suggestions: [
      { tool: 'export_design',    tier: 3, reason: 'export as SVG or HTML' },
      { tool: 'export_template',  tier: 3, reason: 'save as reusable template' },
      { tool: 'duplicate_design', tier: 1, reason: 'duplicate for a variation' },
    ],
  },
  EXPORT: {
    next: 'DONE',
    suggestions: [
      { tool: 'batch_create',   tier: 3, reason: 'generate N variations from template' },
      { tool: 'inject_template', tier: 3, reason: 'fill template with new content' },
      { tool: 'create_task',    tier: 1, reason: 'start a new multi-page task' },
    ],
  },
  RECOVER: {
    next: 'COMPOSE',
    suggestions: [
      { tool: 'resume_task',    tier: 1, reason: 'get exact next step after context reset' },
      { tool: 'resume_design',  tier: 1, reason: 'check carousel progress' },
      { tool: 'inspect_design', tier: 2, reason: 'inspect current design state' },
    ],
  },
};

// Type-aware suggestion overrides. The static HANDOVER_MAP is keyed only by
// workflow step, so it used to suggest the carousel-only `append_page` even
// for a poster (a real wrong-tool hand-off). When the caller knows the design
// type, these overrides pick the correct next tools per type.
const ADD_LAYERS: SuggestedNext = { tool: 'add_layers', tier: 2, reason: 'add layers to this page using shorthand syntax' };
const APPEND_PAGE: SuggestedNext = { tool: 'append_page', tier: 2, reason: 'add the next page to this carousel' };
const SEAL: SuggestedNext = { tool: 'seal_design', tier: 2, reason: 'finalize when all content is added' };
const INSPECT: SuggestedNext = { tool: 'inspect_design', tier: 2, reason: 'inspect current design state' };
const EXPORT: SuggestedNext = { tool: 'export_design', tier: 3, reason: 'export as SVG or HTML' };
const OPEN: SuggestedNext = { tool: 'open_in_editor', tier: 3, reason: 'open this design in the editor' };

const TYPE_SUGGESTIONS: Record<string, Record<'poster' | 'carousel', SuggestedNext[]>> = {
  DESIGN: {
    poster:   [ADD_LAYERS, INSPECT],
    carousel: [APPEND_PAGE, INSPECT],
  },
  COMPOSE: {
    poster:   [SEAL, ADD_LAYERS, INSPECT],
    carousel: [APPEND_PAGE, SEAL, INSPECT],
  },
  SEAL: {
    poster:   [EXPORT, OPEN],
    carousel: [EXPORT, OPEN],
  },
};

export function buildHandover(
  step: string,
  carryForward: Record<string, unknown>,
  opts?: { type?: 'poster' | 'carousel' | 'motion' | 'report' | 'presentation' },
): Handover {
  const entry = HANDOVER_MAP[step] ?? HANDOVER_MAP['PROJECT'];
  // Only poster/carousel have type-specific suggestion sets; other design
  // types (motion/report/presentation) fall back to the step's default.
  const typed = opts?.type === 'poster' || opts?.type === 'carousel'
    ? TYPE_SUGGESTIONS[step]?.[opts.type]
    : undefined;
  const base = typed ?? entry.suggestions;
  // Only forward params each tool actually accepts — avoids smearing
  // design_path onto project-scoped tools (e.g. list_designs/create_task).
  const suggested_next = base.map(s => ({
    ...s,
    params: { ...pickParamsFor(s.tool, carryForward), ...(s.params ?? {}) },
  }));
  return { workflow_step: step, workflow_next: entry.next, suggested_next, carry_forward: carryForward };
}

// Per-tool carry_forward param allowlist. Tools not listed get the full
// carry_forward (safe default for design-scoped tools).
const PROJECT_SCOPED = new Set(['create_design', 'create_task', 'list_designs', 'list_themes', 'apply_theme', 'list_tasks']);
function pickParamsFor(tool: string, carry: Record<string, unknown>): Record<string, unknown> {
  if (PROJECT_SCOPED.has(tool)) {
    const out: Record<string, unknown> = {};
    if ('project_path' in carry) out['project_path'] = carry['project_path'];
    return out;
  }
  return carry;
}

// ── Operation Receipt Logging ─────────────────────────────────
const OPS_LOG = path.join(os.homedir(), '.folio', 'ops.log');
// Rotate when ops.log crosses this size. The current file gets renamed to
// ops.log.1 (overwriting any previous .1) — single-rotation is enough
// telemetry without unbounded disk growth.
const OPS_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

function rotateOpsLogIfBig(): void {
  try {
    const st = fs.statSync(OPS_LOG);
    if (st.size <= OPS_LOG_MAX_BYTES) return;
    const rotated = `${OPS_LOG}.1`;
    try { fs.unlinkSync(rotated); } catch { /* may not exist */ }
    fs.renameSync(OPS_LOG, rotated);
  } catch { /* file may not exist yet — appendFileSync will create it */ }
}

export function appendOpLog(entry: {
  op: string; success: boolean; file?: string; backup?: string; token_estimate?: number;
}): void {
  try {
    rotateOpsLogIfBig();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.mkdirSync(path.dirname(OPS_LOG), { recursive: true });
    fs.appendFileSync(OPS_LOG, line, 'utf-8');
  } catch { /* never fail on logging */ }
}

// ── Standard result constructors ──────────────────────────────

export function errResult(
  op: string, error: string, hint: string,
  progress: ProgressItem[] = [],
): ToolResult {
  const r: ToolResult = { success: false, op, error, hint, progress: [...progress, pFail(error)], token_estimate: 0 };
  r.token_estimate = tokenEstimate(r);
  return r;
}

export function okResult(
  op: string,
  data: Record<string, unknown>,
  backup?: string,
): ToolResult {
  const r: ToolResult = {
    success: true, op, ...data,
    progress: (data['progress'] as ProgressItem[] | undefined) ?? [],
    token_estimate: 0,
    ...(backup !== undefined ? { backup } : {}),
  };
  r.token_estimate = tokenEstimate(r);

  const budget = getOutputBudget();
  if (r.token_estimate > budget) {
    // Trim verbose fields to fit within output budget.
    // Priority: keep success/op/domain fields; compress meta fields.
    if (r.context) {
      const ctx = r.context as ContextField;
      r.context = { op: ctx.op, summary: ctx.summary, artifacts: [], timestamp: ctx.timestamp };
    }
    if (r.handover) {
      const hw = r.handover as Handover;
      r.handover = { ...hw, suggested_next: hw.suggested_next.slice(0, 1) };
    }
    if (Array.isArray(r.progress) && (r.progress as ProgressItem[]).length > 2) {
      r.progress = (r.progress as ProgressItem[]).slice(-2);
    }
    if (typeof r.backup === 'string') {
      r.backup = path.basename(r.backup as string);
    }
    r.budget_trimmed = true;
    r.token_estimate = tokenEstimate(r);
  }

  return r;
}

// ── Generated layer ids ─────────────────────────────────────
//
// Ops that CREATE layers (shape, split_text) named their output from the source
// — `sq_offset`, `word_c1` — and never checked whether that name was taken. Run
// the same op twice and the design carried two layers with one id, which is not
// a cosmetic problem: `update` then patches BOTH and `remove` deletes BOTH, so a
// model asking to change one layer silently changes two. Verified on a live
// design — one offset repeated, then `remove word_c1` took away two layers.

/** Every layer id in a tree, group children included. */
export function collectLayerIds(layers: unknown[], into = new Set<string>()): Set<string> {
  for (const l of layers) {
    if (!l || typeof l !== 'object') continue;
    const o = l as Record<string, unknown>;
    if (typeof o['id'] === 'string' && o['id']) into.add(o['id']);
    const kids = o['layers'];
    if (Array.isArray(kids)) collectLayerIds(kids, into);
  }
  return into;
}

/**
 * `base` if it is free, else `base_2`, `base_3`, … — and the chosen name is
 * added to `taken`, so a batch of new layers cannot collide with each other
 * either.
 */
export function freeLayerId(taken: Set<string>, base: string): string {
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}
