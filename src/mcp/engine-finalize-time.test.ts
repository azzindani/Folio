import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { placedInTime } from './engine-finalize-time';
import type { DesignSpec, Layer } from '../schema/types';

// The one-shot proof piece (stop-forwarding): three beats in one space — the cover's line,
// the problem's headline, the payoff — were "healed" apart as if they were one pile.

let root = '', dPath = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-time-'));
  process.env['FOLIO_PROJECTS_DIR'] = root;
  createProject({ name: 'p', canvas: '1080x1350' });
  dPath = (createDesign({ project_path: 'p', name: 'd', type: 'poster', width: 1080, height: 1350 }) as unknown as { path: string }).path;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env['FOLIO_PROJECTS_DIR'];
});

const text = (id: string, y: number, h: number, value: string, rule?: unknown): Layer => ({
  id, type: 'text', z: 5, x: 90, y, width: 900, height: h, content: { type: 'plain', value },
  style: { font_family: 'Inter', font_size: 88, font_weight: 800, color: '#1F2A36' }, ...(rule ? { animation: { rule } } : {}),
} as unknown as Layer);
const beats = (timed: boolean): Layer[] => [
  { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#EEF4F8' } as unknown as Layer,
  text('cover', 290, 120, 'Start routing.', timed ? { preset: 'fade_out', at: 3000, duration: 300 } : undefined),
  text('problem', 180, 200, 'Every forward adds a day.', timed ? [{ preset: 'rise', at: 3700 }, { preset: 'fade_out', at: 11800 }] : undefined),
  text('payoff', 300, 230, 'Zero forwarded threads.', timed ? { preset: 'rise', at: 20550 } : undefined),
];
const ys = (): Record<string, number> => Object.fromEntries(((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? [])
  .filter(l => l.type === 'text').map(l => [l.id, Number((l as { y?: number }).y)]));

describe('rescue passes and layers placed for a moment', () => {
  it('leave beats that share a space at different times exactly where they were put', () => {
    const r = addLayers({ design_path: dPath, layers: beats(true) });
    expect(r.success).toBe(true);
    expect(ys()).toEqual({ cover: 290, problem: 180, payoff: 300 });
  });

  it('still pull apart the same layers when nothing says they take turns', () => {
    addLayers({ design_path: dPath, layers: beats(false) });
    expect(ys()).not.toEqual({ cover: 290, problem: 180, payoff: 300 });
  });

  it('reads the time from a span, an entrance or exit rule, or keyed opacity — not from a loop', () => {
    const L = (o: Record<string, unknown>): Layer => ({ id: 'x', type: 'text', ...o } as unknown as Layer);
    expect(placedInTime(L({ out: 4000 }))).toBe(true);
    expect(placedInTime(L({ animation: { rule: [{ preset: 'rise', at: 100 }] } }))).toBe(true);
    expect(placedInTime(L({ animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }] } }))).toBe(true);
    expect(placedInTime(L({ animation: { rule: { preset: 'float' } } }))).toBe(false);
    expect(placedInTime(L({ animation: { keyframes: [{ t: 0, x: 0 }, { t: 400, x: 60 }] } }))).toBe(false);
  });
});
