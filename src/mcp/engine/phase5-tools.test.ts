import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';

const readDesign = (p: string): unknown => yaml.load(fs.readFileSync(p, 'utf-8'));
const writeDesign = (p: string, spec: unknown): void => fs.writeFileSync(p, yaml.dump(spec), 'utf-8');
import { exportAnimation, setupRemotePresenter, setupCollab, createPresentation } from '../engine';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-p5-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function makePresentationDesign(): string {
  return createPresentation({
    project_path: tmpDir,
    name: 'Phase5 Test',
    pages: [{ id: 'slide_1', label: 'Slide 1' }, { id: 'slide_2', label: 'Slide 2' }],
  })['design_path'] as string;
}

describe('exportAnimation', () => {
  it('fails when design does not exist', () => {
    const r = exportAnimation({
      design_path: path.join(tmpDir, 'missing.design.yaml'),
      type: 'gif',
    });
    expect(r.success).toBe(false);
  });

  // These cases used to assert success:true for gif/mp4/webm on a host with
  // neither Puppeteer nor ffmpeg, and none of them checked that a file existed.
  // The implementation obliged: it wrote a temp HTML, deleted it, and returned
  // ok with an output_path pointing at nothing, plus a hint naming a CLI
  // (`npx folio export-anim`) that was never built. The tests were the reason
  // that survived. They now assert the two things that actually matter — a real
  // file on disk, or a refusal that says what to do instead.

  describe('binary-free routes', () => {
    for (const type of ['svg', 'html'] as const) {
      it(`type:"${type}" writes a real file`, () => {
        const dPath = makePresentationDesign();
        const r = exportAnimation({ design_path: dPath, type });
        expect(r.success).toBe(true);
        const out = r['output_path'] as string;
        expect(fs.existsSync(out)).toBe(true);
        expect(fs.statSync(out).size).toBeGreaterThan(0);
        expect(r['bytes']).toBeGreaterThan(0);
      });
    }

    it('all_pages writes one file per page, named -p1/-p2', () => {
      const dPath = makePresentationDesign();
      const r = exportAnimation({ design_path: dPath, type: 'svg', all_pages: true });
      expect(r.success).toBe(true);
      const outs = r['output_paths'] as string[];
      expect(outs).toHaveLength(2);
      expect(outs.map(p => path.basename(p))).toEqual(['phase5-test-p1.svg', 'phase5-test-p2.svg']);
      for (const out of outs) expect(fs.statSync(out).size).toBeGreaterThan(0);
      expect(r['pages']).toBe(2);
    });

    it('all_pages on a single-page design falls back to the normal one-file export', () => {
      const dPath = makePresentationDesign();
      const spec = readDesign(dPath) as { pages: unknown[] };
      spec.pages = spec.pages.slice(0, 1);
      writeDesign(dPath, spec);
      const r = exportAnimation({ design_path: dPath, type: 'svg', all_pages: true });
      expect(r.success).toBe(true);
      expect(r['output_paths']).toBeUndefined();
      expect(fs.existsSync(r['output_path'] as string)).toBe(true);
    });

    it('writes SVG content for type:"svg"', () => {
      const dPath = makePresentationDesign();
      const r = exportAnimation({ design_path: dPath, type: 'svg' });
      expect(fs.readFileSync(r['output_path'] as string, 'utf-8')).toContain('<svg');
    });

    it('wraps the SVG in a document for type:"html"', () => {
      const dPath = makePresentationDesign();
      const r = exportAnimation({ design_path: dPath, type: 'html' });
      const html = fs.readFileSync(r['output_path'] as string, 'utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<svg');
    });

    it('warns when the design has no animation rather than implying motion', () => {
      const dPath = makePresentationDesign();
      const r = exportAnimation({ design_path: dPath, type: 'svg' });
      expect(r['animated_layers']).toEqual([]);
      expect(String(r['warning'])).toContain('still image');
    });

    it('inlines project assets instead of leaving a relative href', () => {
      // Live bug: these routes called renderToSVGString directly and skipped
      // the asset resolution export_design has always done, so the file went
      // out carrying src="assets/images/logo.png" — which resolves to nothing
      // once it leaves the project directory. The export looked successful and
      // the image was simply missing.
      const dPath = makePresentationDesign();
      const projDir = path.dirname(path.dirname(dPath));
      const imgDir = path.join(projDir, 'assets', 'images');
      fs.mkdirSync(imgDir, { recursive: true });
      // A 1x1 PNG is enough — what matters is whether the href gets inlined.
      fs.writeFileSync(path.join(imgDir, 'dot.png'), Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'));

      const spec = JSON.parse(JSON.stringify(readDesign(dPath))) as Record<string, unknown>;
      const pages = spec['pages'] as { layers?: unknown[] }[];
      const target = pages?.[0] ?? (spec as { layers?: unknown[] });
      target.layers = [...(target.layers ?? []), {
        id: 'img', type: 'image', z: 5, x: 10, y: 10, width: 40, height: 40,
        src: 'assets/images/dot.png',
      }];
      writeDesign(dPath, spec);

      const r = exportAnimation({ design_path: dPath, type: 'svg' });
      const svg = fs.readFileSync(r['output_path'] as string, 'utf-8');
      expect(svg).toContain('data:image');
      expect(svg).not.toContain('assets/images/dot.png');
    });

    it('honors a custom output_path', () => {
      const dPath = makePresentationDesign();
      const outPath = path.join(tmpDir, 'exports', 'custom.svg');
      const r = exportAnimation({ design_path: dPath, type: 'svg', output_path: outPath });
      expect(r['output_path']).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
    });
  });

  describe('raster routes', () => {
    const hasDeps = ((): boolean => {
      try { require.resolve('puppeteer'); } catch { return false; }
      try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch { return false; }
      return true;
    })();

    // gif is no longer in this group: it is rendered and LZW-encoded in-process,
    // so it works on a host with neither binary. Only the video formats still
    // need Puppeteer to capture frames and ffmpeg to encode them.
    for (const type of ['mp4', 'webm'] as const) {
      it(`type:"${type}" refuses clearly when the host lacks the binaries`, () => {
        if (hasDeps) return; // the refusal path is unreachable here
        const dPath = makePresentationDesign();
        const r = exportAnimation({ design_path: dPath, type });
        expect(r.success).toBe(false);
        // The refusal has to name the way forward, not just the problem.
        expect(String(r['hint'] ?? r['error'])).toContain('svg');
      });
    }

    it('reports fps defaults when the host can encode', () => {
      if (!hasDeps) return;
      const dPath = makePresentationDesign();
      expect(exportAnimation({ design_path: dPath, type: 'mp4' })['fps']).toBe(30);
    });
  });

  describe('gif', () => {
    it('says a still design has nothing to animate rather than writing one frame', () => {
      const r = exportAnimation({ design_path: makePresentationDesign(), type: 'gif' });
      expect(r.success).toBe(false);
      expect(String(r['error'])).toMatch(/nothing is animated|Nothing in this design is animated/i);
      expect(String(r['hint'])).toContain('animation(op:motion)');
    });
  });
});

describe('setupRemotePresenter', () => {
  it('returns ok with default port 3737', () => {
    const r = setupRemotePresenter({});
    expect(r.success).toBe(true);
    expect(r['port']).toBe(3737);
  });

  it('uses custom port', () => {
    const r = setupRemotePresenter({ port: 4444 });
    expect(r['port']).toBe(4444);
  });

  it('includes client_script', () => {
    const r = setupRemotePresenter({});
    expect(typeof r['client_script']).toBe('string');
    expect(r['client_script'] as string).toContain('EventSource');
  });

  it('includes curl commands', () => {
    const r = setupRemotePresenter({});
    const cmds = r['commands'] as Record<string, string>;
    expect(cmds.next).toContain('curl');
    expect(cmds.prev).toContain('curl');
    expect(cmds.goto).toContain('curl');
  });

  it('embeds port in client_script', () => {
    const r = setupRemotePresenter({ port: 5555 });
    expect(r['client_script'] as string).toContain('5555');
  });

  it('includes server_start_command', () => {
    const r = setupRemotePresenter({});
    expect(typeof r['server_start_command']).toBe('string');
  });
});

describe('setupCollab', () => {
  it('fails when design does not exist', () => {
    const r = setupCollab({ design_path: path.join(tmpDir, 'missing.design.yaml') });
    expect(r.success).toBe(false);
  });

  it('returns ok with default port 3738', () => {
    const dPath = makePresentationDesign();
    const r = setupCollab({ design_path: dPath });
    expect(r.success).toBe(true);
    expect(r['port']).toBe(3738);
  });

  it('uses custom port', () => {
    const dPath = makePresentationDesign();
    const r = setupCollab({ design_path: dPath, port: 6000 });
    expect(r['port']).toBe(6000);
  });

  it('includes endpoints object', () => {
    const dPath = makePresentationDesign();
    const r = setupCollab({ design_path: dPath });
    const endpoints = r['endpoints'] as Record<string, string>;
    expect(endpoints.events).toContain('/events');
    expect(endpoints.design).toContain('/design');
    expect(endpoints.patch).toContain('/patch');
  });

  it('includes server_start_command', () => {
    const dPath = makePresentationDesign();
    const r = setupCollab({ design_path: dPath });
    expect(typeof r['server_start_command']).toBe('string');
  });

  it('includes design_path in result', () => {
    const dPath = makePresentationDesign();
    const r = setupCollab({ design_path: dPath });
    expect(r['design_path']).toBe(dPath);
  });
});
