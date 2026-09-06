import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDesign } from './engine-project-tools';
import { createProject } from './engine-project-tools';

/**
 * create_design took `layers`, said success, and made an empty canvas.
 *
 * The tool's contract is a SCAFFOLD — content arrives through add_layers — but
 * most design APIs take layers at create time, so that is what a model passes.
 * The argument is not in the published schema and nothing rejected it either:
 * the whole composition vanished and the reply was a cheerful success plus an
 * editor link to a blank page. Silent drops are the expensive kind, because
 * the caller has no reason to look.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cd-'));
  process.env['FOLIO_PROJECTS_DIR'] = root;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env['FOLIO_PROJECTS_DIR'];
});

const layers = [
  { type: 'text', id: 'title', x: 80, y: 180, width: 900, content: 'Hello', font_size: 72 },
  { type: 'rect', id: 'card', x: 80, y: 400, width: 300, height: 200, fill: '#7C5CFF' },
];

const progressText = (r: unknown): string =>
  JSON.stringify((r as { progress?: unknown[] }).progress ?? []);

describe('create_design does not drop layers in silence', () => {
  beforeEach(() => { createProject({ name: 'p' }); });

  it('says how many layers it did NOT add', () => {
    const r = createDesign({ project_path: 'p', name: 'hero', layers }) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    const text = progressText(r);
    expect(text, 'the layers vanished without a word').toContain('2 layer(s) were NOT added');
    expect(text).toContain('add_layers');
  });

  it('still points the caller at the tool that takes them', () => {
    const r = createDesign({ project_path: 'p', name: 'hero', layers }) as Record<string, unknown>;
    const next = r['next_action'] as { tool?: string } | undefined;
    expect(next?.tool).toBe('add_layers');
  });

  it('stays quiet when no layers were passed — no new noise', () => {
    const r = createDesign({ project_path: 'p', name: 'hero' }) as Record<string, unknown>;
    expect(progressText(r)).not.toContain('NOT added');
  });

  it('is not fooled by an empty array or a non-array', () => {
    for (const bad of [[], 'title', 42, {}, null]) {
      const r = createDesign({ project_path: 'p', name: `d${String(bad)}`.slice(0, 12), layers: bad }) as Record<string, unknown>;
      expect(progressText(r), String(bad)).not.toContain('NOT added');
    }
  });
});
