// Shared editor-link builder.
//
// Every design-producing tool (create_design, append_page, seal_design,
// export_design) returns a self-contained, tokenized URL the user can click
// to open the design in the Folio editor — same mechanism open_in_editor uses,
// surfaced everywhere so a design is openable the moment it exists.
//
// Each call mints a FRESH unique editor token (1h TTL), so the link is
// self-authenticating and not shared/replayed across designs.
import { mintEditorToken } from '../oauth';
import { registerShortLink } from './short-link';
import type { AttachmentBlock } from '../types';

export interface EditorLink {
  /** Clickable, token-embedded URL that opens this design in the editor. */
  open_url: string;
  /**
   * SHORT, opaque link (…/o/<code>) that 302-redirects to the full editor URL,
   * minting the auth token server-side. ~40 chars, no JWT, no percent-encoding —
   * give THIS to a human/small model to relay; the long open_url is for clients
   * that load the design programmatically. Absent on a bare (no-design) link.
   */
  short_url?: string;
  /** Base editor URL (no query) — for clients that build their own links. */
  editor_url: string;
  /** MCP resource block so capable clients render a rich, clickable preview. */
  attachment: AttachmentBlock;
}

/**
 * Build a self-contained editor URL for a design.
 * @param designPath absolute path to the *.design.yaml (omit for a bare editor link)
 * @param opts.page  optional page index to open on (carousels)
 * @param opts.editorUrl override base URL (default: $FOLIO_EDITOR_URL or localhost:4173)
 */
export function buildEditorLink(
  designPath?: string,
  opts?: { page?: number; editorUrl?: string },
): EditorLink {
  const editor_url = (opts?.editorUrl ?? process.env['FOLIO_EDITOR_URL'] ?? 'http://localhost:4173')
    .replace(/\/+$/, '');

  const params = new URLSearchParams();
  if (designPath) params.set('file', designPath);
  if (typeof opts?.page === 'number') params.set('page', String(opts.page));
  // Live-refresh: tell the editor which MCP server to subscribe to for
  // file-change events, so it hot-reloads as further tool calls edit the file.
  const mcpUrl = process.env['FOLIO_MCP_PUBLIC_URL'] ?? `http://localhost:${process.env['FOLIO_PORT'] ?? '3333'}`;
  params.set('mcp_url', mcpUrl);
  // Fresh unique 1h token per call — self-authenticating, no basic-auth prompt.
  params.set('token', mintEditorToken('default'));

  const open_url = params.toString() ? `${editor_url}/?${params.toString()}` : editor_url;

  // Short, mangle-proof link — register code→path and hand back …/o/<code>.
  // The static-server resolves it, mints a token, and 302s to the full URL.
  const short_url = designPath
    ? `${editor_url}/o/${registerShortLink(designPath, opts?.page)}`
    : undefined;

  return {
    open_url,
    short_url,
    editor_url,
    attachment: {
      type: 'resource',
      resource: {
        uri: short_url ?? open_url,
        mimeType: 'text/html',
        text: `Open in Folio editor → ${short_url ?? open_url}`,
      },
    },
  };
}

export interface ReportViewLink {
  /** Clickable URL that renders the exported interactive HTML directly in a
   *  browser — the FINAL result, not the editor canvas. */
  view_url: string;
  /** MCP resource block so capable clients render a clickable preview. */
  attachment: AttachmentBlock;
}

/**
 * Build a self-contained URL that serves a file under FOLIO_PROJECTS_DIR
 * (typically an exported *.report.html) directly as rendered HTML. The
 * static-server mounts the projects dir at /__project_files/*, serves .html as
 * text/html, and authenticates the ?token (302-strips it + sets a 30-day
 * session cookie on first load). So this link opens the real interactive report
 * in any browser — no editor, no export button.
 * @param fileAbsPath absolute path to the file (e.g. the .report.html)
 */
export function buildReportViewLink(
  fileAbsPath: string,
  opts?: { baseUrl?: string },
): ReportViewLink {
  const base = (opts?.baseUrl ?? process.env['FOLIO_EDITOR_URL'] ?? 'http://localhost:4173')
    .replace(/\/+$/, '');
  const projectsDir = (process.env['FOLIO_PROJECTS_DIR'] ?? '/home/folio/projects').replace(/\/+$/, '');
  const rel = fileAbsPath.startsWith(`${projectsDir}/`)
    ? fileAbsPath.slice(projectsDir.length + 1)
    : fileAbsPath.replace(/^\/+/, '');
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  const view_url = `${base}/__project_files/${encoded}?token=${mintEditorToken('default')}`;
  return {
    view_url,
    attachment: {
      type: 'resource',
      resource: { uri: view_url, mimeType: 'text/html', text: `View rendered report → ${view_url}` },
    },
  };
}
