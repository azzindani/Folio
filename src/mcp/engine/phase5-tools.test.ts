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
  it('fails when design does not exist', async () => {
    const r = await exportAnimation({
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
      it(`type:"${type}" writes a real file`, async () => {
        const dPath = makePresentationDesign();
        const r = await exportAnimation({ design_path: dPath, type });
        expect(r.success).toBe(true);
        const out = r['output_path'] as string;
        expect(fs.existsSync(out)).toBe(true);
        expect(fs.statSync(out).size).toBeGreaterThan(0);
        expect(r['bytes']).toBeGreaterThan(0);
      });
    }

    it('all_pages writes one file per page, named -p1/-p2', async () => {
      const dPath = makePresentationDesign();
      const r = await exportAnimation({ design_path: dPath, type: 'svg', all_pages: true });
      expect(r.success).toBe(true);
      const outs = r['output_paths'] as string[];
      expect(outs).toHaveLength(2);
      expect(outs.map(p => path.basename(p))).toEqual(['phase5-test-p1.svg', 'phase5-test-p2.svg']);
      for (const out of outs) expect(fs.statSync(out).size).toBeGreaterThan(0);
      expect(r['pages']).toBe(2);
    });

    it('all_pages on a single-page design falls back to the normal one-file export', async () => {
      const dPath = makePresentationDesign();
      const spec = readDesign(dPath) as { pages: unknown[] };
      spec.pages = spec.pages.slice(0, 1);
      writeDesign(dPath, spec);
      const r = await exportAnimation({ design_path: dPath, type: 'svg', all_pages: true });
      expect(r.success).toBe(true);
      expect(r['output_paths']).toBeUndefined();
      expect(fs.existsSync(r['output_path'] as string)).toBe(true);
    });

    it('writes SVG content for type:"svg"', async () => {
      const dPath = makePresentationDesign();
      const r = await exportAnimation({ design_path: dPath, type: 'svg' });
      expect(fs.readFileSync(r['output_path'] as string, 'utf-8')).toContain('<svg');
    });

    it('wraps the SVG in a document for type:"html"', async () => {
      const dPath = makePresentationDesign();
      const r = await exportAnimation({ design_path: dPath, type: 'html' });
      const html = fs.readFileSync(r['output_path'] as string, 'utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<svg');
    });

    it('warns when the design has no animation rather than implying motion', async () => {
      const dPath = makePresentationDesign();
      const r = await exportAnimation({ design_path: dPath, type: 'svg' });
      expect(r['animated_layers']).toEqual([]);
      expect(String(r['warning'])).toContain('still image');
    });

    it('inlines project assets instead of leaving a relative href', async () => {
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

      const r = await exportAnimation({ design_path: dPath, type: 'svg' });
      const svg = fs.readFileSync(r['output_path'] as string, 'utf-8');
      expect(svg).toContain('data:image');
      expect(svg).not.toContain('assets/images/dot.png');
    });

    it('honors a custom output_path', async () => {
      const dPath = makePresentationDesign();
      const outPath = path.join(tmpDir, 'exports', 'custom.svg');
      const r = await exportAnimation({ design_path: dPath, type: 'svg', output_path: outPath });
      expect(r['output_path']).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
    });
  });

  describe('raster routes', () => {
    const hasFfmpeg = ((): boolean => {
      try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch { return false; }
    })();

    /** A size×¾size poster whose one layer rises for 600ms and then holds for `holdMs`. */
    function makeAnimatedDesign(holdMs = 0, size = 64): string {
      const dir = path.join(tmpDir, 'anim', 'designs');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'clip.design.yaml');
      writeDesign(p, {
        _protocol: 'design/v1',
        meta: { id: 'c', name: 'clip', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
        document: { width: size, height: Math.round(size * 0.75), unit: 'px', dpi: 96 },
        layers: [
          { id: 'bg', type: 'rect', x: 0, y: 0, width: size, height: Math.round(size * 0.75), z: 0, fill: '#F4EFE6' },
          { id: 'dot', type: 'rect', x: 20, y: 16, width: 16, height: 16, z: 1, fill: '#2F5BEA',
            animation: { keyframes: [{ t: 0, opacity: 0, y: 12 }, { t: 600, opacity: 1, y: 0 }], playback: { duration: 600 + holdMs } } },
        ],
      });
      return p;
    }

    // The first GIF route capped frames against a memory budget, so a long
    // scene silently lost its frame rate — 30s at 1080×1350 shipped at 1fps.
    // At 2400×1800 that budget held 10 frames, so this request came back at 5fps.
    it('gif keeps the requested frame rate over a long scene, and merges the hold', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(1400, 2400), type: 'gif', fps: 6 });
      expect(r.success).toBe(true);
      expect(r).toMatchObject({ fps: 6, frames: 12, duration: 2000, width: 2400, height: 1800 });
      // 600ms of motion is a few distinct frames; the 1.4s hold is ONE image, not eight.
      expect(r['images_written'] as number).toBeLessThan(12);
      const out = r['output_path'] as string;
      expect(fs.readFileSync(out).subarray(0, 6).toString('ascii')).toBe('GIF89a');
      expect(fs.existsSync(`${out}.partial`)).toBe(false);
    }, 60_000);

    it('clamps an fps a GIF cannot play, and says so', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(), type: 'gif', fps: 120, duration: 100 });
      expect(r['fps']).toBe(50);
      expect(((r['notes'] as string[] | undefined) ?? []).join(' ')).toMatch(/fps 120 .*exported at 50fps/);
    }, 60_000);

    it('refuses a clip longer than the export limit and names the way out', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(), type: 'gif', duration: 90_000 });
      expect(r.success).toBe(false);
      expect(String(r['hint'])).toContain('duration');
    });

    it('refuses an unknown type instead of guessing an encoder', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(), type: 'avi' as never });
      expect(r.success).toBe(false);
      expect(String(r['hint'])).toContain('mp4');
    });

    it.skipIf(!hasFfmpeg)('mp4 writes an H.264 file with one frame per sample', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(400), type: 'mp4', fps: 5 });
      expect(r.success).toBe(true);
      expect(r).toMatchObject({ fps: 5, frames: 5 });
      const probe = execSync(
        `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,nb_read_frames -of csv=p=0 "${String(r['output_path'])}"`,
      ).toString().trim();
      expect(probe).toBe('h264,5');
    }, 60_000);

    it.skipIf(hasFfmpeg)('mp4 refuses clearly on a host without ffmpeg', async () => {
      const r = await exportAnimation({ design_path: makeAnimatedDesign(), type: 'mp4' });
      expect(r.success).toBe(false);
      expect(String(r['error'])).toContain('ffmpeg');
      expect(String(r['hint'])).toContain('gif');
    });
  });

  describe('gif', () => {
    it('says a still design has nothing to animate rather than writing one frame', async () => {
      const r = await exportAnimation({ design_path: makePresentationDesign(), type: 'gif' });
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
