// MCP entry — select tier via FOLIO_MCP_TIER env var (default: 1).
//
// mcp.json entries:
//   folio-project: { "command": "node --loader ts-node/esm src/mcp/index.ts", "env": { "FOLIO_MCP_TIER": "1" } }
//   folio-design:  { "command": "node --loader ts-node/esm src/mcp/index.ts", "env": { "FOLIO_MCP_TIER": "2" } }
//   folio-export:  { "command": "node --loader ts-node/esm src/mcp/index.ts", "env": { "FOLIO_MCP_TIER": "3" } }
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
