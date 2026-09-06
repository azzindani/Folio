import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectTemplate } from './engine-template-tools';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-tmpl-'));
process.env['FOLIO_PROJECTS_DIR'] = root;
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));


describe('inject honours the project it was given', () => {
  // `project_path` is advertised on the templates tool and was accepted and
  // ignored: every injected design landed loose in the projects ROOT, beside
  // the project directories and inside none of them. Six had accumulated there
  // from earlier sessions, invisible to manage_design {op:"list"} and to
  // style_history, which both read a project's designs/ dir.
  it('writes into <project>/designs, not the projects root', () => {
    const proj = path.join(root, 'p1');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    const r = injectTemplate({
      template_path: 'tmpl-document-cover',
      slots: { title: 'In The Project' },
      project_path: proj,
    }) as Record<string, unknown>;
    expect(r['success'], JSON.stringify(r)).toBe(true);
    const out = String(r['design_path']);
    expect(path.dirname(out)).toBe(path.join(proj, 'designs'));
    expect(fs.existsSync(out)).toBe(true);
  });

  it('says so when the named project does not exist', () => {
    const r = injectTemplate({
      template_path: 'tmpl-document-cover',
      slots: { title: 'x' },
      project_path: path.join(root, 'no-such-project'),
    });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('Project not found');
  });

  it('an explicit output_path still wins', () => {
    const proj = path.join(root, 'p2');
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    const out = path.join(proj, 'designs', 'chosen.design.yaml');
    const r = injectTemplate({
      template_path: 'tmpl-document-cover', slots: { title: 'x' },
      project_path: proj, output_path: out,
    }) as Record<string, unknown>;
    expect(r['design_path']).toBe(out);
  });
});
