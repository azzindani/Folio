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
  required?: string[];
  default?: unknown;
}

// ── Progress Reporting (Ring-1 pure helpers) ─────────────────
export interface ProgressItem {
  status: 'ok' | 'fail' | 'warn' | 'info';
  message: string;
  detail?: string;
}

// ── Context — what was accomplished ─────────────────────────
export interface ContextField {
  op: string;
  summary: string;
  artifacts: { type: string; path: string; role: string }[];
  timestamp: string;
}

// ── Handover — full relay baton for small models ─────────────
// Replaces flat NextAction with: workflow position + alternatives + carry_forward.
// Small models (Gemma 4B, Qwen 2B) use suggested_next to pick the next call
// without needing to reason about state from scratch.
export interface SuggestedNext {
  tool: string;
  tier: 1 | 2 | 3;
  reason: string;
  params?: Record<string, unknown>;
}

export interface Handover {
  workflow_step: string;            // current step e.g. 'PROJECT' | 'DESIGN' | 'COMPOSE' | 'SEAL' | 'EXPORT'
  workflow_next: string;            // next logical step
  suggested_next: SuggestedNext[];  // 2–3 concrete alternatives with params
  carry_forward: Record<string, unknown>; // pre-populated params for the next call
}

// ── NextAction (kept for backward compat; prefer Handover) ───
export interface NextAction {
  tool: string;
  params: Record<string, unknown>;
  remaining: number;
  hint?: string;
}

// ── §16 Return Value Contract ────────────────────────────────
export interface ToolResult {
  success: boolean;
  op?: string;
  error?: string;
  hint?: string;
  backup?: string;
  progress: ProgressItem[];
  token_estimate: number;
  context?: ContextField;
  handover?: Handover;
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
