import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssetPanelManager } from './asset-panel';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

const ASSETS = [
  { id: 'flat', path: 'assets/images/flat.png', kind: 'images', bytes: 2048, width: 800, height: 600 },
  { id: 'step-1', path: 'assets/images/power-automate/step-1.png', kind: 'images', folder: 'power-automate', bytes: 4096, width: 1200, height: 800, alt: 'Flow designer' },
  { id: 'brand', path: 'assets/fonts/brand.woff2', kind: 'fonts', bytes: 9000 },
];

function makeDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1350, unit: 'px', dpi: 96 },
    layers: [],
  } as unknown as DesignSpec;
}

/** Resolve after the panel's fetch → render microtasks have settled.
 *  One tick is enough locally, but every mutation awaits a dynamic import of
 *  the toast module, which on a cold CI runner lands a few ticks later — hence
 *  `until`, not a bare setTimeout, wherever a request is asserted. */
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 0));

/** Poll until `cond` holds (or give up), so a slow dynamic import cannot flake. */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
}

describe('AssetPanelManager (file manager)', () => {
  let container: HTMLElement;
  let state: StateManager;
  let calls: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    state = new StateManager();
    state.set('design', makeDesign());
    calls = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/__assets')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, assets: ASSETS, folders: ['power-automate'] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }));
  });
  afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

  const open = async (): Promise<AssetPanelManager> => {
    const panel = new AssetPanelManager(container, state);
    panel.setProject('my-project', 'tok');
    await settle();
    return panel;
  };

  it('lists every asset with folder chips', async () => {
    await open();
    expect(container.querySelectorAll('.asset-lib-item')).toHaveLength(3);
    const chips = [...container.querySelectorAll('.asset-lib-chip')].map(c => c.textContent);
    expect(chips).toEqual(['All', 'Root', 'power-automate']);
    expect(container.querySelector('.asset-lib-foot')?.textContent).toContain('3 assets');
  });

  it('filters to a folder, and to the root', async () => {
    await open();
    const chip = [...container.querySelectorAll<HTMLElement>('.asset-lib-chip')].find(c => c.textContent === 'power-automate');
    chip?.click();
    expect(container.querySelectorAll('.asset-lib-item')).toHaveLength(1);
    expect(container.querySelector('.asset-lib-name')?.textContent).toBe('step-1.png');

    [...container.querySelectorAll<HTMLElement>('.asset-lib-chip')].find(c => c.textContent === 'Root')?.click();
    const names = [...container.querySelectorAll('.asset-lib-name')].map(n => n.textContent);
    expect(names).toEqual(['flat.png', 'brand.woff2']);
  });

  it('searches over path and alt text', async () => {
    await open();
    const search = container.querySelector<HTMLInputElement>('.asset-lib-search');
    if (!search) throw new Error('no search box');
    search.value = 'designer';
    search.dispatchEvent(new Event('input'));
    expect(container.querySelectorAll('.asset-lib-item')).toHaveLength(1);
    expect(container.querySelector('.asset-lib-name')?.textContent).toBe('step-1.png');
  });

  it('places an image as a centred layer and selects it', async () => {
    await open();
    container.querySelector<HTMLElement>('[data-act="insert"]')?.click();
    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ type: 'image', src: 'assets/images/flat.png' });
    expect(state.get().selectedLayerIds).toHaveLength(1);
  });

  it('does not place a font', async () => {
    await open();
    const fontBtn = [...container.querySelectorAll<HTMLElement>('[data-act="insert"]')][2];
    fontBtn?.click();
    expect(state.getCurrentLayers()).toHaveLength(0);
  });

  it('uploads to the kind + folder path of the active filter', async () => {
    await open();
    [...container.querySelectorAll<HTMLElement>('.asset-lib-chip')].find(c => c.textContent === 'power-automate')?.click();
    const input = container.querySelector<HTMLInputElement>('.asset-lib-file');
    if (!input) throw new Error('no file input');
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => calls.some(c => c.init?.method === 'POST' && c.url.includes('/assets/')));
    const upload = calls.find(c => c.init?.method === 'POST' && c.url.includes('/assets/'));
    expect(upload?.url).toBe('/__project_files/my-project/assets/images/power-automate/shot.png');
  });

  it('routes a font upload into assets/fonts', async () => {
    await open();
    const input = container.querySelector<HTMLInputElement>('.asset-lib-file');
    if (!input) throw new Error('no file input');
    const file = new File([new Uint8Array([1])], 'brand.woff2', { type: 'font/woff2' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => calls.some(c => c.url.includes('/assets/fonts/')));
    expect(calls.find(c => c.url.includes('/assets/fonts/'))?.url).toContain('brand.woff2');
  });

  it('deletes through the manage endpoint after confirmation', async () => {
    await open();
    vi.stubGlobal('confirm', () => true);
    container.querySelector<HTMLElement>('[data-act="delete"]')?.click();
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    const manage = calls.find(c => c.url.endsWith('/__assets/manage'));
    expect(manage).toBeDefined();
    expect(JSON.parse(String(manage?.init?.body))).toMatchObject({ op: 'delete', asset_path: 'assets/images/flat.png' });
  });

  it('renames through the manage endpoint', async () => {
    await open();
    vi.stubGlobal('prompt', () => 'renamed.png');
    container.querySelector<HTMLElement>('[data-act="rename"]')?.click();
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    const manage = calls.find(c => c.url.endsWith('/__assets/manage'));
    expect(JSON.parse(String(manage?.init?.body))).toMatchObject({ op: 'move', asset_path: 'assets/images/flat.png', new_name: 'renamed.png' });
  });

  it('writes a new text asset into assets/docs of the active folder', async () => {
    await open();
    [...container.querySelectorAll<HTMLElement>('.asset-lib-chip')].find(c => c.textContent === 'power-automate')?.click();
    container.querySelector<HTMLElement>('[data-act="write"]')?.click();
    const name = container.querySelector<HTMLInputElement>('.asset-lib-fname');
    const text = container.querySelector<HTMLTextAreaElement>('.asset-lib-text');
    if (!name || !text) throw new Error('no editor');
    name.value = 'brief.md';
    text.value = '# Brief\n\nSee [docs](https://learn.microsoft.com/power-automate/).';
    container.querySelector<HTMLElement>('[data-act="dsave"]')?.click();
    await until(() => calls.some(c => c.init?.method === 'POST' && c.url.includes('/assets/docs/')));
    const put = calls.find(c => c.init?.method === 'POST' && c.url.includes('/assets/docs/'));
    expect(put?.url).toBe('/__project_files/my-project/assets/docs/power-automate/brief.md');
    expect(String(put?.init?.body)).toContain('learn.microsoft.com');
  });

  it('refuses to save a non-text extension or an empty body', async () => {
    await open();
    container.querySelector<HTMLElement>('[data-act="write"]')?.click();
    const name = container.querySelector<HTMLInputElement>('.asset-lib-fname');
    const text = container.querySelector<HTMLTextAreaElement>('.asset-lib-text');
    if (!name || !text) throw new Error('no editor');
    name.value = 'sneaky.html';
    text.value = '<script>alert(1)</script>';
    container.querySelector<HTMLElement>('[data-act="dsave"]')?.click();
    await settle();
    expect(calls.some(c => c.url.includes('/assets/docs/'))).toBe(false);

    name.value = 'empty.md';
    text.value = '';
    container.querySelector<HTMLElement>('[data-act="dsave"]')?.click();
    await settle();
    expect(calls.some(c => c.url.includes('/assets/docs/'))).toBe(false);
  });

  it('loads an existing doc into the editor and saves back to the same path', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/__assets')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true, folders: ['briefs'],
          assets: [{ id: 'card-5', path: 'assets/docs/briefs/card-5.md', kind: 'docs', folder: 'briefs', bytes: 230 }],
        }), { status: 200 }));
      }
      if (String(url).endsWith('card-5.md') && init?.method !== 'POST') {
        return Promise.resolve(new Response('# Card 5\n', { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }));
    await open();
    container.querySelector<HTMLElement>('[data-act="editdoc"]')?.click();
    await until(() => container.querySelector<HTMLTextAreaElement>('.asset-lib-text')?.value === '# Card 5\n');
    const text = container.querySelector<HTMLTextAreaElement>('.asset-lib-text');
    expect(text?.value).toBe('# Card 5\n');
    expect(container.querySelector<HTMLInputElement>('.asset-lib-fname')?.readOnly).toBe(true);
    if (text) text.value = '# Card 5 revised\n';
    container.querySelector<HTMLElement>('[data-act="dsave"]')?.click();
    await until(() => calls.some(c => c.init?.method === 'POST'));
    const put = calls.find(c => c.init?.method === 'POST');
    expect(put?.url).toBe('/__project_files/my-project/assets/docs/briefs/card-5.md');
  });

  it('offers Edit on a doc but not on an image', async () => {
    await open();
    expect(container.querySelectorAll('[data-act="editdoc"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-act="insert"]')).toHaveLength(3);
  });

  it('shows a message instead of a grid when no project is open', () => {
    const panel = new AssetPanelManager(container, state);
    panel.setProject(null, null);
    expect(container.querySelector('.asset-lib-empty')?.textContent).toContain('Open a design');
  });
});
