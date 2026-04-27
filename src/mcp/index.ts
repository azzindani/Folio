// MCP entry — select tier via FOLIO_MCP_TIER env var (default: 1).
//
// ── Recommended: Bun (JIT TypeScript, ~50ms cold start) ──────────────────────
// Quick start (local dev):
//   folio-t1: { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"], "env": { "FOLIO_MCP_TIER": "1" } }
//   folio-t2: { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"], "env": { "FOLIO_MCP_TIER": "2" } }
//   folio-t3: { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"], "env": { "FOLIO_MCP_TIER": "3" } }
//
// Self-updating bootstrap (Linux/macOS) — clone if missing, pull latest, run:
//   folio-t1: {
//     "command": "bash",
//     "args": ["-c", "[ -d ~/.folio_mcp ] || git clone https://github.com/azzindani/Folio ~/.folio_mcp && cd ~/.folio_mcp && git pull && bun install --frozen-lockfile && FOLIO_MCP_TIER=1 bun run src/mcp/index.ts"]
//   }
//
// Self-updating bootstrap (Windows PowerShell):
//   folio-t1: {
//     "command": "powershell",
//     "args": ["-NoProfile", "-Command", "if(!(Test-Path ~/.folio_mcp)){git clone https://github.com/azzindani/Folio ~/.folio_mcp}; Set-Location ~/.folio_mcp; git pull; bun install --frozen-lockfile; $env:FOLIO_MCP_TIER='1'; bun run src/mcp/index.ts"]
//   }
//
// ── Fallback: Node.js (requires ts-node) ─────────────────────────────────────
//   folio-t1: { "command": "node", "args": ["--loader", "ts-node/esm", "src/mcp/index.ts"], "env": { "FOLIO_MCP_TIER": "1" } }
import { startTier1 } from './tier1/server';
import { startTier2 } from './tier2/server';
import { startTier3 } from './tier3/server';

export * from './types';
export * from './engine';

const tier = process.env['FOLIO_MCP_TIER'] ?? '1';
switch (tier) {
  case '1': startTier1(); break;
  case '2': startTier2(); break;
  case '3': startTier3(); break;
  default:
    process.stderr.write(`Unknown FOLIO_MCP_TIER="${tier}". Use 1, 2, or 3.\n`);
    process.exit(1);
}
