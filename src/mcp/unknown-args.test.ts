import { describe, it, expect } from 'vitest';
import { unknownArgs, closestArg, withIgnoredArgs } from './unknown-args';
import { ALL_HANDLERS } from './handlers';
import type { ToolResult } from './types';

describe('unknownArgs', () => {
  // benchmark r2: render_preview({page}) rendered page one, three times, and said nothing.
  it('names an argument the tool does not publish, with the name it likely meant', () => {
    expect(unknownArgs('render_preview', { design_path: '/p/d.yaml', page: 2 })).toEqual(['page (did you mean page_id?)']);
    expect(unknownArgs('edit_layer', { op: 'update', layer_id: 't', prosp: {} })).toEqual(['prosp (did you mean props?)']);
    expect(unknownArgs('render_preview', { design_path: '/p/d.yaml', frobozz: 1 })).toEqual(['frobozz']);
  });

  it('stays quiet for published names, the aliases handlers read, and transport keys', () => {
    expect(unknownArgs('render_preview', { design_path: '/p/d.yaml', page_id: 'a' })).toEqual([]);
    expect(unknownArgs('manage_design', { op: 'asset_fetch', url: 'https://x', path: 'p' })).toEqual([]);
    expect(unknownArgs('render_preview', { design_path: '/p/d.yaml', _meta: {} })).toEqual([]);
    expect(unknownArgs('no_such_tool', { anything: 1 })).toEqual([]);
  });

  it('prefers a prefix match, and does not guess far', () => {
    expect(closestArg('page', new Set(['page_id', 'pages_total']))).toBe('page_id');
    expect(closestArg('zzz', new Set(['page_id']))).toBeUndefined();
  });

  it('adds ignored_args and a warning to the reply, and leaves a clean reply alone', () => {
    const r = { success: true, progress: [], token_estimate: 0 } as ToolResult;
    expect(withIgnoredArgs(r, [])).toBe(r);
    const w = withIgnoredArgs(r, ['page (did you mean page_id?)']);
    expect(w['ignored_args']).toEqual(['page (did you mean page_id?)']);
    expect(w.progress[0]?.status).toBe('warn');
  });

  it('reaches every tool through the one handler wrapper', async () => {
    const r = await ALL_HANDLERS['get_engine_guide']?.({ section: 'overview', sectoin: 'x' });
    expect(r?.['ignored_args']).toEqual(['sectoin (did you mean section?)']);
  });
});
