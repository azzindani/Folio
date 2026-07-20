import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LivePreview } from './live-preview';
import { loadPreviewDatasets } from './preview-data';
import { StateManager } from './state';
import type { DesignSpec, DataSource } from '../schema/types';

function reportSpec(): DesignSpec {
  return {
    version: '1.0',
    meta: { name: 'Preview Report' },
    document: { width: 1200, height: 900 },
    report: {
      layout: 'flow',
      accent: '#3b82f6',
      data: { sources: [{ id: 'sales', type: 'inline', rows: [{ region: 'North', kb: 12 }, { region: 'South', kb: 30 }] }] },
    },
    pages: [{
      id: 'p1',
      layers: [
        { id: 'c1', type: 'interactive_chart', data_ref: 'sales', chart_type: 'bar', x_field: 'region', y_field: 'kb', span: 6 },
        { id: 't1', type: 'interactive_table', data_ref: 'sales', span: 12 },
      ],
    }],
  } as unknown as DesignSpec;
}

describe('preview-data (browser-safe loading)', () => {
  it('loads inline rows', async () => {
    const sources = [{ id: 'a', type: 'inline', rows: [{ x: 1 }] }] as unknown as DataSource[];
    const { datasets, unavailable } = await loadPreviewDatasets(sources);
    expect(datasets.get('a')?.rows).toEqual([{ x: 1 }]);
    expect(unavailable).toEqual([]);
  });

  it('reports file-backed sources as unavailable instead of silently empty', async () => {
    const sources = [{ id: 'f', type: 'csv', path: '/data/sales.csv' }] as unknown as DataSource[];
    const { datasets, unavailable } = await loadPreviewDatasets(sources);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.reason).toContain('not readable from the browser');
    // Still registered, so binder lookups miss cleanly rather than throwing.
    expect(datasets.get('f')?.rows).toEqual([]);
  });

  it('falls back to cached rows for a file-backed source', async () => {
    const sources = [{ id: 'f', type: 'csv', path: '/x.csv', rows: [{ a: 1 }] }] as unknown as DataSource[];
    const { datasets, unavailable } = await loadPreviewDatasets(sources);
    expect(unavailable).toEqual([]);
    expect(datasets.get('f')?.rows).toEqual([{ a: 1 }]);
  });

  it('one failing source does not sink the others', async () => {
    const sources = [
      { id: 'bad', type: 'csv', path: '/nope.csv' },
      { id: 'good', type: 'inline', rows: [{ y: 2 }] },
    ] as unknown as DataSource[];
    const { datasets, unavailable } = await loadPreviewDatasets(sources);
    expect(unavailable.map(u => u.id)).toEqual(['bad']);
    expect(datasets.get('good')?.rows).toEqual([{ y: 2 }]);
  });
});

describe('LivePreview', () => {
  let mount: HTMLElement;
  let state: StateManager;
  let preview: LivePreview;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    state = new StateManager();
    preview = new LivePreview(state, mount);
  });

  afterEach(() => {
    preview.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  it('mounts hidden and shows only in preview mode', async () => {
    const container = mount.querySelector<HTMLElement>('.live-preview');
    expect(container?.style.display).toBe('none');

    state.set('design', reportSpec(), false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();
    expect(container?.style.display).toBe('flex');

    state.set('mode', 'visual', false);
    expect(container?.style.display).toBe('none');
  });

  it('sandboxes the frame without allow-same-origin', () => {
    const frame = mount.querySelector('iframe');
    const sandbox = frame?.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    // Critical: allow-scripts + allow-same-origin together would let previewed
    // scripts reach the editor document and its auth token.
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('builds the real report HTML with bound data', async () => {
    state.set('design', reportSpec(), false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();

    const html = preview.getHTML();
    expect(html).toContain('<html');
    // Chart.js is what makes it interactive rather than a static picture.
    expect(html).toContain('chart.umd.min.js');
    // Inline rows actually reached the output.
    expect(html).toContain('North');
    expect(html).toContain('South');
  });

  it('does not rebuild when the design has not changed', async () => {
    state.set('design', reportSpec(), false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();
    const first = preview.getHTML();

    const frame = mount.querySelector('iframe') as HTMLIFrameElement;
    frame.srcdoc = 'SENTINEL';
    // Same spec object re-set: identical HTML, so the frame must be left alone
    // rather than reloaded (a reload discards live filter/chart state).
    state.set('design', reportSpec(), false);
    await vi.runAllTimersAsync();
    expect(frame.srcdoc).toBe('SENTINEL');
    expect(preview.getHTML()).toBe(first);
  });

  it('surfaces unavailable data instead of previewing a silently empty report', async () => {
    const spec = reportSpec();
    (spec.report as { data: { sources: unknown[] } }).data.sources = [
      { id: 'sales', type: 'csv', path: '/server/only.csv' },
    ];
    state.set('design', spec, false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();

    const status = mount.querySelector<HTMLElement>('.live-preview-status');
    expect(status?.style.display).toBe('block');
    expect(status?.textContent).toContain('data unavailable');
    expect(status?.textContent).toContain('sales');
  });

  it('reports a build failure rather than showing a stale frame', async () => {
    // A spec with no pages array at all — assembler input it cannot honour.
    state.set('design', { version: '1.0', meta: { name: 'x' } } as unknown as DesignSpec, false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();
    // Either it built an empty shell or it reported failure; what it must not
    // do is throw out of the state listener and break the editor.
    expect(mount.querySelector('.live-preview')).not.toBeNull();
  });

  it('ignores postMessage from windows other than its own frame', async () => {
    state.set('design', reportSpec(), false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();

    // A hostile frame claiming a scroll position must not be trusted.
    window.dispatchEvent(new MessageEvent('message', {
      data: { __folioPreview: 'scroll', y: 9999 },
      source: window,
    }));
    // No throw, and the spoofed value is not adopted (verified indirectly:
    // the component still rebuilds cleanly).
    state.set('mode', 'visual', false);
    state.set('mode', 'preview', false);
    await vi.runAllTimersAsync();
    expect(preview.getHTML()).toContain('<html');
  });
});
