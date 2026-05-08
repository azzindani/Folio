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

  it('encodes the design_path into the URL and includes mcp_url', () => {
    const dPath = createDesign({ project_path: tmpDir, name: 'Editor Link', type: 'poster' })['path'] as string;
    const r = openInEditor({ design_path: dPath });
    expect(r.success).toBe(true);
    const url = r['url'] as string;
    expect(url).toContain('file=');
    expect(url).toContain('mcp_url=');
    expect(decodeURIComponent(url)).toContain(dPath);
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
