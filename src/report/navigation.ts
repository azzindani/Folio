import type { NavigationSpec, Page } from '../schema/types';

export interface NavItem {
  id: string;
  label: string;
  index: number;
}

export function buildNavItems(pages: Page[]): NavItem[] {
  return pages.map((p, i) => ({
    id: p.id,
    label: p.label ?? p.id,
    index: i,
  }));
}

/**
 * Renders navigation HTML for report export.
 * Returns an HTML string fragment to be inserted into the report shell.
 */
export function renderNavigation(spec: NavigationSpec, pages: Page[]): string {
  const items = buildNavItems(pages);
  const navType = spec.type ?? 'sidebar';

  switch (navType) {
    case 'sidebar': return renderSidebar(spec, items);
    case 'topbar':  return renderTopbar(spec, items);
    case 'tabs':    return renderTabs(spec, items);
    case 'dots':    return renderDots(items);
    default:        return '';
  }
}

function renderSidebar(spec: NavigationSpec, items: NavItem[]): string {
  const bg = spec.background ?? '#1a1a2e';
  const activeColor = spec.active_color ?? '#6c5ce7';
  const width = spec.width ?? 240;

  const listItems = items.map(item =>
    `<li class="nav-item" data-page="${item.id}" onclick="window.Folio.nav.goto('${item.id}')">${
      spec.labels !== false ? escHtml(item.label) : ''
    }</li>`
  ).join('\n');

  return `<nav class="folio-sidebar" style="width:${width}px;background:${escHtml(bg)};">
  <ul class="nav-list" data-active-color="${escHtml(activeColor)}">
${listItems}
  </ul>
</nav>`;
}

function renderTopbar(spec: NavigationSpec, items: NavItem[]): string {
  const bg = spec.background ?? '#1a1a2e';
  const activeColor = spec.active_color ?? '#6c5ce7';

  const listItems = items.map(item =>
    `<li class="nav-item" data-page="${item.id}" onclick="window.Folio.nav.goto('${item.id}')">${escHtml(item.label)}</li>`
  ).join('\n');

  return `<nav class="folio-topbar" style="background:${escHtml(bg)};" data-active-color="${escHtml(activeColor)}">
  <ul class="nav-list">${listItems}</ul>
</nav>`;
}

function renderTabs(spec: NavigationSpec, items: NavItem[]): string {
  const activeColor = spec.active_color ?? '#6c5ce7';
  const tabs = items.map(item =>
    `<button class="nav-tab" data-page="${item.id}" onclick="window.Folio.nav.goto('${item.id}')">${escHtml(item.label)}</button>`
  ).join('\n');

  return `<div class="folio-tabs" data-active-color="${escHtml(activeColor)}">${tabs}</div>`;
}

function renderDots(items: NavItem[]): string {
  const dots = items.map(item =>
    `<span class="nav-dot" data-page="${item.id}" onclick="window.Folio.nav.goto('${item.id}')"></span>`
  ).join('');
  return `<div class="folio-dots">${dots}</div>`;
}

/**
 * The default way through a paged report that configured no navigation.
 *
 * A carousel exported (or previewed) as a paged report showed page one and
 * nothing else — no nav unless `report.navigation` was set, no keys, no swipe —
 * so six of seven pages were unreachable. Prev · counter · next, BELOW the page
 * where a thumb reaches it; the runtime adds arrow keys and swipe on top.
 */
export function renderPager(pages: Page[]): string {
  if (pages.length < 2) return '';
  return `<nav class="folio-pager" aria-label="Pages">
  <button class="pager-btn" type="button" aria-label="Previous page" onclick="window.Folio.nav.prev()">&#8249;</button>
  <span class="pager-count" aria-live="polite"><span class="pager-cur">1</span> / ${pages.length}</span>
  <button class="pager-btn" type="button" aria-label="Next page" onclick="window.Folio.nav.next()">&#8250;</button>
</nav>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
