import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

  it('returns ok for a valid presentation design (gif)', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'gif' });
    expect(r.success).toBe(true);
    expect(r['type']).toBe('gif');
  });

  it('returns ok for mp4 type', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'mp4' });
    expect(r.success).toBe(true);
    expect(r['type']).toBe('mp4');
  });

  it('returns ok for webm type', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'webm' });
    expect(r.success).toBe(true);
    expect(r['type']).toBe('webm');
  });

  it('includes hint with ffmpeg_available', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'gif' });
    expect(r.success).toBe(true);
    expect(typeof r['ffmpeg_available']).toBe('boolean');
    expect(typeof r['hint']).toBe('string');
  });

  it('uses custom output_path when provided', () => {
    const dPath = makePresentationDesign();
    const outPath = path.join(tmpDir, 'exports', 'custom.gif');
    const r = exportAnimation({ design_path: dPath, type: 'gif', output_path: outPath });
    expect(r.success).toBe(true);
    expect(r['output_path']).toBe(outPath);
  });

  it('uses custom fps', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'gif', fps: 15 });
    expect(r['fps']).toBe(15);
  });

  it('defaults fps to 10 for gif', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'gif' });
    expect(r['fps']).toBe(10);
  });

  it('defaults fps to 30 for mp4', () => {
    const dPath = makePresentationDesign();
    const r = exportAnimation({ design_path: dPath, type: 'mp4' });
    expect(r['fps']).toBe(30);
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
