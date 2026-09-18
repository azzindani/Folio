// A carousel exported — or previewed — as a paged report showed page one at the
// top of an otherwise empty screen, with no way to reach page two. These pin
// the three parts of the fix: a default pager, a page that fits the screen, and
// a body that actually has the screen's height to fit into.
import { describe, it, expect } from 'vitest';
import { assembleReportHTML } from './html-assembler';
import { renderPager } from '../report/navigation';
import type { DesignSpec, Page } from '../schema/types';

const deck = (pages: number, report?: Record<string, unknown>): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'Deck', type: 'carousel', created: '', modified: '' },
  document: { width: 1080, height: 1350, unit: 'px' },
  pages: Array.from({ length: pages }, (_, i) => ({ id: `p${i + 1}`, label: `P${i + 1}`, layers: [] })),
  ...(report ? { report } : {}),
} as unknown as DesignSpec);

describe('renderPager', () => {
  it('is prev · counter · next for two pages or more', () => {
    const html = renderPager([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Page[]);
    expect(html.match(/class="pager-btn"/g)).toHaveLength(2);
    expect(html).toContain('<span class="pager-cur">1</span> / 3');
  });

  it('is nothing for a single page', () => {
    expect(renderPager([{ id: 'a' }] as Page[])).toBe('');
  });
});

describe('assembleReportHTML — paged', () => {
  it('gives a paged deck with no configured navigation a pager', () => {
    const html = assembleReportHTML(deck(7), new Map());
    expect(html).toContain('class="folio-pager"');
    expect(html).toContain('/ 7');
  });

  it('leaves the pager out when the report configures its own navigation', () => {
    const html = assembleReportHTML(deck(3, { layout: 'paged', navigation: { type: 'dots' } }), new Map());
    expect(html).not.toContain('class="folio-pager"');
  });

  it('leaves it out of scroll and flow layouts, which show every page', () => {
    expect(assembleReportHTML(deck(3, { layout: 'scroll' }), new Map())).not.toContain('class="folio-pager"');
    expect(assembleReportHTML(deck(3, { layout: 'flow' }), new Map())).not.toContain('class="folio-pager"');
  });

  it('gives html a height, so body.layout-paged has a screen to fill', () => {
    // body{height:100%} of an html with only min-height resolves to auto, and the
    // body shrank to its content — the page at the top, empty screen below it.
    expect(assembleReportHTML(deck(2), new Map())).toMatch(/html\{height:100%\}/);
  });

  it('fits a plain page to the screen, both axes, centred', () => {
    const html = assembleReportHTML(deck(2), new Map());
    expect(html).toContain('.layout-paged .folio-page.active:has(> svg){display:flex;height:100%;align-items:center;justify-content:center}');
    expect(html).toContain('.layout-paged .folio-page.active > svg{width:100%;height:100%');
  });

  it('turns pages with the arrow keys and a swipe', () => {
    const html = assembleReportHTML(deck(2), new Map());
    expect(html).toContain("e.key==='ArrowRight'");
    expect(html).toContain("addEventListener('touchend'");
    // …and keeps the counter in step with the page.
    expect(html).toContain(".pager-cur");
  });
});
