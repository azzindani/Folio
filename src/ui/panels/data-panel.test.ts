import { describe, it, expect, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { DataPanelManager } from './data-panel';
import type { DesignSpec, DataSource } from '../../schema/types';

function design(sources: DataSource[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'r', name: 'R', type: 'report', created: '', modified: '' },
    document: { width: 1200, height: 100, unit: 'px', dpi: 96 },
    pages: [{ id: 'p', label: 'P', layers: [] }],
    report: { layout: 'flow', data: { sources } },
  } as unknown as DesignSpec;
}
function setup(sources: DataSource[]) {
  const state = new StateManager();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const panel = new DataPanelManager(el, state);
  state.set('design', design(sources), false);
  return { state, el, panel };
}
const srcs = (state: StateManager): DataSource[] => state.get().design!.report!.data!.sources;

afterEach(() => { document.body.innerHTML = ''; });

describe('DataPanelManager', () => {
  it('lists datasets with type + row count', () => {
    const { el } = setup([{ id: 'stocks', type: 'inline', rows: [{ a: 1 }, { a: 2 }] }]);
    expect(el.querySelector<HTMLInputElement>('input[data-dp-field="id"]')?.value).toBe('stocks');
    expect(el.textContent).toContain('2 rows');
    expect(el.querySelector('[data-dp="add-inline"]')).not.toBeNull();
  });

  it('adds an inline dataset', () => {
    const { state, el } = setup([]);
    el.querySelector<HTMLButtonElement>('[data-dp="add-inline"]')!.click();
    expect(srcs(state)).toHaveLength(1);
    expect(srcs(state)[0].type).toBe('inline');
  });

  it('adds an http query dataset', () => {
    const { state, el } = setup([]);
    el.querySelector<HTMLButtonElement>('[data-dp="add-query"]')!.click();
    expect(srcs(state)[0]).toMatchObject({ type: 'query', engine: 'http' });
  });

  it('deletes a dataset', () => {
    const { state, el } = setup([{ id: 'a', type: 'inline', rows: [] }, { id: 'b', type: 'inline', rows: [] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="del-src"][data-idx="0"]')!.click();
    expect(srcs(state).map(s => s.id)).toEqual(['b']);
  });

  it('expands an inline dataset into an editable grid and edits a cell', () => {
    const { state, el } = setup([{ id: 's', type: 'inline', rows: [{ label: 'A', value: 1 }] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="toggle"][data-idx="0"]')!.click();
    const cellInput = el.querySelector<HTMLInputElement>('input[data-dp-cell="0"][data-dp-key="value"]')!;
    expect(cellInput).not.toBeNull();
    cellInput.value = '42';
    cellInput.dispatchEvent(new Event('change'));
    expect(srcs(state)[0].rows![0].value).toBe(42); // coerced to number
  });

  it('renames a column across all rows', () => {
    const { state, el } = setup([{ id: 's', type: 'inline', rows: [{ label: 'A' }, { label: 'B' }] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="toggle"][data-idx="0"]')!.click();
    const colInput = el.querySelector<HTMLInputElement>('input[data-dp-col="0"]')!;
    colInput.value = 'name';
    colInput.dispatchEvent(new Event('change'));
    expect(Object.keys(srcs(state)[0].rows![0])).toContain('name');
    expect(srcs(state)[0].rows![1]).toMatchObject({ name: 'B' });
  });

  it('adds a row and a column', () => {
    const { state, el } = setup([{ id: 's', type: 'inline', rows: [{ a: 1 }] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="toggle"][data-idx="0"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-dp="add-row"][data-idx="0"]')!.click();
    expect(srcs(state)[0].rows).toHaveLength(2);
    el.querySelector<HTMLButtonElement>('[data-dp="add-col"][data-idx="0"]')!.click();
    expect(Object.keys(srcs(state)[0].rows![0]).length).toBeGreaterThan(1);
  });

  it('shows query fields (url + Fetch) for an http source', () => {
    const { el } = setup([{ id: 'q', type: 'query', engine: 'http', url: 'https://x', rows: [] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="toggle"][data-idx="0"]')!.click();
    expect(el.querySelector('input[data-dp-field="url"]')).not.toBeNull();
    expect(el.querySelector('[data-dp="fetch"]')).not.toBeNull();
  });

  it('adds a group-by transform that computes aggregated rows from upstream', () => {
    const { state, el } = setup([{ id: 'stocks', type: 'inline', rows: [{ sector: 'Banking', yield: 6 }, { sector: 'Banking', yield: 8 }, { sector: 'Energy', yield: 20 }] }]);
    el.querySelector<HTMLButtonElement>('[data-dp="add-group"]')!.click();
    const t = srcs(state).find(s => s.type === 'transform')!;
    expect(t.from).toBe('stocks'); // auto-picked the populated source
    const tIdx = srcs(state).findIndex(s => s.id === t.id);
    // set group_by + agg + value → rows recompute
    const gb = el.querySelector<HTMLSelectElement>(`select[data-dp-field="group_by"][data-idx="${tIdx}"]`)!;
    gb.value = 'sector'; gb.dispatchEvent(new Event('change'));
    const agg = el.querySelector<HTMLSelectElement>(`select[data-dp-field="agg"][data-idx="${tIdx}"]`)!;
    agg.value = 'avg'; agg.dispatchEvent(new Event('change'));
    const val = el.querySelector<HTMLSelectElement>(`select[data-dp-field="value"][data-idx="${tIdx}"]`)!;
    val.value = 'yield'; val.dispatchEvent(new Event('change'));
    const out = srcs(state).find(s => s.type === 'transform')!.rows!;
    expect(out).toContainEqual({ sector: 'Banking', yield: 7 });
    expect(out).toContainEqual({ sector: 'Energy', yield: 20 });
  });
});
