import { describe, it, expect } from 'vitest';
import { buildNavItems, renderNavigation } from './navigation';
import type { Page } from '../schema/types';
import type { NavigationSpec } from '../schema/types';

const pages: Page[] = [
  { id: 'overview', label: 'Overview', layers: [] },
  { id: 'detail',   label: 'Detail',   layers: [] },
  { id: 'settings', layers: [] },          // no label — falls back to id
];

describe('buildNavItems', () => {
  it('builds items with correct index', () => {
    const items = buildNavItems(pages);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: 'overview', label: 'Overview', index: 0 });
    expect(items[1]).toMatchObject({ id: 'detail',   label: 'Detail',   index: 1 });
  });

  it('falls back to id when label missing', () => {
    const items = buildNavItems(pages);
    expect(items[2].label).toBe('settings');
  });

  it('returns empty array for no pages', () => {
    expect(buildNavItems([])).toEqual([]);
  });
});

describe('renderNavigation — sidebar', () => {
  const spec: NavigationSpec = { type: 'sidebar', width: 200, background: '#111', active_color: '#6c5ce7', labels: true };

  it('renders <nav class="folio-sidebar">', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('folio-sidebar');
  });

  it('includes custom width', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('width:200px');
  });

  it('contains all page labels', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('Overview');
    expect(html).toContain('Detail');
  });

  it('renders onclick with page id', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain("goto('overview')");
  });

  it('hides labels when labels:false', () => {
    const noLabelSpec: NavigationSpec = { type: 'sidebar', labels: false };
    const html = renderNavigation(noLabelSpec, pages);
    expect(html).not.toContain('Overview');
  });
});

describe('renderNavigation — topbar', () => {
  const spec: NavigationSpec = { type: 'topbar', background: '#222', active_color: '#fff' };

  it('renders <nav class="folio-topbar">', () => {
    expect(renderNavigation(spec, pages)).toContain('folio-topbar');
  });

  it('contains page labels', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('Overview');
    expect(html).toContain('Detail');
  });
});

describe('renderNavigation — tabs', () => {
  const spec: NavigationSpec = { type: 'tabs', active_color: '#6c5ce7' };

  it('renders tab buttons', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('folio-tabs');
    expect(html).toContain('nav-tab');
  });

  it('each page gets a button', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('data-page="overview"');
    expect(html).toContain('data-page="detail"');
  });
});

describe('renderNavigation — dots', () => {
  const spec: NavigationSpec = { type: 'dots' };

  it('renders dot spans', () => {
    const html = renderNavigation(spec, pages);
    expect(html).toContain('folio-dots');
    expect(html).toContain('nav-dot');
  });

  it('one dot per page', () => {
    const html = renderNavigation(spec, pages);
    const count = (html.match(/nav-dot/g) ?? []).length;
    expect(count).toBe(3);
  });
});

describe('renderNavigation — HTML escaping', () => {
  it('escapes special chars in labels', () => {
    const xssPages: Page[] = [{ id: 'p', label: '<script>alert(1)</script>', layers: [] }];
    const html = renderNavigation({ type: 'sidebar' }, xssPages);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
