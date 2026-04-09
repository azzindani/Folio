// ── MCP Tool Definitions ────────────────────────────────────
// These match the tool surface from CLAUDE.md Section 11.2

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

export interface ToolCallResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
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

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ── Operation Protocol ──────────────────────────────────────
export interface CreateOperation {
  _operation: 'create';
  _target: string;
}

export interface AppendOperation {
  _operation: 'append';
  _target: string;
  _append_to: string;
}

export interface PatchOperation {
  _operation: 'patch';
  _target: string;
  _selectors: { path: string; value: unknown }[];
}

export interface MergeOperation {
  _operation: 'merge';
  _target: string;
  _source: string;
  _strategy: 'append_pages' | 'replace_theme' | 'merge_layers';
}

export type MutationOperation = CreateOperation | AppendOperation | PatchOperation | MergeOperation;
