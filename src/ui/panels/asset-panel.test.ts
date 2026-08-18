import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssetPanelManager } from './asset-panel';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

const ASSETS = [
  { id: 'flat', path: 'assets/images/flat.png', kind: 'images', bytes: 2048, width: 800, height: 600 },
  { id: 'step-1', path: 'assets/images/power-automate/step-1.png', kind: 'images', folder: 'power-automate', bytes: 4096, width: 1200, height: 800, alt: 'Flow designer' },
  { id: 'brand', path: 'assets/fonts/brand.woff2', kind: 'fonts', bytes: 9000 },
  { id: 'pa', path: 'lib/microsoft/logos/pa.svg', kind: 'images', folder: 'microsoft/logos', bytes: 700, width: 48, height: 48 },
];

function makeDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1350, unit: 'px', dpi: 96 },
    layers: [],
  } as unknown as DesignSpec;
}

/** Poll until `cond` holds, so a slow dynamic import (toast) cannot flake. */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
}

let container: HTMLElement;
let state: StateManager;
let calls: { url: string; init?: RequestInit }[];

function stubServer(assets = ASSETS, projects = [{ name: 'demo', designs: 1, assets: 4 }]): void {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/__projects')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, projects }), { status: 200 }));
    }
    if (String(url).endsWith('/__assets')) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true, assets, folders: ['power-automate'], library_folders: ['microsoft', 'microsoft/logos'],
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }));
}

/** Open the panel and wait for its first REAL paint — the constructor puts a
 *  "Loading assets…" message up immediately, which is not a settled state. */
async function open(project: string | null = 'my-project'): Promise<AssetPanelManager> {
  const panel = new AssetPanelManager(container, state);
  panel.setProject(project, 'tok');
  await until(() => Boolean(container.querySelector('.ax-list'))
    || !/Loading/.test(container.querySelector('.ax-message')?.textContent ?? 'Loading'));
  return panel;
}

const names = (): (string | null)[] =>
  [...container.querySelectorAll('.ax-row .ax-nm')].map(n => n.textContent);
const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.ax-row')];
/** Address a row by what it says, not where it sits — sort order is a feature
 *  under test, so an index-based test would break every time it changes. */
const rowFor = (name: string): HTMLElement => {
  const hit = rows().find(r => r.querySelector('.ax-nm')?.textContent === name);
  if (!hit) throw new Error(`no row "${name}" in [${names().join(', ')}]`);
  return hit;
};
const click = (el: Element | null | undefined, init: MouseEventInit = {}): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
};

/** Answer the panel's own dialog. It no longer uses window.prompt/confirm —
 *  those are modal to the whole browser and unstyleable — so a test drives the
 *  real one, which is also the only way to prove it is wired up. */
async function answerDialog(text?: string): Promise<void> {
  await until(() => Boolean(document.querySelector('.ax-modal')));
  const input = document.querySelector<HTMLInputElement>('.ax-modal-input');
  if (text !== undefined && input) input.value = text;
  document.querySelector<HTMLButtonElement>('.ax-modal [data-x="ok"]')?.click();
}
const dismissDialog = async (): Promise<void> => {
  await until(() => Boolean(document.querySelector('.ax-modal')));
  document.querySelector<HTMLButtonElement>('.ax-modal [data-x="cancel"]')?.click();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  state = new StateManager();
  state.set('design', makeDesign());
  calls = [];
  stubServer();
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

describe('AssetPanelManager — opening', () => {
  it('finds its own project when nothing told it one', async () => {
    // The bug this fixes: the manager only ever initialised as a side effect of
    // opening a server-backed design, so anyone who came here to upload FIRST
    // met an empty pane with no controls and no way to add a file.
    await open(null);
    expect(container.querySelector('[data-act="upload"]')).toBeTruthy();
    expect(container.querySelector<HTMLSelectElement>('.ax-project')?.value).toBe('demo');
    expect(calls.some(c => c.url.endsWith('/__projects'))).toBe(true);
  });

  it('says so plainly when the server has no projects at all', async () => {
    stubServer(ASSETS, []);
    await open(null);
    expect(container.querySelector('.ax-message')?.textContent).toContain('No projects yet');
  });

  it('lists folders before files', async () => {
    await open();
    expect(names()).toEqual(['power-automate', 'brand.woff2', 'flat.png']);
  });

  it('switching project in the picker re-lists against that project', async () => {
    await open();
    const picker = container.querySelector<HTMLSelectElement>('.ax-project');
    if (!picker) throw new Error('no picker');
    picker.value = 'demo';
    picker.dispatchEvent(new Event('change'));
    await until(() => calls.some(c => c.url.startsWith('/__project_files/demo/__assets')));
    expect(calls.some(c => c.url === '/__project_files/demo/__assets')).toBe(true);
  });
});

describe('AssetPanelManager — navigating', () => {
  it('opens a folder from the tree and shows only what is in it', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="project:power-automate"]'));
    expect(names()).toEqual(['step-1.png']);
    expect(container.querySelector('.ax-crumb-path')?.textContent).toContain('power-automate');
  });

  it('double-clicking a folder row goes into it', async () => {
    await open();
    rows()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(names()).toEqual(['step-1.png']);
  });

  it('a crumb walks back up', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="project:power-automate"]'));
    click(container.querySelector('.ax-crumb'));
    expect(names()).toEqual(['power-automate', 'brand.woff2', 'flat.png']);
  });

  it('the shared library is its own tree, with its nested folders', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="library:microsoft/logos"]'));
    expect(names()).toEqual(['pa.svg']);
  });

  it('search spans both stores and every folder, since you search when you forgot where it went', async () => {
    await open();
    const search = container.querySelector<HTMLInputElement>('.ax-search');
    if (!search) throw new Error('no search');
    search.value = 'designer';           // matches alt text, not the filename
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['step-1.png']);

    const next = container.querySelector<HTMLInputElement>('.ax-search');
    if (!next) throw new Error('no search');
    next.value = 'pa';                   // a library asset, from the project root
    next.dispatchEvent(new Event('input'));
    expect(names()).toContain('pa.svg');
  });

  it('sorting by a column toggles direction on a second click', async () => {
    await open();
    click(container.querySelector('[data-sort="size"]'));
    expect(names()).toEqual(['power-automate', 'flat.png', 'brand.woff2']);
    click(container.querySelector('[data-sort="size"]'));
    expect(names()).toEqual(['power-automate', 'brand.woff2', 'flat.png']);
  });
});

describe('AssetPanelManager — selecting', () => {
  it('ctrl-click builds a multi-selection and the status bar counts it', async () => {
    await open();
    click(rowFor('flat.png'));
    click(rowFor('brand.woff2'), { ctrlKey: true });
    expect(container.querySelectorAll('.ax-row.selected')).toHaveLength(2);
    expect(container.querySelector('.ax-status span')?.textContent).toContain('2 selected');
  });

  it('re-selecting does not rebuild the list — thumbnails would reload on every click', async () => {
    await open();
    const first = rowFor('flat.png');
    click(first);
    expect(rowFor('flat.png')).toBe(first);
    expect(first?.classList.contains('selected')).toBe(true);
  });

  it('a right-click on an unselected row selects it before opening the menu', async () => {
    await open();
    rowFor('flat.png').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(rowFor('flat.png').classList.contains('selected')).toBe(true);
    const items = [...document.querySelectorAll('.ax-menu-item')].map(i => i.textContent);
    expect(items.some(t => t?.includes('Place on canvas'))).toBe(true);
    expect(items.some(t => t?.includes('Delete'))).toBe(true);
    document.querySelectorAll('.ax-menu').forEach(m => m.remove());
  });

  it('the Place verb counts only what can actually be placed', async () => {
    await open();
    click(rowFor('flat.png'));
    click(rowFor('brand.woff2'), { ctrlKey: true });   // a font cannot be placed
    rowFor('flat.png').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const items = [...document.querySelectorAll('.ax-menu-item')].map(i => i.textContent);
    // "Place 2" that places one is a small lie, and the kind of thing that
    // teaches people not to trust the counts elsewhere in the UI.
    expect(items.some(t => t?.startsWith('Place on canvas'))).toBe(true);
    expect(items.some(t => t?.includes('Place 2'))).toBe(false);
    expect(items.some(t => t?.includes('Delete 2 items'))).toBe(true);
    document.querySelectorAll('.ax-menu').forEach(m => m.remove());
  });

  it('a folder gets folder verbs, not file ones', async () => {
    await open();
    rows()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const items = [...document.querySelectorAll('.ax-menu-item')].map(i => i.textContent);
    expect(items).toContain('Open');
    expect(items.some(t => t?.includes('Delete folder'))).toBe(true);
    expect(items.some(t => t?.includes('Place on canvas'))).toBe(false);
    document.querySelectorAll('.ax-menu').forEach(m => m.remove());
  });
});

describe('AssetPanelManager — file operations', () => {
  const uploadFiles = (files: File[]): void => {
    const input = container.querySelector<HTMLInputElement>('.ax-file');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('uploads into the folder you are looking at', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="project:power-automate"]'));
    uploadFiles([new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })]);
    await until(() => calls.some(c => c.init?.method === 'POST' && c.url.includes('/assets/')));
    expect(calls.find(c => c.init?.method === 'POST')?.url)
      .toBe('/__project_files/my-project/assets/images/power-automate/shot.png');
  });

  it('routes by extension: a font lands in assets/fonts, a doc in assets/docs', async () => {
    await open();
    uploadFiles([
      new File([new Uint8Array([1])], 'brand.woff2', { type: 'font/woff2' }),
      new File(['# hi'], 'brief.md', { type: 'text/markdown' }),
    ]);
    await until(() => calls.filter(c => c.init?.method === 'POST').length >= 2);
    const posted = calls.filter(c => c.init?.method === 'POST').map(c => c.url);
    expect(posted[0]).toContain('/assets/fonts/brand.woff2');
    expect(posted[1]).toContain('/assets/docs/brief.md');
  });

  it('uploads into the shared library with the folder as a query param', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="library:microsoft/logos"]'));
    uploadFiles([new File([new Uint8Array([1])], 'x.svg', { type: 'image/svg+xml' })]);
    await until(() => calls.some(c => c.init?.method === 'POST' && c.url.includes('scope=library')));
    // A URL path segment cannot carry the slash a nested library folder needs.
    expect(calls.find(c => c.url.includes('scope=library'))?.url)
      .toContain('folder=microsoft%2Flogos');
  });

  it('makes a folder through the manage endpoint', async () => {
    await open();
    click(container.querySelector('[data-act="newfolder"]'));
    await answerDialog('Screenshots');
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    expect(JSON.parse(String(calls.find(c => c.url.endsWith('/__assets/manage'))?.init?.body)))
      .toMatchObject({ op: 'mkdir', folder: 'Screenshots', scope: 'project' });
  });

  it('makes the folder INSIDE the one that is open, not at the root', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="project:power-automate"]'));
    click(container.querySelector('[data-act="newfolder"]'));
    await answerDialog('run-2');
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    // Sending the name as an absolute path is what made "New folder" look
    // intermittent: it worked at the root, and from anywhere deeper it created
    // the folder somewhere else and showed nothing.
    expect(JSON.parse(String(calls.find(c => c.url.endsWith('/__assets/manage'))?.init?.body)))
      .toMatchObject({ op: 'mkdir', folder: 'power-automate/run-2' });
  });

  it('Delete on a FOLDER deletes it, contents and all', async () => {
    await open();
    click(rowFor('power-automate'));
    container.querySelector('.ax-list')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await until(() => Boolean(document.querySelector('.ax-modal')));
    // Folder keys are "folder:<path>" and never resolve through the asset list,
    // so Delete used to silently do nothing at all when a folder was selected.
    expect(document.querySelector('.ax-modal-body')?.textContent).toContain('inside');
    await answerDialog();
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    expect(JSON.parse(String(calls.find(c => c.url.endsWith('/__assets/manage'))?.init?.body)))
      .toMatchObject({ op: 'rmdir', folder: 'power-automate', scope: 'project' });
  });

  it('the folder delete confirm counts everything below it, not just the top', async () => {
    await open();
    click(rowFor('power-automate'));
    container.querySelector('.ax-list')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await until(() => Boolean(document.querySelector('.ax-modal')));
    // Confirming "3 items" and then removing nine is worse than not asking.
    expect(document.querySelector('.ax-modal-body')?.textContent).toContain('1 item');
    await dismissDialog();
  });

  it('deletes the whole selection in one action, after confirming', async () => {
    await open();
    click(rowFor('flat.png'));
    click(rowFor('brand.woff2'), { ctrlKey: true });
    const list = container.querySelector('.ax-list');
    list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await answerDialog();
    await until(() => calls.filter(c => c.url.endsWith('/__assets/manage')).length >= 2);
    const ops = calls.filter(c => c.url.endsWith('/__assets/manage'))
      .map(c => JSON.parse(String(c.init?.body)) as { op: string; asset_path: string });
    expect(ops.map(o => o.op)).toEqual(['delete', 'delete']);
    expect(ops.map(o => o.asset_path).sort())
      .toEqual(['assets/fonts/brand.woff2', 'assets/images/flat.png']);
  });

  it('does not delete when the confirm is declined', async () => {
    await open();
    click(rowFor('flat.png'));
    container.querySelector('.ax-list')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await dismissDialog();
    await new Promise(r => setTimeout(r, 30));
    expect(calls.some(c => c.url.endsWith('/__assets/manage'))).toBe(false);
  });

  it('F2 renames the one selected file', async () => {
    await open();
    click(rowFor('flat.png'));
    container.querySelector('.ax-list')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    // The extension is preselected out of the way, so typing replaces the stem.
    await until(() => Boolean(document.querySelector('.ax-modal-input')));
    expect(document.querySelector<HTMLInputElement>('.ax-modal-input')?.selectionEnd).toBe('flat'.length);
    await answerDialog('renamed.png');
    await until(() => calls.some(c => c.url.endsWith('/__assets/manage')));
    expect(JSON.parse(String(calls.find(c => c.url.endsWith('/__assets/manage'))?.init?.body)))
      .toMatchObject({ op: 'move', asset_path: 'assets/images/flat.png', new_name: 'renamed.png' });
  });

  it('Ctrl+A takes everything on screen', async () => {
    await open();
    container.querySelector('.ax-list')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(container.querySelectorAll('.ax-row.selected')).toHaveLength(3);
  });
});

describe('AssetPanelManager — placing on the canvas', () => {
  it('places an image centred, scaled to fit, on top', async () => {
    await open();
    rowFor('flat.png').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ type: 'image', src: 'assets/images/flat.png', fit: 'cover' });
    expect(state.get().selectedLayerIds).toHaveLength(1);
  });

  it('does not place a font', async () => {
    await open();
    rowFor('brand.woff2').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(state.getCurrentLayers()).toHaveLength(0);
  });
});

describe('AssetPanelManager — writing a text asset', () => {
  it('saves a new brief into assets/docs of the folder in view', async () => {
    await open();
    click(container.querySelector('.ax-node[data-nav="project:power-automate"]'));
    click(container.querySelector('[data-act="write"]'));
    const name = container.querySelector<HTMLInputElement>('.ax-fname');
    const text = container.querySelector<HTMLTextAreaElement>('.ax-text');
    if (!name || !text) throw new Error('no editor');
    name.value = 'brief.md';
    text.value = '# Brief\n\nSee [docs](https://learn.microsoft.com/power-automate/).';
    click(container.querySelector('[data-act="dsave"]'));
    await until(() => calls.some(c => c.init?.method === 'POST' && c.url.includes('/assets/docs/')));
    const put = calls.find(c => c.init?.method === 'POST' && c.url.includes('/assets/docs/'));
    expect(put?.url).toBe('/__project_files/my-project/assets/docs/power-automate/brief.md');
    // Sent as a Blob, on the same upload route a dropped file uses — one ingest
    // path means a typed brief and an uploaded one get identical treatment.
    expect(await (put?.init?.body as Blob).text()).toContain('learn.microsoft.com');
  });

  it('refuses a non-text extension and an empty body', async () => {
    await open();
    click(container.querySelector('[data-act="write"]'));
    const name = container.querySelector<HTMLInputElement>('.ax-fname');
    const text = container.querySelector<HTMLTextAreaElement>('.ax-text');
    if (!name || !text) throw new Error('no editor');
    name.value = 'sneaky.html';
    text.value = '<script>alert(1)</script>';
    click(container.querySelector('[data-act="dsave"]'));
    await new Promise(r => setTimeout(r, 30));
    expect(calls.some(c => c.url.includes('/assets/docs/'))).toBe(false);

    name.value = 'empty.md';
    text.value = '';
    click(container.querySelector('[data-act="dsave"]'));
    await new Promise(r => setTimeout(r, 30));
    expect(calls.some(c => c.url.includes('/assets/docs/'))).toBe(false);
  });

  it('Cancel returns to the file list rather than stranding the editor', async () => {
    await open();
    click(container.querySelector('[data-act="write"]'));
    expect(container.querySelector('.ax-text')).toBeTruthy();
    click(container.querySelector('[data-act="dcancel"]'));
    expect(container.querySelector('.ax-text')).toBeNull();
    expect(container.querySelectorAll('.ax-row')).toHaveLength(3);
  });
});
