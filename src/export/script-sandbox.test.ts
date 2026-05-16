import { describe, it, expect, vi } from 'vitest';
import { buildSandboxSrcdoc, runInSandbox } from './script-sandbox';
import type { ScriptDef } from '../schema/types';

describe('buildSandboxSrcdoc', () => {
  it('returns an HTML string with a script tag', () => {
    const html = buildSandboxSrcdoc([]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<script>');
  });

  it('embeds the script id and code', () => {
    const scripts: ScriptDef[] = [
      { id: 'on_click', language: 'javascript', code: 'state.set("x", 1)' },
    ];
    const html = buildSandboxSrcdoc(scripts);
    expect(html).toContain('on_click');
    expect(html).toContain('state.set');
  });

  it('handles multiple scripts', () => {
    const scripts: ScriptDef[] = [
      { id: 's1', language: 'javascript', code: 'var a=1' },
      { id: 's2', language: 'javascript', code: 'var b=2' },
    ];
    const html = buildSandboxSrcdoc(scripts);
    expect(html).toContain('s1');
    expect(html).toContain('s2');
  });

  it('blocks window/document/fetch in sandbox script body', () => {
    const html = buildSandboxSrcdoc([]);
    // The safe() wrapper receives these as params and passes undefined for each
    expect(html).toContain('window');
    expect(html).toContain('document');
    expect(html).toContain('fetch');
    expect(html).toContain('XMLHttpRequest');
  });

  it('listens for postMessage events', () => {
    const html = buildSandboxSrcdoc([]);
    expect(html).toContain("window.addEventListener('message'");
  });

  it('posts result back to parent on success', () => {
    const html = buildSandboxSrcdoc([]);
    expect(html).toContain("parent.postMessage");
    expect(html).toContain("'result'");
  });

  it('posts error result on script throw', () => {
    const html = buildSandboxSrcdoc([]);
    expect(html).toContain('ok:false');
    expect(html).toContain('error:String(err)');
  });

  it('handles empty scripts array', () => {
    expect(() => buildSandboxSrcdoc([])).not.toThrow();
  });
});

describe('runInSandbox — timeout path (jsdom iframe)', () => {
  it('resolves ok:false after timeout when iframe never responds', async () => {
    vi.useFakeTimers();
    const srcdoc = buildSandboxSrcdoc([]);
    const promise = runInSandbox(srcdoc, 'no-response', { state: {}, data: {} }, 100);
    vi.advanceTimersByTime(200);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
    vi.useRealTimers();
  });

  it('result always has statePatches key (empty object on timeout)', async () => {
    vi.useFakeTimers();
    const srcdoc = buildSandboxSrcdoc([]);
    const promise = runInSandbox(srcdoc, 'test2', { state: {}, data: {} }, 50);
    vi.advanceTimersByTime(100);
    const result = await promise;
    expect(result.statePatches).toBeDefined();
    vi.useRealTimers();
  });

  it('resolves ok:true when matching message arrives before timeout', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const scriptId = 'msg-test';
    const expectedMsgId = `${scriptId}-${now}`;
    const srcdoc = buildSandboxSrcdoc([]);

    const promise = runInSandbox(srcdoc, scriptId, { state: { n: 0 }, data: {} }, 5000);

    // Dispatch a matching postMessage before the timeout fires
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'result', id: expectedMsgId, ok: true, state: { n: 99 } },
    }));

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.statePatches).toEqual({ n: 99 });
    vi.useRealTimers();
  });

  it('ignores messages with wrong id', async () => {
    vi.useFakeTimers();
    const srcdoc = buildSandboxSrcdoc([]);
    const promise = runInSandbox(srcdoc, 'ignore-test', { state: {}, data: {} }, 100);
    // Send a message with wrong id — should be ignored
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'result', id: 'wrong-id', ok: true, state: {} },
    }));
    vi.advanceTimersByTime(200);
    const result = await promise;
    // Timed out because the wrong-id message was ignored
    expect(result.ok).toBe(false);
    vi.useRealTimers();
  });

  it('resolves with error field when script failed', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const scriptId = 'err-test';
    const msgId = `${scriptId}-${now}`;
    const srcdoc = buildSandboxSrcdoc([]);

    const promise = runInSandbox(srcdoc, scriptId, { state: {}, data: {} }, 5000);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'result', id: msgId, ok: false, error: 'ReferenceError', state: {} },
    }));
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ReferenceError');
    vi.useRealTimers();
  });
});
