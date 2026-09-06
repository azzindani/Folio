import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serializeYAML } from '../schema/parser';
import { sealDesign } from './engine-edit-tools';
import { finalizePageLayers } from './engine-finalize-pages';
import { diagnoseDesign } from './engine-export-tools';
import { collectFindings, errorFindings } from './engine/diagnose-collect';
import type { DesignSpec } from '../schema/types';

// Pass 25 turned the engine on its own corpus: 276 real designs, diagnosed.
// 269 came back clean and none threw — but all 7 with errors were `_mode:
// complete`, i.e. SEALED, one of them with 109 clipped layers. seal_design
// refuses a blank poster and a blank carousel page, runs its rescue sweep, and
// never asks the diagnosis. Live, back to back:
//
//   diagnose_design → "1 error(s) + 0 warning(s) to fix."
//   seal_design     → status: sealed, remaining: 0,
//                     "give the user this link EXACTLY as written"

let dir = '';
const BG = { id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, fill: '#FAF5EC', z: 0 };
const HEAD = { id: 'h', type: 'text', x: 80, y: 120, width: 900, height: 140,
  content: { type: 'text', value: 'A real headline here' }, style: { font_size: 84, color: '#111111' }, z: 1 };
// Starts 40px from the bottom of a 1080px canvas and needs ~168px.
const OFF = { id: 'runoff', type: 'text', x: 80, y: 1020, width: 900, height: 220,
  content: { type: 'text', value: 'This paragraph starts near the bottom edge and runs well past it, so most of it is clipped away entirely.' },
  style: { font_size: 40, color: '#111111' }, z: 2 };

function design(name: string, layers: unknown[]): string {
  const p = path.join(dir, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, serializeYAML({
    _protocol: 'design/v1', _mode: 'in_progress', meta: { id: name, name, type: 'poster' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers,
  }));
  return p;
}
const seal = (p: string): Record<string, unknown> =>
  sealDesign({ design_path: p }) as unknown as Record<string, unknown>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-seal-'));
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('sealing a design whose own diagnosis reports errors', () => {
  it('says so, instead of reporting a clean seal', () => {
    const p = design('broken', [BG, HEAD, OFF]);
    const r = seal(p);
    expect(r['status']).toBe('sealed_with_errors');
    expect(r['unresolved_count']).toBe(1);
    const first = (r['unresolved'] as Array<{ code: string }>)[0];
    expect(first?.code).toBe('off_canvas');
  });

  it('points at the fix, NOT at the share link', () => {
    const r = seal(design('broken', [BG, HEAD, OFF]));
    const na = r['next_action'] as { tool: string; remaining: number; hint: string };
    expect(na.tool).toBe('diagnose_design');
    expect(na.remaining).toBe(1);
    expect(na.hint).toMatch(/do NOT share the link yet/);
  });

  it('still seals — refusing would strand a model on an error it cannot fix', () => {
    const p = design('broken', [BG, HEAD, OFF]);
    expect(seal(p)['success']).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toMatch(/_mode: complete/);
  });

  it('leaves a clean design exactly as it was', () => {
    const r = seal(design('clean', [BG, HEAD]));
    expect(r['status']).toBe('sealed');
    expect(r['unresolved']).toBeUndefined();
    expect(r['unresolved_count']).toBeUndefined();
    const na = r['next_action'] as { tool: string; remaining: number; hint: string };
    expect(na.tool).toBe('export_design');
    expect(na.remaining).toBe(0);
    expect(na.hint).toMatch(/give the user this link/);
  });

  it('counts what the rescue sweep could NOT fix, not what came in', () => {
    // seal's own sweep re-lights, reflows and de-collides before this runs, so a
    // problem it repairs must not be reported as unresolved.
    const dark = { id: 'd', type: 'text', x: 80, y: 400, width: 900, height: 80,
      content: { type: 'text', value: 'Low contrast on purpose' }, style: { font_size: 48, color: '#FAF5EC' }, z: 2 };
    const r = seal(design('swept', [BG, HEAD, dark]));
    expect(r['status']).toBe('sealed');
  });
});

describe('the rescue sweep must not push content off the page', () => {
  // Found by the new gate the moment it was wired: an existing fixture started
  // reporting an error. An icon the model placed at y=180 sat at y=898 after
  // add_layers (de-collide moved it clear of the preset copy) and at y=1095 —
  // wholly outside a 1080px canvas — after seal ran the same chain again.
  // add_layers has always snapped a fully-off-canvas layer back; the chain
  // seal_design runs never did. Which of its siblings never got told.
  it('snaps a layer the reflow pushed clean off the bottom', () => {
    const layers = [
      { ...BG },
      { id: 'stray', type: 'text', x: 80, y: 1200, width: 900, height: 120,
        content: { type: 'plain', value: 'Pushed past the edge' }, style: { font_size: 40, color: '#111111' }, z: 1 },
    ] as never;
    const t = finalizePageLayers(layers, 1080, 1080);
    expect(t.snapped).toBe(1);
    const stray = (layers as unknown as Array<Record<string, unknown>>)[1];
    expect(Number(stray?.['y'])).toBeLessThan(1080);
  });

  it('leaves a layer that only PARTLY bleeds alone — bleed is a design move', () => {
    const layers = [
      { ...BG },
      { id: 'bleed', type: 'image', x: 900, y: 400, width: 400, height: 300, src: 'x.png', z: 1 },
    ] as never;
    expect(finalizePageLayers(layers, 1080, 1080).snapped).toBe(0);
    expect(Number((layers as unknown as Array<Record<string, unknown>>)[1]?.['x'])).toBe(900);
  });
});

describe('the gate and the diagnosis share one composition', () => {
  // Restating the list of checks in seal would have been this session's
  // most-repeated mistake — a rule with two implementations, drifting.
  it('errorFindings is exactly diagnose_design\'s errors', () => {
    const p = design('broken', [BG, HEAD, OFF]);
    const spec = JSON.parse(JSON.stringify({
      _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 }, layers: [BG, HEAD, OFF],
    })) as DesignSpec;
    const viaCollect = errorFindings(spec, p).map(f => `${f.code}:${f.layer_id}`).sort();
    const r = diagnoseDesign({ design_path: p }) as unknown as { findings?: Array<{ code: string; severity: string; layer_id?: string }> };
    const viaDiagnose = (r.findings ?? []).filter(f => f.severity === 'error').map(f => `${f.code}:${f.layer_id}`).sort();
    expect(viaCollect).toEqual(viaDiagnose);
    expect(viaCollect.length).toBeGreaterThan(0);
  });

  it('scoping to a page keeps only that page\'s findings', () => {
    const spec = {
      _protocol: 'design/v1', meta: { id: 'c', name: 'c', type: 'carousel' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      pages: [{ id: 'p1', layers: [BG, HEAD] }, { id: 'p2', layers: [BG, HEAD, OFF] }],
    } as unknown as DesignSpec;
    const p2 = collectFindings(spec, path.join(dir, 'designs', 'c.design.yaml'), undefined, 'p2');
    expect(p2.every(f => f.page === 'p2')).toBe(true);
    expect(p2.some(f => f.code === 'off_canvas')).toBe(true);
    const p1 = collectFindings(spec, path.join(dir, 'designs', 'c.design.yaml'), undefined, 'p1');
    expect(p1.some(f => f.code === 'off_canvas')).toBe(false);
  });
});
