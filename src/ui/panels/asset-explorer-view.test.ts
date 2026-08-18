import { describe, it, expect } from 'vitest';
import {
  esc, fmtBytes, fmtType, entryKey, crumbs, tree, status, columnHeader, pane, shell,
  type Entry, type ViewState,
} from './asset-explorer-view';
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
  tree: [],
  selected: new Set(),
  view: 'details',
  sort: 'name',
  desc: false,
  query: '',
  totalProject: 5,
  totalShared: 2,
  full: false,
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

describe('breadcrumb', () => {
  it('is just the root at the top of a store', () => {
    const html = crumbs(base());
    expect(html).toContain('demo');
    expect(html).not.toContain('ax-sep');
  });

  it('gives every segment its own crumb, each navigating to that depth', () => {
    const html = crumbs(base({ scope: 'library', folder: 'microsoft/logos' }));
    expect(html).toContain('data-nav="library:"');
    expect(html).toContain('data-nav="library:microsoft"');
    expect(html).toContain('data-nav="library:microsoft/logos"');
    expect(html).toContain('Shared library');
  });
});

describe('tree', () => {
  it('separates the two stores under their own headings', () => {
    const html = tree(base({
      tree: [
        { heading: 'This project' },
        { label: 'demo', scope: 'project', folder: '', depth: 0, root: true },
        { heading: 'Shared with every project' },
        { label: 'Shared library', scope: 'library', folder: '', depth: 0, root: true },
      ],
    }));
    // A shared folder that looks like a project folder is a trap: one travels
    // with the project, the other is visible to every project you own.
    expect(html.match(/ax-tree-h/g)).toHaveLength(2);
    expect(html).toContain('Shared with every project');
  });

  it('indents by depth and marks the current folder active', () => {
    const html = tree(base({
      folder: 'shots',
      tree: [
        { label: 'demo', scope: 'project', folder: '', depth: 0, root: true },
        { label: 'shots', scope: 'project', folder: 'shots', depth: 1 },
      ],
    }));
    expect(html).toContain('style="--d:1"');
    expect(html.match(/class="ax-node active"/g)).toHaveLength(1);
    expect(html).toContain('data-nav="project:shots"');
  });

  it('marks nothing active while a search is running — the results are not one folder', () => {
    const html = tree(base({
      query: 'logo',
      tree: [{ label: 'demo', scope: 'project', folder: '', depth: 0, root: true }],
    }));
    expect(html).not.toContain('active');
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
    expect(columnHeader(base({ view: 'icons' })), 'icons view has no columns').toBe('');
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
    expect(html).toContain('class="ax-row selected"');
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

  it('offers a project picker listing every project', () => {
    const html = shell(base({ projects: [{ name: 'demo', designs: 1, assets: 5 }, { name: 'other', designs: 0, assets: 0 }] }), urlOf);
    expect(html).toContain('<option value="demo" selected>');
    expect(html).toContain('<option value="other">');
  });
});
