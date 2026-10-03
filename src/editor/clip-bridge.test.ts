import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from './state';
import { serializeYAML } from '../schema/parser';
import { registerServerHost } from './server-host';
import { runClipOp } from './clip-bridge';
import type { DesignSpec } from '../schema/types';

const design = (ids: string[], pages = false): DesignSpec => {
  const layers = ids.map((id, i) => ({ id, type: 'rect', z: i, x: 0, y: 0, width: 10, height: 10, fill: { type: 'solid', color: '#000000' } }));
  return { _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    ...(pages ? { pages: [{ id: 'p1', layers }] } : { layers }) } as unknown as DesignSpec;
};
const reply = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

let state: StateManager, saved: number;
beforeEach(() => {
  state = new StateManager();
  state.set('design', design(['a']), false);
  saved = 0;
  registerServerHost({ rel: () => 'proj/designs/d.design.yaml', save: async () => { saved++; state.set('dirty', false, false); return true; } });
});
const op = { layer_id: 'a', freeze: { at: 1000, duration_ms: 500 } };

describe('runClipOp — the engine edits the saved file, the editor shows what it wrote', () => {
  it('saves first, sends the op, and replaces the design as ONE undo step with nothing left to save', async () => {
    let sent: { design?: string; layer_id?: string; freeze?: unknown } = {};
    const call = (async (_u: unknown, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ ok: true, content: serializeYAML(design(['a', 'a_freeze'])), result: { hold_ms: 500 } })); }) as typeof fetch;
    state.set('dirty', true, false);
    const r = await runClipOp(state, op, call);
    expect(r).toEqual({ ok: true, result: { hold_ms: 500 } });
    expect(saved).toBe(1);
    expect(sent).toMatchObject({ design: 'proj/designs/d.design.yaml', layer_id: 'a', freeze: { at: 1000, duration_ms: 500 } });
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a', 'a_freeze']);
    expect(state.get().dirty).toBe(false);
    state.undo();
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a']);
  });
  it('names the page the edit is on', async () => {
    state.set('design', design(['a'], true), false);
    let sent: { page_id?: string } = {};
    await runClipOp(state, op, (async (_u: unknown, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ ok: false, error: 'x' }), { status: 422 }); }) as typeof fetch);
    expect(sent.page_id).toBe('p1');
  });
  it('says what is missing: no server file, an unsaved design, the engine\'s refusal, a dead server', async () => {
    registerServerHost({ rel: () => null, save: async () => false });
    expect((await runClipOp(state, op, reply({}))).error).toContain('save the design to the library');
    registerServerHost({ rel: () => 'p/d.design.yaml', save: async () => { state.set('dirty', true, false); return false; } });
    expect((await runClipOp(state, op, reply({}))).error).toContain('could not be saved');
    registerServerHost({ rel: () => 'p/d.design.yaml', save: async () => true });
    state.set('dirty', false, false);
    const refused = await runClipOp(state, op, reply({ ok: false, error: 'not while "a" plays', hint: 'pick a moment inside' }, 422));
    expect(refused).toEqual({ ok: false, error: 'not while "a" plays', hint: 'pick a moment inside' });
    expect((await runClipOp(state, op, (async () => { throw new Error('offline'); }) as typeof fetch)).error).toContain('did not answer');
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a']);
  });
  it('a reply that is not a design changes nothing', async () => {
    const r = await runClipOp(state, op, reply({ ok: true, content: 'layers: [unclosed' }));
    expect(r.ok).toBe(false);
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a']);
  });
});
