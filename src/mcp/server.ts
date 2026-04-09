import * as readline from 'readline';
import { TOOL_DEFINITIONS } from './tool-registry';
import {
  createProject, listDesigns, createDesign,
  appendPage, patchDesign, sealDesign,
  addLayer, updateLayer, removeLayer,
  listThemes, exportDesignTool,
  batchCreate, duplicateDesign, resumeDesign,
  saveAsComponent, applyTheme,
} from './tool-handlers';
import type { MCPRequest, MCPResponse, ToolCallResult } from './types';

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => ToolCallResult> = {
  create_project: (a) => createProject(a as Parameters<typeof createProject>[0]),
  list_designs: (a) => listDesigns(a as Parameters<typeof listDesigns>[0]),
  create_design: (a) => createDesign(a as Parameters<typeof createDesign>[0]),
  append_page: (a) => appendPage(a as Parameters<typeof appendPage>[0]),
  patch_design: (a) => patchDesign(a as Parameters<typeof patchDesign>[0]),
  seal_design: (a) => sealDesign(a as Parameters<typeof sealDesign>[0]),
  add_layer: (a) => addLayer(a as Parameters<typeof addLayer>[0]),
  update_layer: (a) => updateLayer(a as Parameters<typeof updateLayer>[0]),
  remove_layer: (a) => removeLayer(a as Parameters<typeof removeLayer>[0]),
  list_themes: (a) => listThemes(a as Parameters<typeof listThemes>[0]),
  export_design: (a) => exportDesignTool(a as Parameters<typeof exportDesignTool>[0]),
  batch_create: (a) => batchCreate(a as Parameters<typeof batchCreate>[0]),
  duplicate_design: (a) => duplicateDesign(a as Parameters<typeof duplicateDesign>[0]),
  resume_design: (a) => resumeDesign(a as Parameters<typeof resumeDesign>[0]),
  save_as_component: (a) => saveAsComponent(a as Parameters<typeof saveAsComponent>[0]),
  apply_theme: (a) => applyTheme(a as Parameters<typeof applyTheme>[0]),
};

function sendResponse(response: MCPResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function handleRequest(request: MCPRequest): void {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize': {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'folio-design-engine',
            version: '1.0.0',
          },
        },
      });
      break;
    }

    case 'notifications/initialized': {
      // Client acknowledged initialization — no response needed
      break;
    }

    case 'tools/list': {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOL_DEFINITIONS,
        },
      });
      break;
    }

    case 'tools/call': {
      const toolName = (params as { name: string })?.name;
      const toolArgs = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};

      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          },
        });
        return;
      }

      try {
        const result = handler(toolArgs);
        sendResponse({ jsonrpc: '2.0', id, result });
      } catch (err) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Tool error: ${(err as Error).message}` }],
            isError: true,
          },
        });
      }
      break;
    }

    default: {
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  }
}

export function startServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line: string) => {
    try {
      const request = JSON.parse(line) as MCPRequest;
      handleRequest(request);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32700, message: 'Parse error' },
      });
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Run if this is the main module
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  startServer();
}
