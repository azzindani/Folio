import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openInEditor, createDesign } from '../engine';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-oie-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('openInEditor', () => {
  it('returns a URL pointing at the default editor when no design is given', () => {
    const r = openInEditor({});
    expect(r.success).toBe(true);
    expect(typeof r['url']).toBe('string');
    expect((r['url'] as string).startsWith('http://localhost:4173')).toBe(true);
  });

  it('leads with the short share link; full open_url encodes the design_path + mcp_url', () => {
    const dPath = createDesign({ project_path: tmpDir, name: 'Editor Link', type: 'poster' })['path'] as string;
    const r = openInEditor({ design_path: dPath });
    expect(r.success).toBe(true);
    // `url` is the SHORT, copy/paste-safe link (no JWT, no percent-encoding).
    const url = r['url'] as string;
    expect(url).toContain('/o/');
    expect(r['share_url']).toBe(url);
    // The full link is still available and carries the file= + mcp_url= params.
    const openUrl = r['open_url'] as string;
    expect(openUrl).toContain('file=');
    expect(openUrl).toContain('mcp_url=');
    expect(decodeURIComponent(openUrl)).toContain(dPath);
  });

  it('honours custom editor_url override', () => {
    const r = openInEditor({ editor_url: 'https://example.com/folio' });
    expect((r['url'] as string).startsWith('https://example.com/folio')).toBe(true);
  });

  it('attaches a resource block for clients that render link previews', () => {
    const r = openInEditor({});
    const att = r._attachments;
    expect(Array.isArray(att)).toBe(true);
    expect(att![0]).toMatchObject({ type: 'resource' });
  });

  it('errors out when design_path is given but does not exist', () => {
    const r = openInEditor({ design_path: path.join(tmpDir, 'missing.design.yaml') });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });
});
