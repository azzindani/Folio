// ── MCP Tool Schema Types ────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

export interface PropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  default?: unknown;
}

// ── §16 Return Value Contract ────────────────────────────────
// Every tool returns this shape. No plain strings, lists, or undefined.
export interface ToolResult {
  success: boolean;
  op?: string;
  error?: string;
  hint?: string;
  backup?: string;
  progress: string[];
  token_estimate: number;
  [key: string]: unknown;
}

// ── MCP Content Envelope ─────────────────────────────────────

export interface ToolCallResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function toMCPResult(result: ToolResult): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: result.success === false,
  };
}

// ── MCP Message Types (stdio transport) ─────────────────────

export interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
