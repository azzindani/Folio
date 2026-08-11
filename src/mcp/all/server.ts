// §14 — combined stdio MCP server: ALL 38 tools from a single registration.
// For clients that prefer one stdio server over registering folio-t1/t2/t3
// separately. Mirrors the HTTP server's full surface. Zero domain logic.
import * as readline from 'readline';
import { TIER1_TOOLS } from '../tier1/registry';
import { TIER2_TOOLS } from '../tier2/registry';
import { TIER3_TOOLS } from '../tier3/registry';
import { toMCPResult } from '../types';
import { appendOpLog } from '../engine/utils';
import { ALL_HANDLERS as HANDLERS } from '../handlers';
import { eraFor } from '../stdio-protocol';
import { MCP_ERROR } from '../protocol';
import type { MCPRequest, MCPResponse, ToolDefinition } from '../types';

const ALL_TOOLS: ToolDefinition[] = [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS];

function send(res: MCPResponse): void { process.stdout.write(JSON.stringify(res) + '\n'); }

async function handle(req: MCPRequest): Promise<void> {
  const { id, method, params } = req;
  const era = eraFor('folio-all', method, params);
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: era.initialize(params) });
    case 'notifications/initialized': return;
    case 'server/discover':
      return send({ jsonrpc: '2.0', id, result: era.discover() });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: era.toolsList(ALL_TOOLS) });
    case 'tools/call': {
      const name = (params as { name: string })?.name;
      const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};
      const fn = HANDLERS[name];
      if (!fn) return send({ jsonrpc: '2.0', id, result: era.shape(toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 })) });
      try {
        const result = await fn(args);
        appendOpLog({ op: name, success: result.success, file: (args['design_path'] ?? args['project_path'] ?? args['task_path'] ?? args['template_path']) as string | undefined, backup: result['backup'] as string | undefined, token_estimate: result.token_estimate });
        return send({ jsonrpc: '2.0', id, result: era.shape(toMCPResult(result)) });
      } catch (err) {
        appendOpLog({ op: name, success: false });
        return send({ jsonrpc: '2.0', id, result: era.shape(toMCPResult({ success: false, op: name, error: (err as Error).message, hint: 'Unexpected engine error.', progress: [], token_estimate: 0 })) });
      }
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: MCP_ERROR.MethodNotFound, message: `Method not found: ${method}` } });
  }
}

export function startAll(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => {
    try { void handle(JSON.parse(line) as MCPRequest); }
    catch { send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }); }
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) startAll();
