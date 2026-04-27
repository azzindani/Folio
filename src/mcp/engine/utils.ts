import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import type { ToolResult, ProgressItem, ContextField, Handover, SuggestedNext } from '../types';

// §18 — reject paths outside user home or OS temp
export function resolvePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  const tmp = os.tmpdir();
  const underHome = resolved.startsWith(home + path.sep) || resolved === home;
  const underTmp  = resolved.startsWith(tmp  + path.sep) || resolved === tmp;
  if (!underHome && !underTmp) throw new Error(`Path outside allowed home directory: ${filePath}`);
  return resolved;
}

// Resolve design_path relative to project_path when path is partial/relative.
// Allows small models to say "designs/foo.design.yaml" instead of full absolute paths.
export function resolveDesignPath(designPath: string, projectPath?: string): string {
  if (path.isAbsolute(designPath)) return resolvePath(designPath);
  if (designPath.startsWith('~/')) return resolvePath(path.join(os.homedir(), designPath.slice(2)));
  if (projectPath) return resolvePath(path.join(projectPath, designPath));
  return resolvePath(designPath);
}

// §19 — atomic snapshot with Windows collision guard
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
  return backupPath;
}

export function readYAML<T>(filePath: string): T {
  const content = fs.readFileSync(resolvePath(filePath), 'utf-8');
  return yaml.load(content) as T;
}

// Atomic write: temp file → rename, prevents partial writes
export function writeYAML(filePath: string, data: unknown): void {
  const resolved = resolvePath(filePath);
  const content = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });
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

export function buildHandover(step: string, carryForward: Record<string, unknown>): Handover {
  const entry = HANDOVER_MAP[step] ?? HANDOVER_MAP['PROJECT'];
  // Inject carry_forward into suggested_next params
  const suggested_next = entry.suggestions.map(s => ({
    ...s,
    params: { ...carryForward, ...(s.params ?? {}) },
  }));
  return { workflow_step: step, workflow_next: entry.next, suggested_next, carry_forward: carryForward };
}

// ── Operation Receipt Logging ─────────────────────────────────
const OPS_LOG = path.join(os.homedir(), '.folio', 'ops.log');

export function appendOpLog(entry: {
  op: string; success: boolean; file?: string; backup?: string; token_estimate?: number;
}): void {
  try {
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
  return r;
}
