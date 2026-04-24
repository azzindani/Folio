import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import type { ToolResult } from '../types';

// §18 — reject paths outside the user's home directory or OS temp directory
export function resolvePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  const tmp = os.tmpdir();
  const underHome = resolved.startsWith(home + path.sep) || resolved === home;
  const underTmp = resolved.startsWith(tmp + path.sep) || resolved === tmp;
  if (!underHome && !underTmp) {
    throw new Error(`Path outside allowed home directory: ${filePath}`);
  }
  return resolved;
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

// §20-21 — read at call time (not import time) so env changes take effect
// MCP_CONSTRAINED_MODE=true  → 8 GB / 32K limits (original standard)
// default                    → 128K / Gemma-4B limits (this project's target)
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

// §16 — token budget awareness
export function tokenEstimate(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

// §16 — standard error response
export function errResult(op: string, error: string, hint: string): ToolResult {
  const r: ToolResult = { success: false, op, error, hint, progress: [], token_estimate: 0 };
  r.token_estimate = tokenEstimate(r);
  return r;
}

// §16 — standard success response
export function okResult(op: string, data: Record<string, unknown>, backup?: string): ToolResult {
  const r: ToolResult = {
    success: true, op, ...data,
    progress: [],
    token_estimate: 0,
    ...(backup !== undefined ? { backup } : {}),
  };
  r.token_estimate = tokenEstimate(r);
  return r;
}
