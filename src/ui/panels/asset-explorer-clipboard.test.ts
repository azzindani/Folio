import { describe, it, expect, beforeEach } from 'vitest';
import { setClip, getClip, isCut, clipSummary, paste } from './asset-explorer-clipboard';
import type { ManageBody, ManageResult } from './asset-explorer-io';

/** Records every manage call and which PROJECT it was addressed to. */
function fakeIO(project: string, fail = new Set<string>()) {
  const calls: Array<{ project: string; body: ManageBody }> = [];
  return {
    calls,
    projectName: project,
    manage(body: ManageBody): Promise<ManageResult> {
      return this.manageIn(project, body);
    },
    manageIn(to: string | null, body: ManageBody): Promise<ManageResult> {
      calls.push({ project: to ?? '', body });
      return Promise.resolve(fail.has(body.op) ? { ok: false, error: 'nope' } : { ok: true });
    },
  };
}

beforeEach(() => setClip(null));

describe('the clipboard', () => {
  it('holds nothing until something is put on it, and ignores an empty set', () => {
    expect(getClip()).toBeNull();
    setClip({ mode: 'copy', project: 'p', scope: 'project', paths: [] });
    expect(getClip(), 'an empty clipboard is no clipboard').toBeNull();
  });

  it('marks cut items so the row can be dimmed, but not copied ones', () => {
    setClip({ mode: 'cut', project: 'p', scope: 'project', paths: ['assets/images/a.png'] });
    expect(isCut('assets/images/a.png')).toBe(true);
    expect(isCut('assets/images/b.png')).toBe(false);
    setClip({ mode: 'copy', project: 'p', scope: 'project', paths: ['assets/images/a.png'] });
    // A copy leaves the original exactly as it was — dimming it would say
    // something is about to move when nothing is.
    expect(isCut('assets/images/a.png')).toBe(false);
  });

  it('summarises what it holds for the status bar', () => {
    setClip({ mode: 'cut', project: 'p', scope: 'project', paths: ['a', 'b'] });
    expect(clipSummary()).toBe('2 items cut');
    setClip({ mode: 'copy', project: 'p', scope: 'project', paths: ['a'] });
    expect(clipSummary()).toBe('1 item copied');
  });
});

describe('paste', () => {
  it('a cut inside one project is a plain move', async () => {
    const io = fakeIO('demo');
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['assets/images/a.png'] });
    const report = await paste({ io: io as never, folder: 'shots', scope: 'project' });
    expect(report).toMatchObject({ moved: 1, copied: 0, failures: [] });
    expect(io.calls).toHaveLength(1);
    expect(io.calls[0]?.body).toMatchObject({ op: 'move', asset_path: 'assets/images/a.png', folder: 'shots' });
  });

  it('a copy is a copy, and names the source project when it differs', async () => {
    const io = fakeIO('other');
    setClip({ mode: 'copy', project: 'demo', scope: 'project', paths: ['assets/images/a.png'] });
    const report = await paste({ io: io as never, folder: '', scope: 'project' });
    expect(report).toMatchObject({ copied: 1, moved: 0 });
    expect(io.calls[0]?.body).toMatchObject({ op: 'copy', from_project: 'demo' });
  });

  it('a cut ACROSS projects copies first, then deletes from the SOURCE', async () => {
    const io = fakeIO('other');
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['assets/images/a.png'] });
    const report = await paste({ io: io as never, folder: '', scope: 'project' });
    expect(report).toMatchObject({ moved: 1, failures: [] });

    expect(io.calls.map(c => c.body.op)).toEqual(['copy', 'delete']);
    // The delete MUST be addressed to the source project. Sending it to the
    // destination would remove the copy that was just made and leave the
    // original sitting exactly where it was.
    expect(io.calls[0]?.project).toBe('other');
    expect(io.calls[1]?.project).toBe('demo');
  });

  it('never deletes the original when the copy failed', async () => {
    const io = fakeIO('other', new Set(['copy']));
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['assets/images/a.png'] });
    const report = await paste({ io: io as never, folder: '', scope: 'project' });
    expect(io.calls.map(c => c.body.op)).toEqual(['copy']);
    expect(report?.failures).toHaveLength(1);
    expect(report?.moved).toBe(0);
  });

  it('promoting to the library is a copy even for a cut, since stores differ', async () => {
    const io = fakeIO('demo');
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['assets/images/a.png'] });
    await paste({ io: io as never, folder: 'brand', scope: 'library' });
    expect(io.calls[0]?.body).toMatchObject({ op: 'copy', scope: 'library', folder: 'brand' });
    expect(io.calls[1]?.body.op).toBe('delete');
  });

  it('a cut is consumed by its paste; a copy survives for the next one', async () => {
    const io = fakeIO('demo');
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['a'] });
    await paste({ io: io as never, folder: 'x', scope: 'project' });
    expect(getClip(), 'cut should be spent').toBeNull();

    setClip({ mode: 'copy', project: 'demo', scope: 'project', paths: ['a'] });
    await paste({ io: io as never, folder: 'x', scope: 'project' });
    expect(getClip(), 'copy should still be pasteable').not.toBeNull();
  });

  it('keeps a failed cut on the clipboard so it can be retried', async () => {
    const io = fakeIO('demo', new Set(['move']));
    setClip({ mode: 'cut', project: 'demo', scope: 'project', paths: ['a'] });
    const report = await paste({ io: io as never, folder: 'x', scope: 'project' });
    expect(report?.failures).toHaveLength(1);
    expect(getClip()).not.toBeNull();
  });

  it('pasting with an empty clipboard does nothing at all', async () => {
    const io = fakeIO('demo');
    expect(await paste({ io: io as never, folder: '', scope: 'project' })).toBeNull();
    expect(io.calls).toHaveLength(0);
  });
});
