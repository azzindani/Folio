// §14 — thin MCP wrapper; zero domain logic. One-line calls into engine.
import * as readline from 'readline';
import { TIER2_TOOLS } from './registry';
import { toMCPResult } from '../types';
import { appendOpLog } from '../engine/utils';
import { TIER2_HANDLERS as HANDLERS } from '../handlers';
import { eraFor } from '../stdio-protocol';
import { MCP_ERROR } from '../protocol';
import type { MCPRequest, MCPResponse } from '../types';

function send(res: MCPResponse): void { process.stdout.write(JSON.stringify(res) + '\n'); }

async function handle(req: MCPRequest): Promise<void> {
  const { id, method, params } = req;
  const era = eraFor('folio-tier2-design', method, params);
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: era.initialize(params) });
    case 'notifications/initialized': return;
    case 'server/discover':
      return send({ jsonrpc: '2.0', id, result: era.discover() });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: era.toolsList(TIER2_TOOLS) });
    case 'tools/call': {
      const name = (params as { name: string })?.name;
      const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};
      const fn = HANDLERS[name];
      if (!fn) return send({ jsonrpc: '2.0', id, result: era.shape(toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 })) });
      try {
        const result = await fn(args);
        appendOpLog({ op: name, success: result.success, file: (args['design_path'] ?? args['project_path'] ?? args['task_path']) as string | undefined, backup: result['backup'] as string | undefined, token_estimate: result.token_estimate });
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

export function startTier2(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => {
    try { void handle(JSON.parse(line) as MCPRequest); }
    catch { send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }); }
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) startTier2();
