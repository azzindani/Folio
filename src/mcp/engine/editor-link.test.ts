import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildEditorLink, buildReportViewLink } from './editor-link';
import { buildHandover } from './utils';
import { createDesign, sealDesign, addLayers } from '../engine';

describe('buildEditorLink', () => {
  it('builds a tokenized, self-contained editor URL', () => {
    const link = buildEditorLink('/tmp/x.design.yaml');
    expect(link.open_url).toContain('file=');
    expect(link.open_url).toContain('mcp_url=');
    expect(link.open_url).toMatch(/[?&]token=/);
    expect(link.attachment).toMatchObject({ type: 'resource' });
  });

  it('mints a UNIQUE token on every call', () => {
    const a = buildEditorLink('/tmp/x.design.yaml').open_url;
    const b = buildEditorLink('/tmp/x.design.yaml').open_url;
    const tok = (u: string) => (u.match(/token=([^&]+)/) ?? [])[1];
    expect(tok(a)).toBeTruthy();
    expect(tok(a)).not.toBe(tok(b));
  });

  it('encodes a page index when given', () => {
    expect(buildEditorLink('/tmp/x.design.yaml', { page: 2 }).open_url).toContain('page=2');
  });

  it('also returns a SHORT /o/<code> link (no token, mangle-proof) for a real design', () => {
    const link = buildEditorLink('/tmp/x.design.yaml', { editorUrl: 'https://folio.casava.space' });
    expect(link.short_url).toMatch(/^https:\/\/folio\.casava\.space\/o\/[A-Za-z0-9_-]+$/);
    expect(link.short_url).not.toContain('token=');      // no JWT in the string the model copies
    expect(link.short_url!.length).toBeLessThan(60);     // short enough a 30B can't truncate it
    // the same design ⇒ the same stable short link (idempotent across re-seals)
    expect(buildEditorLink('/tmp/x.design.yaml', { editorUrl: 'https://folio.casava.space' }).short_url).toBe(link.short_url);
    // the rich attachment leads with the short link, not the long one
    const att = link.attachment;
    expect(att.type).toBe('resource');
    if (att.type === 'resource') expect(att.resource.uri).toBe(link.short_url);
  });

  it('omits short_url for a bare (no-design) editor link', () => {
    expect(buildEditorLink().short_url).toBeUndefined();
  });
});

describe('buildReportViewLink', () => {
  const PD = process.env['FOLIO_PROJECTS_DIR'];
  beforeEach(() => { process.env['FOLIO_PROJECTS_DIR'] = '/home/folio/projects'; });
  afterEach(() => { if (PD === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = PD; });

  it('serves the report HTML via /__project_files with a fresh token', () => {
    const v = buildReportViewLink('/home/folio/projects/p/designs/r.report.html', { baseUrl: 'https://folio.casava.space' });
    expect(v.view_url).toBe('https://folio.casava.space/__project_files/p/designs/r.report.html?token=' + (v.view_url.match(/token=([^&]+)/) ?? [])[1]);
    expect(v.view_url).toContain('/__project_files/p/designs/r.report.html');
    expect(v.view_url).toMatch(/[?&]token=.+/);
    expect(v.attachment).toMatchObject({ type: 'resource' });
  });

  it('mints a unique token per call', () => {
    const tok = (u: string) => (u.match(/token=([^&]+)/) ?? [])[1];
    const a = buildReportViewLink('/home/folio/projects/p/x.report.html').view_url;
    const b = buildReportViewLink('/home/folio/projects/p/x.report.html').view_url;
    expect(tok(a)).toBeTruthy();
    expect(tok(a)).not.toBe(tok(b));
  });

  it('percent-encodes path segments with spaces', () => {
    const v = buildReportViewLink('/home/folio/projects/my proj/a b.report.html', { baseUrl: 'https://h' });
    expect(v.view_url).toContain('/__project_files/my%20proj/a%20b.report.html');
  });
});

describe('design tools surface an editor open_url', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-el-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('create_design returns open_url + a resource attachment + a correct next_action', () => {
    const r = createDesign({ project_path: tmp, name: 'P', type: 'poster' }) as Record<string, unknown>;
    expect(typeof r['open_url']).toBe('string');
    expect((r['open_url'] as string)).toMatch(/token=/);
    expect((r['next_action'] as { tool: string }).tool).toBe('add_layers');
    expect(Array.isArray(r['_attachments'])).toBe(true);
  });

  it('carousel create_design routes next_action to append_page', () => {
    const r = createDesign({ project_path: tmp, name: 'C', type: 'carousel' }) as Record<string, unknown>;
    expect((r['next_action'] as { tool: string }).tool).toBe('append_page');
  });

  it('seal_design returns an open_url', () => {
    const d = createDesign({ project_path: tmp, name: 'S', type: 'poster' })['path'] as string;
    addLayers({ design_path: d, layers_shorthand: [
      { id: 'r', type: 'rect', z: 0, pos: [0, 0, 100, 100], fill: '#111' },
      { id: 't', type: 'text', z: 1, pos: [10, 10, 80, 30], text: 'Hello' },
    ] as never });
    const r = sealDesign({ design_path: d }) as Record<string, unknown>;
    expect((r['open_url'] as string)).toMatch(/token=/);
  });
});

describe('type-aware handover', () => {
  it('does NOT suggest append_page for a poster', () => {
    const hw = buildHandover('DESIGN', { design_path: '/x.yaml' }, { type: 'poster' });
    expect(hw.suggested_next.map(s => s.tool)).not.toContain('append_page');
    expect(hw.suggested_next.map(s => s.tool)).toContain('add_layers');
  });

  it('suggests append_page for a carousel', () => {
    const hw = buildHandover('DESIGN', { design_path: '/x.yaml' }, { type: 'carousel' });
    expect(hw.suggested_next.map(s => s.tool)).toContain('append_page');
  });
});
