import { type StateManager, type EditorState } from '../../editor/state';
import type { DesignSpec, DataSource } from '../../schema/types';

// Studio Data panel — view/edit the report's datasets without touching YAML.
// Inline sources get a spreadsheet-style grid (edit cells, rename/add/remove
// columns + rows). Query sources (http) expose url/pick + a live Fetch button
// that pulls JSON in-browser and bakes the rows. Every edit rewrites
// report.data.sources on the design, so charts/tables re-render immediately.

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function coerce(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return v.trim() !== '' && !Number.isNaN(n) ? n : v;
}
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}
const cell = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:3px;padding:3px 5px;color:var(--color-text);font-size:11px;box-sizing:border-box';

export class DataPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private expanded = new Set<string>();

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.state.subscribe(this.onStateChange.bind(this));
    this.render();
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.includes('design')) this.render();
  }

  private sources(): DataSource[] {
    return this.state.get().design?.report?.data?.sources ?? [];
  }

  // Clone the design, mutate its data.sources, commit. Creates report.data if absent.
  private mutate(fn: (sources: DataSource[]) => DataSource[]): void {
    const design = this.state.get().design;
    if (!design) return;
    const report = design.report ?? { layout: 'flow' };
    const data = report.data ?? { sources: [] };
    const next: DesignSpec = {
      ...design,
      report: { ...report, data: { ...data, sources: fn([...(data.sources ?? [])]) } },
    } as DesignSpec;
    this.state.set('design', next);
  }

  render(): void {
    const design = this.state.get().design;
    if (!design?.report) {
      this.container.innerHTML = `<div style="padding:14px;color:var(--color-text-muted);font-size:12px;line-height:1.6">
        No report on this design.<br>Datasets power chart + table layers in flow reports.</div>`;
      return;
    }
    const sources = this.sources();
    const cards = sources.map((s, i) => this.renderSource(s, i)).join('');
    this.container.innerHTML = `
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted)">Datasets (${sources.length})</span>
          <div style="display:flex;gap:4px">
            <button class="dp-btn" data-dp="add-inline" title="New inline dataset" style="${this.btn()}">+ Inline</button>
            <button class="dp-btn" data-dp="add-query" title="New HTTP query dataset" style="${this.btn()}">+ Query</button>
          </div>
        </div>
        ${cards || '<div style="color:var(--color-text-muted);font-size:11px;padding:8px 0">No datasets yet.</div>'}
      </div>`;
    this.bind();
  }

  private btn(): string {
    return 'font-size:11px;padding:3px 8px;border:1px solid var(--color-border);border-radius:5px;background:var(--color-bg);color:var(--color-text);cursor:pointer';
  }

  private renderSource(s: DataSource, idx: number): string {
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const open = this.expanded.has(s.id);
    const head = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <button class="dp-btn" data-dp="toggle" data-idx="${idx}" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer;font-size:11px">${open ? '▾' : '▸'}</button>
        <input class="dp-input" data-dp-field="id" data-idx="${idx}" value="${esc(s.id)}" title="Dataset id" style="${cell};flex:1;font-weight:600">
        <span style="font-size:9px;text-transform:uppercase;color:var(--color-text-muted);background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:1px 6px">${esc(s.type)}</span>
        <span style="font-size:10px;color:var(--color-text-muted)">${rows.length} rows</span>
        <button class="dp-btn" data-dp="del-src" data-idx="${idx}" title="Delete dataset" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer;font-size:13px">✕</button>
      </div>`;
    const body = open
      ? (s.type === 'inline' ? this.renderGrid(s, idx) : this.renderQuery(s, idx))
      : '';
    return `<div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;background:var(--color-surface)">${head}${body}</div>`;
  }

  private renderQuery(s: DataSource, idx: number): string {
    const isHttp = (s.engine ?? 'http') === 'http';
    const engines = ['http', 'sql', 'duckdb'];
    const engineSel = engines.map(e => `<option value="${e}"${(s.engine ?? 'http') === e ? ' selected' : ''}>${e}</option>`).join('');
    return `
      <div style="display:flex;flex-direction:column;gap:5px">
        <select class="dp-input" data-dp-field="engine" data-idx="${idx}" style="${cell}">${engineSel}</select>
        ${isHttp ? `
          <input class="dp-input" data-dp-field="url" data-idx="${idx}" value="${esc(s.url ?? '')}" placeholder="https://api.example.com/data.json" style="${cell}">
          <input class="dp-input" data-dp-field="query" data-idx="${idx}" value="${esc(s.query ?? '')}" placeholder="pick: nested.array.path (optional)" style="${cell}">
          <button class="dp-btn" data-dp="fetch" data-idx="${idx}" style="${this.btn()};align-self:flex-start">▶ Fetch now</button>
          <div class="dp-status" data-idx="${idx}" style="font-size:10px;color:var(--color-text-muted)"></div>`
        : `
          <textarea class="dp-input" data-dp-field="query" data-idx="${idx}" rows="3" placeholder="SELECT …" style="${cell};font-family:var(--font-mono);resize:vertical">${esc(s.query ?? '')}</textarea>
          <input class="dp-input" data-dp-field="connection" data-idx="${idx}" value="${esc(s.connection ?? '')}" placeholder="connection name (resolved server-side)" style="${cell}">
          <div style="font-size:10px;color:var(--color-text-dim);line-height:1.5">${esc(s.engine)} runs at export via a server-configured connector; ${Array.isArray(s.rows) && s.rows.length ? `${s.rows.length} cached rows shown in charts meanwhile.` : 'no cached rows yet.'}</div>`}
      </div>`;
  }

  private renderGrid(s: DataSource, idx: number): string {
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const cols = columnsOf(rows);
    if (cols.length === 0) {
      return `<button class="dp-btn" data-dp="add-col" data-idx="${idx}" style="${this.btn()}">+ Column</button>`;
    }
    const shown = rows.slice(0, 50);
    const thead = `<tr>${cols.map((c, ci) => `<th style="padding:2px"><input class="dp-input" data-dp-col="${ci}" data-idx="${idx}" value="${esc(c)}" style="${cell};font-weight:600;min-width:64px"></th>`).join('')}<th></th></tr>`;
    const body = shown.map((r, ri) => `<tr>${cols.map(c => `<td style="padding:2px"><input class="dp-input" data-dp-cell="${ri}" data-dp-key="${esc(c)}" data-idx="${idx}" value="${esc(r[c])}" style="${cell};min-width:64px"></td>`).join('')}<td style="padding:0 2px"><button class="dp-btn" data-dp="del-row" data-row="${ri}" data-idx="${idx}" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer">✕</button></td></tr>`).join('');
    return `
      <div style="overflow:auto;max-height:320px;border:1px solid var(--color-border);border-radius:4px">
        <table style="border-collapse:collapse;width:100%"><thead>${thead}</thead><tbody>${body}</tbody></table>
      </div>
      <div style="display:flex;gap:5px;margin-top:6px">
        <button class="dp-btn" data-dp="add-row" data-idx="${idx}" style="${this.btn()}">+ Row</button>
        <button class="dp-btn" data-dp="add-col" data-idx="${idx}" style="${this.btn()}">+ Column</button>
        ${rows.length > 50 ? `<span style="font-size:10px;color:var(--color-text-muted);align-self:center">showing 50 / ${rows.length}</span>` : ''}
      </div>`;
  }

  private bind(): void { this.bindButtons(); this.bindFields(); }

  private uniqueId(prefix: string): string {
    const ids = new Set(this.sources().map(s => s.id));
    let n = this.sources().length + 1;
    while (ids.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  private bindButtons(): void {
    this.container.querySelectorAll<HTMLElement>('[data-dp]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const action = el.dataset.dp!;
        const idx = Number(el.dataset.idx);
        switch (action) {
          case 'add-inline': {
            const id = this.uniqueId('data');
            this.expanded.add(id);
            this.mutate(s => [...s, { id, type: 'inline', rows: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] }]);
            break;
          }
          case 'add-query': {
            const id = this.uniqueId('query');
            this.expanded.add(id);
            this.mutate(s => [...s, { id, type: 'query', engine: 'http', url: '', rows: [] }]);
            break;
          }
          case 'toggle': {
            const s = this.sources()[idx];
            if (s) { this.expanded.has(s.id) ? this.expanded.delete(s.id) : this.expanded.add(s.id); this.render(); }
            break;
          }
          case 'del-src': this.mutate(s => s.filter((_, i) => i !== idx)); break;
          case 'add-row': this.mutate(s => this.editAt(s, idx, src => {
            const cols = columnsOf(src.rows ?? []);
            const row: Record<string, unknown> = {};
            for (const c of cols) row[c] = '';
            src.rows = [...(src.rows ?? []), cols.length ? row : { col1: '' }];
          })); break;
          case 'add-col': this.mutate(s => this.editAt(s, idx, src => {
            const cols = columnsOf(src.rows ?? []);
            let n = cols.length + 1; while (cols.includes(`col${n}`)) n++;
            const key = `col${n}`;
            src.rows = (src.rows ?? []).map(r => ({ ...r, [key]: '' }));
            if (!src.rows.length) src.rows = [{ [key]: '' }];
          })); break;
          case 'del-row': {
            const row = Number(el.dataset.row);
            this.mutate(s => this.editAt(s, idx, src => { src.rows = (src.rows ?? []).filter((_, i) => i !== row); }));
            break;
          }
          case 'fetch': void this.fetchQuery(idx, el); break;
        }
      });
    });
  }

  // Immutably apply `fn` to source[idx] within the sources array.
  private editAt(sources: DataSource[], idx: number, fn: (src: DataSource) => void): DataSource[] {
    return sources.map((s, i) => { if (i !== idx) return s; const c = { ...s, rows: s.rows ? [...s.rows] : s.rows }; fn(c); return c; });
  }

  private bindFields(): void {
    this.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.dp-input').forEach(el => {
      el.addEventListener('change', () => {
        const idx = Number(el.dataset.idx);
        if (el.dataset.dpField) {
          const field = el.dataset.dpField;
          this.mutate(s => this.editAt(s, idx, src => { (src as unknown as Record<string, unknown>)[field] = el.value; }));
        } else if (el.dataset.dpCol != null) {
          const ci = Number(el.dataset.dpCol);
          this.mutate(s => this.editAt(s, idx, src => {
            const cols = columnsOf(src.rows ?? []); const oldKey = cols[ci]; const newKey = el.value.trim();
            if (!newKey || newKey === oldKey) return;
            src.rows = (src.rows ?? []).map(r => { const o: Record<string, unknown> = {}; for (const k of Object.keys(r)) o[k === oldKey ? newKey : k] = r[k]; return o; });
          }));
        } else if (el.dataset.dpCell != null) {
          const ri = Number(el.dataset.dpCell); const key = el.dataset.dpKey!;
          this.mutate(s => this.editAt(s, idx, src => { if (src.rows?.[ri]) src.rows[ri] = { ...src.rows[ri], [key]: coerce(el.value) }; }));
        }
      });
    });
  }

  // Live in-browser fetch of an http query source → bake rows onto the design.
  private async fetchQuery(idx: number, btn: HTMLElement): Promise<void> {
    const s = this.sources()[idx];
    if (!s) return;
    const status = this.container.querySelector<HTMLElement>(`.dp-status[data-idx="${idx}"]`);
    const say = (t: string): void => { if (status) status.textContent = t; };
    if (!s.url) { say('Set a URL first.'); return; }
    say('Fetching…'); btn.setAttribute('disabled', 'true');
    try {
      const res = await fetch(s.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let parsed: unknown = await res.json();
      if (s.query?.trim()) for (const k of s.query.split('.')) parsed = (parsed as Record<string, unknown> | null)?.[k];
      const rows = Array.isArray(parsed) ? parsed as Record<string, unknown>[]
        : parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : [];
      this.mutate(src => this.editAt(src, idx, x => { x.rows = rows; }));
      say(`✓ ${rows.length} rows fetched`);
    } catch (err) {
      say(`✗ ${(err as Error).message}`);
    } finally {
      btn.removeAttribute('disabled');
    }
  }
}
