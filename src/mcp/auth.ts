// §14b — Token-based auth for the MCP HTTP transport.
//
// Three configurable modes, evaluated in this priority order at module load:
//
//   1. FOLIO_TOKENS_FILE=/path/to/tokens.json
//        File content: { "name1": "sk-...", "name2": "sk-..." }
//
//   2. FOLIO_TOKENS="name1:sk-...,name2:sk-..."
//        Inline named tokens (good for compose env files).
//
//   3. FOLIO_API_KEY="sk-..."
//        Single shared bearer — legacy, registered under the name "default".
//
//   (none)
//        Server runs UNAUTHENTICATED. Intended for localhost / private network
//        only. The startup banner prints a clear warning.
//
// Wire usage: `Authorization: Bearer <token>` on every authed endpoint.
import * as fs from 'fs';
import type * as http from 'http';

export interface TokenRegistry {
  readonly mode: 'open' | 'single' | 'multi';
  /** Map of bearer-value → human-readable token name (for audit log). */
  readonly tokens: ReadonlyMap<string, string>;
}

let _registry: TokenRegistry | null = null;

/** Build and cache the token registry from env. Call once on server start. */
export function loadTokens(): TokenRegistry {
  if (_registry) return _registry;

  const tokens = new Map<string, string>();

  const file = process.env['FOLIO_TOKENS_FILE'];
  if (file && file.length > 0) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) tokens.set(value, name);
      }
      if (tokens.size > 0) {
        _registry = { mode: 'multi', tokens };
        return _registry;
      }
      process.stderr.write(`[auth] FOLIO_TOKENS_FILE loaded but no usable entries (${file})\n`);
    } catch (err) {
      process.stderr.write(`[auth] Failed to read FOLIO_TOKENS_FILE ${file}: ${(err as Error).message}\n`);
    }
  }

  const inline = process.env['FOLIO_TOKENS'];
  if (inline && inline.length > 0) {
    for (const pair of inline.split(',')) {
      const [name, ...rest] = pair.split(':');
      const value = rest.join(':').trim();
      const trimmedName = (name ?? '').trim();
      if (trimmedName.length > 0 && value.length > 0) tokens.set(value, trimmedName);
    }
    if (tokens.size > 0) {
      _registry = { mode: 'multi', tokens };
      return _registry;
    }
    process.stderr.write(`[auth] FOLIO_TOKENS set but produced no usable entries (expected "name:value,name:value")\n`);
  }

  const single = process.env['FOLIO_API_KEY'];
  if (single && single.length > 0) {
    tokens.set(single, 'default');
    _registry = { mode: 'single', tokens };
    return _registry;
  }

  _registry = { mode: 'open', tokens };
  return _registry;
}

/**
 * Authorize a request. Returns the token name on success, `null` on failure,
 * or `'__open__'` when the server is in unauthenticated mode.
 */
export function authorize(req: http.IncomingMessage): string | null {
  const registry = loadTokens();
  if (registry.mode === 'open') return '__open__';

  const header = req.headers['authorization'] ?? '';
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const presented = header.slice('Bearer '.length).trim();
  if (presented.length === 0) return null;

  const name = registry.tokens.get(presented);
  return name ?? null;
}

/** Describe the active auth configuration for the startup banner. */
export function describeAuth(): string {
  const r = loadTokens();
  switch (r.mode) {
    case 'open':
      return 'UNAUTHENTICATED — no FOLIO_TOKENS_FILE / FOLIO_TOKENS / FOLIO_API_KEY set';
    case 'single':
      return 'single shared bearer (FOLIO_API_KEY) registered as "default"';
    case 'multi':
      return `${r.tokens.size} named token(s): ${[...r.tokens.values()].join(', ')}`;
  }
}

/** Test hook — reset the cached registry so a fresh env can be re-read. */
export function _resetForTests(): void {
  _registry = null;
}
