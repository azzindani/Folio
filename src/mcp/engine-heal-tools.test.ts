import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

import { healDesign } from './engine-heal-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { diagnoseDesign } from './engine-export-tools';
import type { ShorthandLayer } from './shorthand-helpers';
import type { DesignSpec, Layer } from '../schema/types';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-heal-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'hl');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;
const write = (p: string, d: DesignSpec): void => fs.writeFileSync(p, yaml.dump(d), 'utf-8');
const errors = (p: string): number => ((diagnoseDesign({ design_path: p }) as unknown as Rec)['counts'] as Rec)['errors'] as number;

function poster(name: string, w = 1080, h = 1350): string {
  if (!fs.existsSync(projectDir)) createProject({ name: 'hl', canvas: '1080x1350' });
  const d = createDesign({ project_path: projectDir, name: `${name}-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: w, height: h }) as unknown as Rec;
  return d['path'] as string;
}

describe('self-heal — spatial correctness', () => {
  it('pulls a stranded hand-placed layer back onto the canvas', () => {
    const p = poster('stray');
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 'lost', type: 'text', z: 1, x: 80, y: 4000, width: 900, height: 120, content: { type: 'plain', value: 'Off the bottom' }, style: { font_size: 40, color: '#FAFAFA' } },
    ] as unknown as Layer[] });
    // Force it back off-canvas in case a compose-time rescue already moved it.
    const d = read(p);
    const lost = (d.layers ?? []).find(l => l.id === 'lost') as unknown as Rec;
    lost['y'] = 4000;
    write(p, d);
    expect(errors(p)).toBeGreaterThan(0);

    const r = healDesign({ design_path: p }) as unknown as Rec;
    expect(r['errors_after']).toBe(0);
    expect((r['fixed'] as string[]).join(' ')).toMatch(/pulled "lost" back onto the canvas/);
  });

  it('raises sub-legible text to the 14px floor', () => {
    const p = poster('tiny');
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 'small', type: 'text', z: 1, x: 80, y: 200, width: 900, height: 40, content: { type: 'plain', value: 'Fine print' }, style: { font_size: 8, color: '#FAFAFA' } },
    ] as unknown as Layer[] });
    const r = healDesign({ design_path: p }) as unknown as Rec;
    expect((r['fixed'] as string[]).join(' ')).toMatch(/raised text "small" from 8px to 14px/);
    const style = ((read(p).layers ?? []).find(l => l.id === 'small') as unknown as Rec)['style'] as Rec;
    expect(style['font_size']).toBe(14);
  });

  // The fix only the spec round-trip makes possible: rebuild the preset for the
  // canvas it actually has, instead of shoving its generated children inside.
  it('re-lays out a preset whose content escaped the canvas, from its spec', () => {
    const p = poster('overflow', 1920, 1080);
    addLayers({ design_path: p, layers_shorthand: [{
      id: 's1', type: 'sections', z: 0, pos: [0, 0, 1920, 1080], bg: '#0A0A0A', accent: '#FF6B35',
      title: 'Air Cargo Performance', subtitle: 'Volume and yield.',
      blocks: [{ kind: 'text', heading: 'Volume', text: 'Tonnage rose 8.4% year on year across transpacific lanes.' }],
    } as unknown as ShorthandLayer] });

    // Simulate the pre-fix state: the group claims the canvas while its children
    // draw far below it — the "0 errors on a clipped deck" shape.
    const d = read(p);
    const group = (d.layers ?? [])[0] as unknown as Rec;
    for (const c of (group['layers'] as Rec[])) if (typeof c['y'] === 'number') c['y'] = (c['y'] as number) + 1400;
    write(p, d);
    expect(errors(p)).toBeGreaterThan(0);

    const r = healDesign({ design_path: p }) as unknown as Rec;
    expect((r['fixed'] as string[]).join(' ')).toMatch(/re-laid out preset "s1"/);
    expect(r['errors_after']).toBe(0);
    // Rebuilt, not shoved: it still carries its spec, so the loop stays closed.
    expect(((read(p).layers ?? [])[0] as unknown as Rec)['_spec']).toBeDefined();
  });
});

describe('self-heal — the loop', () => {
  it('stops as soon as a pass fixes nothing, rather than spinning', () => {
    const p = poster('clean');
    addLayers({ design_path: p, layers_shorthand: [{
      id: 's1', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF6B35',
      title: 'Clean', blocks: [{ kind: 'text', text: 'Nothing wrong here.' }],
    } as unknown as ShorthandLayer] });
    const r = healDesign({ design_path: p, max_rounds: 5 }) as unknown as Rec;
    expect((r['rounds'] as unknown[]).length).toBeLessThanOrEqual(2);
  });

  it('reports each round with the error count before and after', () => {
    const p = poster('rounds');
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 'small', type: 'text', z: 1, x: 80, y: 200, width: 900, height: 40, content: { type: 'plain', value: 'Fine print' }, style: { font_size: 6, color: '#FAFAFA' } },
    ] as unknown as Layer[] });
    const r = healDesign({ design_path: p }) as unknown as Rec;
    const rounds = r['rounds'] as { round: number; errors_before: number; errors_after: number; fixed: string[] }[];
    expect(rounds[0].round).toBe(1);
    expect(typeof rounds[0].errors_before).toBe('number');
  });

  it('dry_run reports the plan without writing', () => {
    const p = poster('dry');
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 'small', type: 'text', z: 1, x: 80, y: 200, width: 900, height: 40, content: { type: 'plain', value: 'Fine print' }, style: { font_size: 8, color: '#FAFAFA' } },
    ] as unknown as Layer[] });
    const r = healDesign({ design_path: p, dry_run: true }) as unknown as Rec;
    expect((r['would_fix'] as string[]).length).toBeGreaterThan(0);
    const style = ((read(p).layers ?? []).find(l => l.id === 'small') as unknown as Rec)['style'] as Rec;
    expect(style['font_size']).toBe(8);
  });

  it('says plainly when a clean design needed nothing', () => {
    const p = poster('nothing');
    addLayers({ design_path: p, layers_shorthand: [{
      id: 's1', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A',
      title: 'Fine', blocks: [{ kind: 'text', text: 'All good.' }],
    } as unknown as ShorthandLayer] });
    const r = healDesign({ design_path: p }) as unknown as Rec;
    expect(r['errors_after']).toBe(0);
    expect((r['next_action'] as Rec)['tool']).toBe('seal_design');
  });
});

describe('self-heal — the line it does not cross (CLAUDE.md §0.4)', () => {
  it('hands aesthetic findings back instead of deciding them', () => {
    const p = poster('judge');
    // Sparse + accent-heavy: the critic fires, but none of it is a correctness bug.
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: { type: 'solid', color: '#101010' } },
      { id: 't', type: 'text', z: 1, x: 80, y: 200, width: 900, height: 120, content: { type: 'plain', value: 'One line' }, style: { font_size: 64, color: '#FAFAFA' } },
    ] as unknown as Layer[] });
    const r = healDesign({ design_path: p }) as unknown as Rec;
    const judge = (r['for_you_to_judge'] ?? []) as { code: string }[];
    if (judge.length) {
      expect(String(r['note'])).toMatch(/design decisions, not correctness bugs/);
      // Nothing aesthetic was silently "fixed".
      expect((r['fixed'] as string[]).join(' ')).not.toMatch(/accent|hierarchy|palette/i);
    }
  });

  it('does not touch the palette while healing geometry', () => {
    const p = poster('palette');
    addLayers({ design_path: p, layers_shorthand: [{
      id: 's1', type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF5C8A',
      title: 'Keep my colours', blocks: [{ kind: 'text', text: 'The loop fixes geometry, not taste.' }],
    } as unknown as ShorthandLayer] });
    healDesign({ design_path: p });
    const spec = ((read(p).layers ?? [])[0] as unknown as Rec)['_spec'] as Rec;
    expect(spec['accent']).toBe('#FF5C8A');
    expect(spec['bg']).toBe('#0A0A0A');
  });
});
