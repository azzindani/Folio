import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createPresentation, exportPresentation } from '../engine';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pres-test-'));
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('createPresentation', () => {
  it('creates a .design.yaml in designs/ subdir', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'My Deck',
      pages: [{ label: 'Intro' }, { label: 'Summary' }],
    });
    expect(r.success).toBe(true);
    expect(r['design_path']).toBeTruthy();
    expect(fs.existsSync(r['design_path'] as string)).toBe(true);
  });

  it('returns slide_count matching input pages', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Three Slides',
      pages: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    });
    expect(r['slide_count']).toBe(3);
  });

  it('defaults to 1920×1080 dimensions', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Default Size',
      pages: [{ label: 'S1' }],
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('1920');
    expect(raw).toContain('1080');
  });

  it('respects custom width/height', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Custom Size',
      pages: [{ label: 'S1' }],
      width: 1280,
      height: 720,
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('1280');
    expect(raw).toContain('720');
  });

  it('embeds transition in pages when provided', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Zoomy',
      pages: [{ label: 'S1' }, { label: 'S2' }],
      transition: 'zoom-in',
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('zoom-in');
  });

  it('uses provided page ids when given', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Custom IDs',
      pages: [{ id: 'hero', label: 'Hero' }, { id: 'detail', label: 'Detail' }],
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('hero');
    expect(raw).toContain('detail');
  });

  it('auto-generates slide IDs when not provided', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'AutoId',
      pages: [{ label: 'X' }, { label: 'Y' }],
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('slide_1');
    expect(raw).toContain('slide_2');
  });

  it('embeds auto_advance setting', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Auto Advance',
      pages: [{ label: 'S1' }],
      auto_advance: 3000,
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('3000');
  });

  it('fails when project_path does not exist', () => {
    const r = createPresentation({
      project_path: '/nonexistent/xyz',
      name: 'Fail',
      pages: [{ label: 'S1' }],
    });
    expect(r.success).toBe(false);
  });

  it('sets type: presentation in meta', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Type Check',
      pages: [{ label: 'S1' }],
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('presentation');
  });

  it('includes presentation settings block', () => {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Settings',
      pages: [{ label: 'S1' }],
    });
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('show_controls');
    expect(raw).toContain('keyboard');
  });
});

describe('exportPresentation', () => {
  function makePresentation(): string {
    const r = createPresentation({
      project_path: tmpDir,
      name: 'Export Test',
      pages: [{ label: 'Slide 1' }, { label: 'Slide 2' }],
      transition: 'fade',
    });
    return r['design_path'] as string;
  }

  it('exports a presentation design as HTML file', () => {
    const dPath = makePresentation();
    const outPath = path.join(tmpDir, 'out.html');
    const r = exportPresentation({ design_path: dPath, output_path: outPath });
    expect(r.success).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
    const html = fs.readFileSync(outPath, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('auto-derives output path from design path', () => {
    const dPath = makePresentation();
    const r = exportPresentation({ design_path: dPath });
    expect(r.success).toBe(true);
    const outPath = r['output_path'] as string;
    expect(outPath).toContain('.presentation.html');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns bytes and slide_count', () => {
    const dPath = makePresentation();
    const r = exportPresentation({ design_path: dPath, output_path: path.join(tmpDir, 'x.html') });
    expect(r.success).toBe(true);
    expect((r['bytes'] as number) > 0).toBe(true);
    expect(r['slide_count']).toBe(2);
  });

  it('applies theme override', () => {
    const dPath = makePresentation();
    const outPath = path.join(tmpDir, 'light.html');
    const r = exportPresentation({ design_path: dPath, output_path: outPath, theme: 'light' });
    expect(r.success).toBe(true);
    const html = fs.readFileSync(outPath, 'utf-8');
    expect(html).toContain('data-theme="light"');
  });

  it('fails when design_path does not exist', () => {
    const r = exportPresentation({ design_path: path.join(tmpDir, 'missing.design.yaml') });
    expect(r.success).toBe(false);
  });

  it('fails when design type is not presentation/carousel/motion', () => {
    const dPath = path.join(tmpDir, 'poster.design.yaml');
    const yaml = `_protocol: "design/v1"\nmeta:\n  id: "x"\n  name: "Poster"\n  type: "poster"\n  created: ""\n  modified: ""\ndocument:\n  width: 1080\n  height: 1080\n  unit: "px"\nlayers: []\n`;
    fs.mkdirSync(path.dirname(dPath), { recursive: true });
    fs.writeFileSync(dPath, yaml);
    const r = exportPresentation({ design_path: dPath });
    expect(r.success).toBe(false);
    expect(r.error).toContain('not supported');
  });

  it('exports carousel-type design', () => {
    const dPath = path.join(tmpDir, 'c.design.yaml');
    const yaml = `_protocol: "design/v1"\nmeta:\n  id: "c1"\n  name: "Carousel"\n  type: "carousel"\n  created: ""\n  modified: ""\ndocument:\n  width: 1920\n  height: 1080\n  unit: "px"\nlayers: []\npages:\n  - id: s1\n    label: Slide 1\n    layers: []\n`;
    fs.mkdirSync(path.dirname(dPath), { recursive: true });
    fs.writeFileSync(dPath, yaml);
    const r = exportPresentation({ design_path: dPath, output_path: path.join(tmpDir, 'carousel.html') });
    expect(r.success).toBe(true);
  });

  it('exports motion-type design', () => {
    const dPath = path.join(tmpDir, 'm.design.yaml');
    const yaml = `_protocol: "design/v1"\nmeta:\n  id: "m1"\n  name: "Motion"\n  type: "motion"\n  created: ""\n  modified: ""\ndocument:\n  width: 1920\n  height: 1080\n  unit: "px"\nlayers: []\npages:\n  - id: s1\n    label: Frame 1\n    layers: []\n`;
    fs.mkdirSync(path.dirname(dPath), { recursive: true });
    fs.writeFileSync(dPath, yaml);
    const r = exportPresentation({ design_path: dPath, output_path: path.join(tmpDir, 'motion.html') });
    expect(r.success).toBe(true);
  });
});
