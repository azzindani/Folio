import { describe, it, expect } from 'vitest';
import {
  esc, fmtBytes, fmtType, entryKey, navRow, tree, status, columnHeader, pane, shell,
  type Entry, type ViewState,
} from './asset-explorer-view';
import { commands } from './asset-explorer-chrome';
import type { AssetRow } from './asset-explorer-io';

const png = (path: string, extra: Partial<AssetRow> = {}): AssetRow => ({
  id: 'x', path, kind: 'images', bytes: 2048, width: 800, height: 600, added: '2026-08-12', ...extra,
});

const base = (over: Partial<ViewState> = {}): ViewState => ({
  project: 'demo',
  projects: [{ name: 'demo', designs: 2, assets: 5 }],
  scope: 'project',
  folder: '',
  entries: [],
  folders: [],
  libraryFolders: [],
  selected: new Set(),
  selectedFiles: 0,
  selectedFolders: 0,
  view: 'details',
  sort: 'name',
  desc: false,
  query: '',
  totalProject: 5,
  totalShared: 2,
  full: false,
  clip: '',
  canPaste: false,
  canBack: false,
  ...over,
});

const urlOf = (a: AssetRow): string => `/files/${a.path}`;

describe('formatting', () => {
  it('shows KB for small files and MB once it matters', () => {
    expect(fmtBytes(900)).toBe('1 KB');
    expect(fmtBytes(40_000)).toBe('39 KB');
    expect(fmtBytes(3_500_000)).toBe('3.3 MB');
  });

  it('types by extension, falling back to the kind when there is no sane one', () => {
    expect(fmtType(png('assets/images/a.png'))).toBe('PNG');
    expect(fmtType(png('assets/fonts/a.woff2', { kind: 'fonts' }))).toBe('WOFF2');
    expect(fmtType(png('assets/images/no-extension-here'))).toBe('IMAGES');
  });

  it('escapes markup in a filename — asset names come off a disk anyone can write to', () => {
    const html = pane(base({ entries: [{ type: 'file', asset: png('assets/images/<img onerror=x>.png') }] }), urlOf);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror');
    expect(esc(`"&'`)).toBe('&quot;&amp;&#39;');
  });

  it('keys folders and files apart, so a folder named like a file cannot collide', () => {
    expect(entryKey({ type: 'folder', name: 'shots', folder: 'shots', count: 0 })).toBe('folder:shots');
    expect(entryKey({ type: 'file', asset: png('assets/images/a.png') })).toBe('assets/images/a.png');
  });
});

describe('navigation row', () => {
  it('is just the root at the top of a store, with Up disabled', () => {
    const html = navRow(base());
    expect(html).toContain('demo');
    expect(html).not.toContain('ax-sep');
    expect(html).toMatch(/data-cmd="up"[^>]*disabled/);
  });

  it('gives every segment its own crumb, each navigating to that depth', () => {
    const html = navRow(base({ scope: 'library', folder: 'microsoft/logos' }));
    expect(html).toContain('data-nav="library:"');
    expect(html).toContain('data-nav="library:microsoft"');
    expect(html).toContain('data-nav="library:microsoft/logos"');
    expect(html).toContain('Shared library');
  });

  it('Up points at the PARENT, not at the root', () => {
    expect(navRow(base({ folder: 'clients/acme/logos' })))
      .toContain('data-nav-up="project:clients/acme"');
  });

  it('Back is dead until somewhere has been visited', () => {
    expect(navRow(base())).toMatch(/data-cmd="back"[^>]*disabled/);
    expect(navRow(base({ canBack: true }))).not.toMatch(/data-cmd="back"[^>]*disabled/);
  });
});

describe('command bar', () => {
  it('offers every verb at all times — disabled, never absent', () => {
    // The bar must not change shape as you click around: the position of Delete
    // is something a hand learns.
    const empty = commands(base()).map(c => c.id);
    const busy = commands(base({ selectedFiles: 2 })).map(c => c.id);
    expect(empty).toEqual(busy);
    expect(empty).toEqual(['newfolder', 'upload', 'write', 'cut', 'copy', 'paste', 'rename', 'moveto', 'delete']);
  });

  it('lights the verbs the selection actually supports', () => {
    const off = (s: ViewState, id: string): boolean =>
      Boolean(commands(s).find(c => c.id === id)?.disabled);

    expect(off(base(), 'cut'), 'cut with nothing selected').toBe(true);
    expect(off(base({ selectedFiles: 1 }), 'cut')).toBe(false);
    // Rename takes exactly one thing — "rename these three" has no meaning.
    expect(off(base({ selectedFiles: 1 }), 'rename')).toBe(false);
    expect(off(base({ selectedFiles: 2 }), 'rename')).toBe(true);
    // A folder counts for delete and move, but not for cut: moving a folder
    // rebuilds a tree, which is drag or Move-to, not the clipboard.
    expect(off(base({ selectedFolders: 1 }), 'delete')).toBe(false);
    expect(off(base({ selectedFolders: 1 }), 'cut')).toBe(true);
    expect(off(base(), 'paste')).toBe(true);
    expect(off(base({ canPaste: true }), 'paste')).toBe(false);
  });
});

describe('tree', () => {
  const twoProjects = [
    { name: 'demo', designs: 1, assets: 5 },
    { name: 'other', designs: 0, assets: 2 },
  ];

  it('separates projects from the shared library, under their own headings', () => {
    const html = tree(base({ projects: twoProjects }));
    // A shared folder that looks like a project folder is a trap: one travels
    // with the project, the other is visible to every project you own.
    expect(html.match(/ax-tree-h/g)).toHaveLength(2);
    expect(html).toContain('Projects');
    expect(html).toContain('Shared with every project');
  });

  it('lists EVERY project, and expands only the open one', () => {
    // Projects are containers, not folders — you switch between them, so they
    // all have to be reachable without a dropdown.
    const html = tree(base({ projects: twoProjects, folders: ['shots'] }));
    expect(html).toContain('data-project="demo"');
    expect(html).toContain('data-project="other"');
    // "shots" belongs to the open project, so it appears once, not per project.
    expect(html.match(/data-nav="project:shots"/g)).toHaveLength(1);
  });

  it('offers a create verb for projects, beside the heading', () => {
    expect(tree(base())).toContain('data-cmd="newproject"');
  });

  it('indents folders by depth and marks the current one active', () => {
    const html = tree(base({ folder: 'clients/acme', folders: ['clients', 'clients/acme'] }));
    expect(html).toContain('style="--d:2"');
    expect(html.match(/ax-node active/g)).toHaveLength(1);
  });

  it('marks nothing active while a search is running — results are not one folder', () => {
    expect(tree(base({ query: 'logo', folders: ['shots'] }))).not.toContain(' active');
  });
});

describe('status bar', () => {
  it('counts folders and files apart, and totals only the files', () => {
    const entries: Entry[] = [
      { type: 'folder', name: 'shots', folder: 'shots', count: 3 },
      { type: 'file', asset: png('assets/images/a.png', { bytes: 1024 }) },
      { type: 'file', asset: png('assets/images/b.png', { bytes: 1024 }) },
    ];
    const html = status(base({ entries }));
    expect(html).toContain('1 folder, 2 files');
    expect(html).toContain('2 KB');
    expect(html).toContain('5 in project · 2 shared');
  });

  it('reports the selection once there is one', () => {
    const entries: Entry[] = [{ type: 'file', asset: png('assets/images/a.png') }];
    expect(status(base({ entries, selected: new Set(['assets/images/a.png']) }))).toContain('1 selected');
    expect(status(base({ entries }))).not.toContain('selected');
  });
});

describe('the pane', () => {
  it('marks the sorted column and which way it points', () => {
    expect(columnHeader(base({ sort: 'size' }))).toContain('▴');
    expect(columnHeader(base({ sort: 'size', desc: true }))).toContain('▾');
    expect(columnHeader(base({ view: 'large' })), 'an icon view has no columns').toBe('');
  });

  it('renders the same items in every view mode', () => {
    const entries: Entry[] = [
      { type: 'folder', name: 'shots', folder: 'shots', count: 1 },
      { type: 'file', asset: png('assets/images/a.png') },
    ];
    for (const view of ['xl', 'large', 'medium', 'tiles', 'list', 'details'] as const) {
      const html = pane(base({ entries, view }), urlOf);
      expect(html.match(/data-key=/g), `${view} dropped an item`).toHaveLength(2);
      expect(html, `${view} lost the name`).toContain('a.png');
    }
  });

  it('dims a cut item wherever it appears', () => {
    const entries: Entry[] = [{ type: 'file', asset: png('assets/images/a.png') }];
    expect(pane(base({ entries }), urlOf)).not.toContain('cut ');
  });

  it('says the folder is empty rather than showing nothing at all', () => {
    expect(pane(base(), urlOf)).toContain('This folder is empty');
    expect(pane(base({ query: 'zzz' }), urlOf)).toContain('Nothing matches');
  });

  it('shows where a hit lives when searching, since results span folders', () => {
    const entries: Entry[] = [{ type: 'file', asset: png('assets/images/shots/a.png', { folder: 'shots' }) }];
    expect(pane(base({ entries, query: 'a' }), urlOf)).toContain('ax-loc');
    expect(pane(base({ entries }), urlOf)).not.toContain('ax-loc');
  });

  it('marks selected rows for the screen reader as well as the eye', () => {
    const entries: Entry[] = [{ type: 'file', asset: png('assets/images/a.png') }];
    const html = pane(base({ entries, selected: new Set(['assets/images/a.png']) }), urlOf);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('selected ');
  });

  it('makes folders draggable too — filing a folder into a folder is the point', () => {
    const entries: Entry[] = [
      { type: 'folder', name: 'shots', folder: 'shots', count: 1 },
      { type: 'file', asset: png('assets/images/a.png') },
    ];
    const html = pane(base({ entries }), urlOf);
    expect(html.match(/draggable="true"/g)).toHaveLength(2);
  });
});

describe('shell', () => {
  it('carries the file input and a drop overlay that starts hidden', () => {
    const html = shell(base(), urlOf);
    expect(html).toContain('type="file" multiple');
    expect(html).toMatch(/class="ax-drop" hidden/);
  });

  it('names the destination in the drop overlay so a drag cannot land somewhere surprising', () => {
    expect(shell(base({ folder: 'shots' }), urlOf)).toContain('<b>shots</b>');
    expect(shell(base({ scope: 'library' }), urlOf)).toContain('the shared library');
  });

  it('assembles the frame around the pane, in order', () => {
    const html = shell(base(), urlOf);
    // Navigation above commands above content: where a file manager puts them,
    // and what makes the verbs findable without opening anything.
    expect(html.indexOf('ax-nav')).toBeLessThan(html.indexOf('ax-cmdbar'));
    expect(html.indexOf('ax-cmdbar')).toBeLessThan(html.indexOf('ax-main'));
    expect(html.indexOf('ax-main')).toBeLessThan(html.indexOf('ax-status'));
  });
});
