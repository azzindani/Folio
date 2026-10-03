import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from '../../editor/state';
import { serializeYAML } from '../../schema/parser';
import { registerServerHost } from '../../editor/server-host';
import { registerMotionPlayer } from '../../editor/motion-host';
import { freezeAtPlayhead, clipToFreeze, setHoldMs, holdMs } from './clip-freeze';
import type { DesignSpec, Layer } from '../../schema/types';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 100, height: 100, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 0, duration_ms: 2000, ...extra } }) as unknown as Layer;
const design = (layers: Layer[]): DesignSpec =>
  ({ _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 100, height: 100, unit: 'px', dpi: 96 }, layers }) as unknown as DesignSpec;

let state: StateManager;
beforeEach(() => {
  state = new StateManager();
  state.set('design', design([clip('a', 0), clip('b', 2000)]), false);
  registerServerHost({ rel: () => 'p/designs/d.design.yaml', save: async () => { state.set('dirty', false, false); return true; } });
  registerMotionPlayer({ time: 500, rows: () => null } as never);
  setHoldMs(1200);
});
afterEach(() => { vi.unstubAllGlobals(); document.body.querySelectorAll('.toast').forEach(t => t.remove()); });

describe('the hold', () => {
  it('stays within what the engine accepts and is remembered', () => {
    setHoldMs(5); expect(holdMs()).toBe(100);
    setHoldMs(99_999); expect(holdMs()).toBe(10_000);
    setHoldMs(1234.6); expect(holdMs()).toBe(1235);
  });
});

describe('which clip a freeze acts on', () => {
  it('the one named, else the selected one, else the top clip playing under the playhead', () => {
    expect(clipToFreeze(state, 'b', 0)?.id).toBe('b');
    state.set('selectedLayerIds', ['b'], false);
    expect(clipToFreeze(state, undefined, 500)?.id).toBe('b');
    state.set('selectedLayerIds', [], false);
    expect(clipToFreeze(state, undefined, 500)?.id).toBe('a');
    expect(clipToFreeze(state, undefined, 2500)?.id).toBe('b');
    expect(clipToFreeze(state, undefined, 9000)).toBeNull();
  });
});

describe('❄ Freeze at the playhead', () => {
  it('asks the server for the frame under the playhead and shows what it wrote — one undo step', async () => {
    let sent: { freeze?: { at: number; duration_ms: number }; layer_id?: string } = {};
    vi.stubGlobal('fetch', async (_u: unknown, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, content: serializeYAML(design([clip('a', 0), clip('a_freeze', 500, { still: true }), clip('b', 3200)])), result: {} }));
    });
    expect(await freezeAtPlayhead(state)).toBe(true);
    expect(sent).toMatchObject({ layer_id: 'a', freeze: { at: 500, duration_ms: 1200 } });
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a', 'a_freeze', 'b']);
    expect(document.body.textContent).toContain('Held 1.2s at 0.50s');
    state.undo();
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a', 'b']);
  });
  it('says so when nothing plays at the playhead, when the clip is already a freeze, and when the engine refuses', async () => {
    registerMotionPlayer({ time: 9000, rows: () => null } as never);
    expect(await freezeAtPlayhead(state)).toBe(false);
    expect(document.body.textContent).toContain('No clip is playing at the playhead');
    registerMotionPlayer({ time: 100, rows: () => null } as never);
    state.set('design', design([clip('f', 0, { still: true })]), false);
    expect(await freezeAtPlayhead(state)).toBe(false);
    expect(document.body.textContent).toContain('already a freeze');
    state.set('design', design([clip('a', 0)]), false);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, error: 'Opening 1200ms at 100ms is blocked' }), { status: 422 }));
    expect(await freezeAtPlayhead(state)).toBe(false);
    expect(document.body.textContent).toContain('is blocked');
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a']);
  });
});
