// Era-aware dispatch shared by the stdio MCP entry points (tier1/2/3 + all).
//
// stdio has no HTTP status codes and no headers, so the whole era question
// reduces to one thing: did the request carry modern `_meta`? That also makes
// `server/discover` matter more here than over HTTP — on stdio it is the only
// probe a dual-era client has to find out which era it is talking to, which is
// why every one of these servers must answer it.
import {
  isModernRequest, negotiateLegacyVersion, discoverResult, completeResult,
  withCacheHints, TOOLS_LIST_TTL_MS,
} from './protocol';
import { currentVersion } from './update-check';
import type { ToolDefinition } from './types';

const CAPABILITIES: Record<string, unknown> = { tools: {} };

export interface EraDispatch {
  /** True when the request opted into 2026-07-28 semantics. */
  readonly modern: boolean;
  /** Stamp a tool result for the era (no-op on the legacy path). */
  shape(result: object): unknown;
  /** Result for a legacy `initialize`. */
  initialize(params: unknown): Record<string, unknown>;
  /** Result for `server/discover` — answered in both eras. */
  discover(): Record<string, unknown>;
  /** Result for `tools/list`, cacheable on the modern path. */
  toolsList(tools: ToolDefinition[]): unknown;
}

/** Build the era-aware helpers for one incoming stdio request.
 *  @param serverName identity reported to clients, e.g. `folio-all`.
 *  @param instructions optional natural-language steering for `server/discover`. */
export function eraFor(
  serverName: string, method: string, params: unknown, instructions?: string,
): EraDispatch {
  const identity = { name: serverName, version: currentVersion() };
  const modern = isModernRequest({}, method, params);
  return {
    modern,
    shape: (result: object): unknown =>
      modern ? completeResult(result as Record<string, unknown>, identity) : result,
    initialize: (p: unknown): Record<string, unknown> => ({
      protocolVersion: negotiateLegacyVersion((p as { protocolVersion?: unknown } | undefined)?.protocolVersion),
      capabilities: CAPABILITIES,
      serverInfo: identity,
    }),
    discover: (): Record<string, unknown> => discoverResult(identity, CAPABILITIES, instructions),
    toolsList: (tools: ToolDefinition[]): unknown => modern
      ? withCacheHints(completeResult({ tools }, identity), TOOLS_LIST_TTL_MS, 'private')
      : { tools },
  };
}
