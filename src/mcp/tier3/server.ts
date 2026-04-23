// §14 — thin MCP wrapper; zero domain logic. One-line calls into engine.
import * as readline from 'readline';
import { TIER3_TOOLS } from './registry';
import * as engine from '../engine';
import { toMCPResult } from '../types';
import type { MCPRequest, MCPResponse, ToolResult } from '../types';

type Handler = (args: Record<string, unknown>) => ToolResult;

const HANDLERS: Record<string, Handler> = {
  export_design:       (a) => engine.exportDesign(a as Parameters<typeof engine.exportDesign>[0]),
  batch_create:        (a) => engine.batchCreate(a as Parameters<typeof engine.batchCreate>[0]),
  save_as_component:   (a) => engine.saveAsComponent(a as Parameters<typeof engine.saveAsComponent>[0]),
  export_template:     (a) => engine.exportTemplate(a as Parameters<typeof engine.exportTemplate>[0]),
  inject_template:     (a) => engine.injectTemplate(a as Parameters<typeof engine.injectTemplate>[0]),
  list_template_slots: (a) => engine.listTemplateSlots(a as Parameters<typeof engine.listTemplateSlots>[0]),
};

function send(res: MCPResponse): void { process.stdout.write(JSON.stringify(res) + '\n'); }

function handle(req: MCPRequest): void {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'folio-tier3-export', version: '1.0.0' } } });
    case 'notifications/initialized': return;
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TIER3_TOOLS } });
    case 'tools/call': {
      const name = (params as { name: string })?.name;
      const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};
      const fn = HANDLERS[name];
      if (!fn) return send({ jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: `Unknown tool: ${name}`, hint: `Available: ${Object.keys(HANDLERS).join(', ')}`, progress: [], token_estimate: 0 }) });
      try { return send({ jsonrpc: '2.0', id, result: toMCPResult(fn(args)) }); }
      catch (err) { return send({ jsonrpc: '2.0', id, result: toMCPResult({ success: false, op: name, error: (err as Error).message, hint: 'Unexpected engine error.', progress: [], token_estimate: 0 }) }); }
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

export function startTier3(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => {
    try { handle(JSON.parse(line) as MCPRequest); }
    catch { send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }); }
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) startTier3();
