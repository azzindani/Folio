import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateReport, bindData, exportReport } from '../engine';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-report-test-'));
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('generateReport', () => {
  it('creates a .design.yaml in designs/ subdir', () => {
    const r = generateReport({
      project_path: tmpDir,
      name: 'Q1 Report',
      pages: [{ label: 'Overview' }, { label: 'Details' }],
    });
    expect(r.success).toBe(true);
    expect(r['design_path']).toBeTruthy();
    expect(fs.existsSync(r['design_path'] as string)).toBe(true);
  });

  it('returns page_count matching input', () => {
    const r = generateReport({
      project_path: tmpDir,
      name: 'Short',
      pages: [{ id: 'p1', label: 'Intro' }, { id: 'p2', label: 'Body' }, { id: 'p3', label: 'End' }],
    });
    expect(r['page_count']).toBe(3);
  });

  it('sets report layout from args', () => {
    const r = generateReport({
      project_path: tmpDir,
      name: 'Scroll Report',
      layout: 'scroll',
      pages: [{ label: 'P1' }],
    });
    expect(r.success).toBe(true);
    // File contains layout spec — verify raw content
    const raw = fs.readFileSync(r['design_path'] as string, 'utf-8');
    expect(raw).toContain('scroll');
  });

  it('fails when project_path does not exist', () => {
    const r = generateReport({
      project_path: '/nonexistent/path/xyz',
      name: 'Test',
      pages: [{ label: 'P1' }],
    });
    expect(r.success).toBe(false);
  });

  it('auto-generates page ids when not provided', () => {
    const r = generateReport({
      project_path: tmpDir,
      name: 'AutoId',
      pages: [{ label: 'A' }, { label: 'B' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('bindData', () => {
  function makeReport(): string {
    const r = generateReport({
      project_path: tmpDir,
      name: 'Data Report',
      pages: [{ label: 'P1' }],
    });
    return r['design_path'] as string;
  }

  it('attaches datasets to a report design', () => {
    const dPath = makeReport();
    const r = bindData({
      design_path: dPath,
      datasets: [{ id: 'sales', rows: [{ q: 'Q1', v: 100 }, { q: 'Q2', v: 200 }] }],
    });
    expect(r.success).toBe(true);
    const bound = r['bound'] as { id: string; rows: number }[];
    expect(bound[0].id).toBe('sales');
    expect(bound[0].rows).toBe(2);
  });

  it('updates existing dataset rows on re-bind', () => {
    const dPath = makeReport();
    bindData({ design_path: dPath, datasets: [{ id: 'ds1', rows: [{ v: 1 }] }] });
    const r2 = bindData({ design_path: dPath, datasets: [{ id: 'ds1', rows: [{ v: 2 }, { v: 3 }] }] });
    expect(r2.success).toBe(true);
    expect((r2['bound'] as { rows: number }[])[0].rows).toBe(2);
  });

  it('fails when design_path does not exist', () => {
    const r = bindData({ design_path: path.join(tmpDir, 'no-such.design.yaml'), datasets: [] });
    expect(r.success).toBe(false);
  });
});

describe('exportReport', () => {
  it('exports a report design as HTML file', () => {
    const dPath = generateReport({
      project_path: tmpDir,
      name: 'Export Me',
      pages: [{ label: 'Page 1' }, { label: 'Page 2' }],
    })['design_path'] as string;

    const outPath = path.join(tmpDir, 'out.html');
    const r = exportReport({ design_path: dPath, output_path: outPath });
    expect(r.success).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
    const html = fs.readFileSync(outPath, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('fails when design_path does not exist', () => {
    const r = exportReport({ design_path: path.join(tmpDir, 'nope.design.yaml'), output_path: path.join(tmpDir, 'x.html') });
    expect(r.success).toBe(false);
  });

  it('fails when design is not type report', () => {
    // Write a poster-type design manually
    const dPath = path.join(tmpDir, 'poster.design.yaml');
    const yaml = `_protocol: "design/v1"\nmeta:\n  id: "abc"\n  name: "Poster"\n  type: "poster"\n  created: ""\n  modified: ""\ndocument:\n  width: 1080\n  height: 1080\n  unit: "px"\nlayers: []\n`;
    fs.mkdirSync(path.dirname(dPath), { recursive: true });
    fs.writeFileSync(dPath, yaml);
    const r = exportReport({ design_path: dPath, output_path: path.join(tmpDir, 'out.html') });
    expect(r.success).toBe(false);
    expect(r.error).toContain('report');
  });

  it('covers data-source binding in exportReport', () => {
    const dPath = generateReport({
      project_path: tmpDir,
      name: 'Bound Report',
      pages: [{ label: 'P1' }],
    })['design_path'] as string;
    // Bind inline data so the src.rows path is exercised
    bindData({ design_path: dPath, datasets: [{ id: 'metrics', rows: [{ v: 1 }, { v: 2 }] }] });
    const r = exportReport({ design_path: dPath, output_path: path.join(tmpDir, 'bound.html') });
    expect(r.success).toBe(true);
  });

  it('auto-derives output path from design path', () => {
    const dPath = generateReport({
      project_path: tmpDir,
      name: 'Auto Out',
      pages: [{ label: 'P1' }],
    })['design_path'] as string;

    const r = exportReport({ design_path: dPath });
    expect(r.success).toBe(true);
    const outPath = r['output_path'] as string;
    expect(outPath).toContain('.report.html');
    expect(fs.existsSync(outPath)).toBe(true);
  });
});
