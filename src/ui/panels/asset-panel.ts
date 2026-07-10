// Folio editor — Assets panel: browse the current project's uploaded assets
// (same set the MCP asset_list op sees) and insert them as image layers.
// Server-backed designs only — the listing + thumbs ride the authed
// /__project_files mount; local file designs show a hint instead.
import { type StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';

interface AssetRow {
  id: string;
  path: string;
  kind: 'images' | 'icons' | 'fonts';
  bytes: number;
  width?: number;
  height?: number;
  luminance?: string;
  alt?: string;
}

let insertCounter = 0;

export class AssetPanelManager {
  private container: HTMLElement;
  private state: StateManager;
  private project: string | null = null;
  private token: string | null = null;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.renderEmpty('Open a design from the Library to browse its project assets.');
  }

  setProject(project: string | null, token: string | null): void {
    this.project = project;
    this.token = token;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.project) {
      this.renderEmpty('Open a design from the Library to browse its project assets.');
      return;
    }
    try {
      const r = await fetch(`/__project_files/${encodeURIComponent(this.project)}/__assets`, {
        credentials: 'include',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!r.ok) { this.renderEmpty(`Could not list assets (${r.status}).`); return; }
      const j = await r.json() as { ok?: boolean; assets?: AssetRow[] };
      this.render(j.assets ?? []);
    } catch {
      this.renderEmpty('Could not reach the project server.');
    }
  }

  private renderEmpty(msg: string): void {
    this.container.innerHTML = `
      <div style="padding:14px;color:var(--color-text-muted);font-size:12px;line-height:1.5">${msg}
        <div style="margin-top:8px;color:var(--color-text-dim)">Tip: drop an image onto the canvas to upload it as a project asset.</div>
      </div>`;
  }

  private render(rows: AssetRow[]): void {
    const head = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--color-border)">
        <span style="font-size:11px;color:var(--color-text-muted)">${rows.length} asset(s) · ${this.project}</span>
        <button class="btn-sm" data-asset-refresh title="Refresh">&#8635;</button>
      </div>`;
    if (rows.length === 0) {
      this.container.innerHTML = head;
      this.renderEmptyBody();
    } else {
      const cells = rows.map((a, i) => this.cell(a, i)).join('');
      this.container.innerHTML = `${head}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px">${cells}</div>`;
    }
    this.container.querySelector('[data-asset-refresh]')?.addEventListener('click', () => void this.refresh());
    this.container.querySelectorAll<HTMLElement>('[data-asset-idx]').forEach(el => {
      el.addEventListener('click', () => this.insert(rows[Number(el.dataset.assetIdx)]));
    });
  }

  private renderEmptyBody(): void {
    const div = document.createElement('div');
    div.style.cssText = 'padding:14px;color:var(--color-text-muted);font-size:12px;line-height:1.5';
    div.textContent = 'No assets yet. Drop an image onto the canvas to upload one, or add via MCP: manage_design {op:"asset_add"}.';
    this.container.appendChild(div);
  }

  private cell(a: AssetRow, i: number): string {
    const url = `/__project_files/${encodeURIComponent(this.project ?? '')}/${a.path.split('/').map(encodeURIComponent).join('/')}`;
    const dims = a.width ? `${a.width}×${a.height}` : '';
    const name = a.path.split('/').pop() ?? a.path;
    const thumb = a.kind === 'fonts'
      ? `<div style="height:64px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--color-text-muted)">Aa</div>`
      : `<img src="${url}" alt="${a.alt ?? name}" loading="lazy"
           style="width:100%;height:64px;object-fit:cover;display:block;background:
             repeating-conic-gradient(var(--color-surface-3) 0% 25%, var(--color-surface-2) 0% 50%) 0 0/16px 16px">`;
    return `
      <div data-asset-idx="${i}" title="Insert ${name}${dims ? ` (${dims})` : ''}"
        style="cursor:pointer;border:1px solid var(--color-border);border-radius:var(--radius-sm);overflow:hidden;background:var(--color-surface-2)">
        ${thumb}
        <div style="padding:4px 6px;font-size:10px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}${dims ? ` · ${dims}` : ''}${a.luminance ? ` · ${a.luminance}` : ''}</div>
      </div>`;
  }

  private insert(a: AssetRow | undefined): void {
    if (!a || a.kind === 'fonts') return;
    const design = this.state.get().design;
    if (!design) return;
    const docW = design.document.width, docH = design.document.height;
    const w = a.width ?? 600, h = a.height ?? 400;
    const scale = Math.min(1, (docW * 0.6) / w, (docH * 0.6) / h);
    const lw = Math.round(w * scale), lh = Math.round(h * scale);
    const maxZ = Math.max(0, ...this.state.getCurrentLayers().map(l => l.z));
    const id = `${a.id}-${++insertCounter}`;
    this.state.addLayer({
      id, type: 'image', z: maxZ + 1,
      x: Math.round((docW - lw) / 2), y: Math.round((docH - lh) / 2),
      width: lw, height: lh,
      src: a.path, fit: 'cover',
      ...(a.alt ? { alt: a.alt } : {}),
    } as unknown as Layer);
    this.state.set('selectedLayerIds', [id]);
    void import('../../utils/toast').then(({ showToast }) => showToast(`Inserted ${a.path}`, 'success'));
  }
}
