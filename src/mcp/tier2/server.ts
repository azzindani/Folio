// §14 — thin MCP wrapper; zero domain logic. One-line calls into engine.
import * as readline from 'readline';
import { TIER2_TOOLS } from './registry';
import { toMCPResult } from '../types';
import { appendOpLog } from '../engine/utils';
import { TIER2_HANDLERS as HANDLERS } from '../handlers';
import type { MCPRequest, MCPResponse } from '../types';

function send(res: MCPResponse): void { process.stdout.write(JSON.stringify(res) + '\n'); }

function handle(req: MCPRequest): void {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'folio-tier2-design', version: '1.0.0' } } });
    case 'notifications/initialized': return;
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TIER2_TOOLS } });
    case 'tools/call': {
      const name = (params as { name: string })?.name;
      const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};
      const fn = HANDLERS[name];
      if (!fn) return send({ jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 }) });
      try {
        const result = fn(args);
        appendOpLog({ op: name, success: result.success, file: (args['design_path'] ?? args['project_path'] ?? args['task_path']) as string | undefined, backup: result['backup'] as string | undefined, token_estimate: result.token_estimate });
        return send({ jsonrpc: '2.0', id, result: toMCPResult(result) });
      } catch (err) {
        appendOpLog({ op: name, success: false });
        return send({ jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: (err as Error).message, hint: 'Unexpected engine error.', progress: [], token_estimate: 0 }) });
      }
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

export function startTier2(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => {
    try { handle(JSON.parse(line) as MCPRequest); }
    catch { send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }); }
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) startTier2();
