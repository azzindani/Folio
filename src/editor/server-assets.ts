// Folio editor server — asset routes (list · upload · manage).
//
// Split out of static-server.ts to keep that file inside the 700-line budget.
// Every route here delegates to the SAME engine functions the MCP asset ops
// call (ingestAsset / collectAssets / assetDelete / assetMove), so the phone's
// file manager and the model always see one store, one set of rules, one truth.
import { ingestAsset, collectAssets, sanitizeFolder, AssetError, maxAssetBytes } from '../mcp/engine/assets';
// The routing versions: they follow a "lib/" path into the SHARED library and
// fall back to the project store otherwise — same rules the MCP ops apply.
import { assetDelete, assetMove } from '../mcp/engine/asset-library-ops';
import { collectLibraryAssets, libraryFolders, ingestLibraryAsset } from '../mcp/engine/asset-library';
// Folders as first-class things: a file manager makes the folder first and
// fills it after, which the file-derived listing alone cannot represent.
import { projectFolders, createAssetFolder, removeAssetFolder } from '../mcp/engine/asset-folders';
import * as fs from 'fs';
import * as path from 'path';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

/** JSON response with the no-store + sliding-session headers the editor expects. */
function json(body: unknown, status: number, refresh?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...(refresh ? { 'Set-Cookie': refresh } : {}) },
  });
}

/**
 * GET …/<project>/__assets — the listing behind the editor's asset drawer.
 *
 * Returns BOTH stores in one array, exactly as the MCP asset_list op does, so
 * the panel, the phone's file manager and the model are looking at one set.
 * Library rows are recognisable by their "lib/" path.
 */
export function listAssets(projectDir: string, refresh?: string | null): Response {
  try {
    const own = collectAssets(projectDir);
    const shared = collectLibraryAssets();
    // Union of "folders that contain something" and "folders that exist on
    // disk" — a folder you just made is empty by definition, and a panel that
    // dropped it the moment you created it would be unusable.
    const folders = [...new Set([
      ...own.map(a => a.folder ?? '').filter(Boolean),
      ...projectFolders(projectDir),
    ])].sort();
    return json({ ok: true, assets: [...own, ...shared], folders, library_folders: libraryFolders() }, 200, refresh);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, assets: [], folders: [], library_folders: [] }, 500);
  }
}

/**
 * GET /__project_files/__projects — every project, for the panel's project picker.
 *
 * The asset manager used to be reachable only as a side effect of opening a
 * design from the Library, because that was the only moment anything told it
 * which project it was looking at. It is a file manager; it should open on its
 * own and let you pick. This is what it picks from.
 */
export function listProjects(projectsDir: string, refresh?: string | null): Response {
  try {
    const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        designs: countFiles(path.join(projectsDir, e.name, 'designs'), n => n.endsWith('.design.yaml')),
        assets: ['images', 'icons', 'fonts', 'docs']
          .reduce((n, k) => n + countFiles(path.join(projectsDir, e.name, 'assets', k), () => true, true), 0),
      }))
      .sort((a, b) => b.assets - a.assets || a.name.localeCompare(b.name));
    return json({ ok: true, projects }, 200, refresh);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, projects: [] }, 500);
  }
}

/** Count matching files in a directory, optionally one level down as well. */
function countFiles(dir: string, match: (name: string) => boolean, nested = false): number {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    if (e.isFile() && match(e.name)) n++;
    else if (nested && e.isDirectory() && !e.name.startsWith('.')) n += countFiles(path.join(dir, e.name), match);
  }
  return n;
}

/**
 * POST …/<project>/__assets/manage — {op:"delete"|"move"|"mkdir"|"rmdir", …}.
 *
 * The engine ops already validate paths and refuse traversal, so this is a thin
 * shell: parse, delegate, map the tool result onto an HTTP status.
 */
export async function manageAssets(req: Request, projectDir: string, refresh?: string | null): Promise<Response> {
  let body: {
    op?: string; asset_path?: string; folder?: string; new_name?: string;
    scope?: 'project' | 'library';
  };
  try { body = JSON.parse(await req.text()) as typeof body; } catch { return json({ ok: false, error: 'Bad JSON body' }, 400); }

  const res = body.op === 'delete'
    ? assetDelete({ project_path: projectDir, asset_path: body.asset_path })
    : body.op === 'move'
      ? assetMove({ project_path: projectDir, asset_path: body.asset_path, folder: body.folder, new_name: body.new_name })
      : body.op === 'mkdir'
        ? createAssetFolder({ projectDir, folder: body.folder, scope: body.scope })
        : body.op === 'rmdir'
          ? removeAssetFolder({ projectDir, folder: body.folder, scope: body.scope })
          : null;
  if (!res) {
    return json({
      ok: false,
      error: `Unknown op: ${String(body.op)}`,
      hint: 'Use op:"delete", "move", "mkdir" or "rmdir".',
    }, 400);
  }

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

  // ?scope=library files it in the shared store instead, where ?folder= may
  // nest ("microsoft/logos") — the URL's own folder segment cannot.
  const toLibrary = url.searchParams.get('scope') === 'library';
  const folderParam = url.searchParams.get('folder');
  try {
    const { entry, warnings, ...rest } = toLibrary
      ? ingestLibraryAsset({
        name, data: buf,
        folder: folderParam ?? folder ?? kind,
        ...(url.searchParams.get('alt') ? { alt: String(url.searchParams.get('alt')) } : {}),
      })
      : { ...ingestAsset({
        projectDir, name, data: buf, kind,
        folder: folder ? sanitizeFolder(folder) : undefined,
        alt: url.searchParams.get('alt') ?? undefined,
      }), deduped: false };
    return json({ ok: true, asset: entry, warnings, ...rest }, 200, refresh);
  } catch (e) {
    const status = e instanceof AssetError ? e.status : 500;
    const hint = e instanceof AssetError ? e.hint : '';
    return json({ ok: false, error: (e as Error).message, hint }, status);
  }
}
