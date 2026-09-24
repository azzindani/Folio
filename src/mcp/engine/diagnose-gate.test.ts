// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { ALL_HANDLERS } from '../handlers';
import { rankGate, type GateItem } from './diagnose-gate';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-gate-'));
fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

interface Gate { ready: boolean; verdict: string; healed?: string[]; counts: Record<string, number>; top: GateItem[]; next_action: { tool: string; params: Record<string, unknown> } }
const call = async (tool: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const h = ALL_HANDLERS[tool];
  if (!h) throw new Error(`no ${tool}`);
  return (await h(params)) as unknown as Record<string, unknown>;
};
const gate = async (design: string): Promise<Gate> => (await call('diagnose_design', { design_path: design, gate: true })) as unknown as Gate;
const write = (name: string, spec: object): string => {
  const p = path.join(root, 'designs', `${name}.design.yaml`);
  fs.writeFileSync(p, yaml.dump(spec));
  return p;
};
const text = (id: string, x: number, y: number, value: string, extra: object = {}): object =>
  ({ id, type: 'text', z: 5, x, y, width: 700, height: 90, content: { type: 'plain', value }, style: { font_family: 'Inter', font_size: 64, font_weight: 700, color: '#111111' }, ...extra });
const ground = (w: number, h: number): object => ({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: w, height: h, fill: '#FAF5EC' });
const doc = (w: number, h: number, layers: object[]): object => ({ _protocol: 'design/v1', meta: { id: 'g', name: 'Gate', type: 'poster' }, document: { width: w, height: h }, layers: [ground(w, h), ...layers] });

describe('rankGate', () => {
  const item = (severity: GateItem['severity'], code: string, withCall = false): GateItem =>
    ({ severity, code, why: code, ...(withCall ? { call: { tool: 't', params: {} } } : {}) });

  it('puts severity first, a ready call before a fix to work out, one of each kind before a second, notes last', () => {
    const ranked = rankGate([item('note', 'review'), item('suggestion', 'a'), item('warning', 'x'), item('warning', 'x'), item('warning', 'y', true), item('error', 'e')]);
    expect(ranked.map(i => `${i.severity}:${i.code}`)).toEqual(['error:e', 'warning:y', 'warning:x', 'warning:x', 'suggestion:a', 'note:review']);
  });
});

describe('diagnose_design {gate:true}', () => {
  it('holds a vertical piece back for words under the feed\'s caption band, and its call clears it', async () => {
    // Moving, so a Reel or a Story: the feed's interface will be drawn over it.
    const rise = { animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }, { t: 4000, opacity: 1 }], playback: { duration: 4000, origin: 'offset' } } };
    const design = write('feed', doc(1080, 1920, [text('title', 120, 700, 'Read this', rise), text('cta', 120, 1620, 'Join us', rise)]));
    const first = await gate(design);
    expect(first.ready).toBe(false);
    expect(first.top[0]?.code).toBe('safe_area');
    expect(first.next_action.tool).toBe('edit_layer');
    expect(first.next_action.params).toMatchObject({ op: 'move', layer_id: 'cta', design_path: design });
    await call(first.next_action.tool, first.next_action.params);
    const second = await gate(design);
    expect(second.top.some(i => i.code === 'safe_area')).toBe(false);
    expect(second.ready).toBe(true);
    expect(second.next_action).toMatchObject({ tool: 'animation', params: { op: 'export', design_path: design } });
  }, 60_000);

  it('lets a still vertical piece through — a screen or a print has no feed — and still offers the move (r7, b28)', async () => {
    const design = write('screen', doc(1080, 1920, [text('title', 120, 700, 'Read this'), text('cta', 120, 1620, 'Join us')]));
    const g = await gate(design);
    expect(g.ready).toBe(true);
    const note = g.top.find(i => i.code === 'safe_area');
    expect(note?.severity).toBe('suggestion');
    expect(note?.why).toMatch(/if this still runs in a feed/);
    expect(note?.call).toMatchObject({ tool: 'edit_layer', params: { op: 'move', layer_id: 'cta' } });
  }, 60_000);

  it('gives a line the time to be read with the retime it names, and points a moving piece at animation export', async () => {
    const fade = { animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }, { t: 900, opacity: 1 }, { t: 1200, opacity: 0 }], playback: { duration: 1200, origin: 'offset' } } };
    const design = write('brief', doc(1080, 1080, [text('long', 120, 400, 'A long sentence with far too many words to read in under a second', { width: 840, height: 200, ...fade })]));
    const first = await gate(design);
    const reading = first.top.find(i => i.code === 'motion_reading');
    expect(reading?.call).toMatchObject({ tool: 'animation', params: { op: 'retime', design_path: design } });
    if (reading?.call) await call(reading.call.tool, reading.call.params);
    const second = await gate(design);
    expect(second.top.some(i => i.code === 'motion_reading')).toBe(false);
    // Each measured fact once: a shot's note that repeats its page's is not a second item.
    const whys = second.top.filter(i => i.code === 'review').map(i => i.why.replace(/^In "[^"]+": /, ''));
    expect(new Set(whys).size).toBe(whys.length);
    if (second.ready) expect(second.next_action).toMatchObject({ tool: 'animation', params: { op: 'export' } });
  }, 60_000);

  it('heals what is spatial before it measures, and a dry run writes nothing', async () => {
    const spec = doc(1080, 1080, [text('lost', 1500, 400, 'Where am I')]);
    const design = write('stray', spec);
    const dry = (await call('diagnose_design', { design_path: design, gate: true, dry_run: true })) as unknown as Gate & { would_heal?: string[] };
    expect(dry.would_heal?.length).toBeGreaterThan(0);
    expect(fs.readFileSync(design, 'utf8')).toBe(yaml.dump(spec));
    const healed = await gate(design);
    expect(healed.healed?.length).toBeGreaterThan(0);
    expect(healed.verdict).toMatch(/^Healed first, the design is changed: /);
    expect(healed.top.some(i => i.code === 'off_canvas')).toBe(false);
  }, 60_000);
});
