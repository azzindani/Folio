// Folio editor server — asset routes (list · upload · manage).
//
// Split out of static-server.ts to keep that file inside the 700-line budget.
// Every route here delegates to the SAME engine functions the MCP asset ops
// call (ingestAsset / collectAssets / assetDelete / assetMove), so the phone's
// file manager and the model always see one store, one set of rules, one truth.
import {
  ingestAsset, collectAssets, assetDelete, assetMove, sanitizeFolder,
  AssetError, maxAssetBytes,
} from '../mcp/engine/assets';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

/** JSON response with the no-store + sliding-session headers the editor expects. */
function json(body: unknown, status: number, refresh?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...(refresh ? { 'Set-Cookie': refresh } : {}) },
  });
}

/** GET …/<project>/__assets — the listing behind the editor's asset library. */
export function listAssets(projectDir: string, refresh?: string | null): Response {
  try {
    const assets = collectAssets(projectDir);
    const folders = [...new Set(assets.map(a => a.folder ?? '').filter(Boolean))].sort();
    return json({ ok: true, assets, folders }, 200, refresh);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, assets: [], folders: [] }, 500);
  }
}

/**
 * POST …/<project>/__assets/manage — {op:"delete"|"move", asset_path, folder?, new_name?}.
 *
 * The engine ops already validate paths and refuse traversal, so this is a thin
 * shell: parse, delegate, map the tool result onto an HTTP status.
 */
export async function manageAssets(req: Request, projectDir: string, refresh?: string | null): Promise<Response> {
  let body: { op?: string; asset_path?: string; folder?: string; new_name?: string };
  try { body = JSON.parse(await req.text()) as typeof body; } catch { return json({ ok: false, error: 'Bad JSON body' }, 400); }

  const res = body.op === 'delete'
    ? assetDelete({ project_path: projectDir, asset_path: body.asset_path })
    : body.op === 'move'
      ? assetMove({ project_path: projectDir, asset_path: body.asset_path, folder: body.folder, new_name: body.new_name })
      : null;
  if (!res) return json({ ok: false, error: `Unknown op: ${String(body.op)}`, hint: 'Use op:"delete" or op:"move".' }, 400);

  const record = res as unknown as Record<string, unknown>;
  const ok = record['success'] === true;
  return json({ ok, ...record }, ok ? 200 : 400, refresh);
}

/**
 * POST …/<project>/assets/<kind>[/<folder>]/<file> — raw bytes in, stored asset out.
 *
 * This is what an upload from a phone hits. The size cap is checked from the
 * declared length first so a too-large body is refused before it is buffered.
 */
export async function uploadAsset(
  req: Request, url: URL, projectDir: string,
  kind: string, folder: string | undefined, name: string, refresh?: string | null,
): Promise<Response> {
  if (parseInt(req.headers.get('content-length') ?? '0', 10) > maxAssetBytes()) {
    return json({ ok: false, error: 'Asset too large' }, 413);
  }
  let buf: Buffer;
  try { buf = Buffer.from(await req.arrayBuffer()); } catch { return json({ ok: false, error: 'Bad body' }, 400); }
  if (buf.length > maxAssetBytes()) return json({ ok: false, error: 'Asset too large' }, 413);

  try {
    const { entry, warnings } = ingestAsset({
      projectDir, name, data: buf, kind,
      folder: folder ? sanitizeFolder(folder) : undefined,
      alt: url.searchParams.get('alt') ?? undefined,
    });
    return json({ ok: true, asset: entry, warnings }, 200, refresh);
  } catch (e) {
    const status = e instanceof AssetError ? e.status : 500;
    const hint = e instanceof AssetError ? e.hint : '';
    return json({ ok: false, error: (e as Error).message, hint }, status);
  }
}
