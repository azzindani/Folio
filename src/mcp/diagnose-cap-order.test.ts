import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { diagnoseDesign } from './engine-export-tools';

/**
 * What survives the cap has to be what matters most.
 *
 * diagnose caps its findings array at 40 to keep the reply small, and took
 * whichever 40 were gathered FIRST. The passes that run late were therefore cut
 * on any busy design — including the schema validator, which had only just been
 * wired in. On a live 110-error carousel the "Unknown layer type" was collected
 * and never shown: the fix worked and the model still could not see it.
 *
 * `counts` was always honest. The visible list now leads with errors.
 */

let root: string, designPath: string;

/** A design with far more than 40 geometry findings, plus one schema error. */
function busyDesign(): unknown {
  const layers: unknown[] = [
    { id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, z: 0, fill: '#FAF5EC' },
  ];
  // 60 layers hanging off the canvas — plenty to fill the cap on their own.
  for (let i = 0; i < 60; i++) {
    layers.push({ id: `off_${i}`, type: 'rect', x: 2000 + i, y: 2000, width: 300, height: 300, z: 1 });
  }
  // The late-arriving one: not a layer type at all.
  layers.push({ id: 'oops', type: 'bg', x: 0, y: 0, width: 1080, height: 1080, z: 2 });
  return {
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'busy', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cap-'));
  fs.mkdirSync(path.join(root, 'p', 'designs'), { recursive: true });
  designPath = path.join(root, 'p', 'designs', 'busy.design.yaml');
  fs.writeFileSync(designPath, yaml.dump(busyDesign()));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const run = (): Record<string, unknown> =>
  diagnoseDesign({ design_path: designPath }) as unknown as Record<string, unknown>;

describe('the findings cap keeps the worst, not the earliest', () => {
  it('shows the schema error even when 60 geometry findings precede it', () => {
    const r = run();
    const findings = r['findings'] as Array<{ message: string; severity: string }>;
    expect(findings.length).toBeLessThanOrEqual(40);
    expect(findings.some(f => /Unknown layer type/.test(f.message)),
      'a hard schema error was crowded out by geometry findings').toBe(true);
  });

  it('leads with errors — no warning outranks an error in the visible list', () => {
    const findings = (run()['findings'] as Array<{ severity: string }>);
    const rank = { error: 0, warning: 1, suggestion: 2 } as Record<string, number>;
    const ranks = findings.map(f => rank[f.severity] ?? 9);
    expect(ranks, 'the visible list is not severity-ordered')
      .toEqual([...ranks].sort((a, b) => a - b));
  });

  it('still reports the honest total, which was never the broken part', () => {
    const r = run();
    const counts = r['counts'] as { errors: number };
    const findings = r['findings'] as unknown[];
    expect(counts.errors).toBeGreaterThan(findings.length);
    expect(r['findings_truncated']).toBeGreaterThan(0);
  });
});
