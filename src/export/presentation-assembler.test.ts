import { describe, it, expect, vi } from 'vitest';
import { assemblePresentationHTML } from './presentation-assembler';
import type { DesignSpec } from '../schema/types';

const mockRenderToSVGString = vi.fn((_spec: unknown, _ctx?: unknown) => '<svg><rect/></svg>');

vi.mock('../mcp/engine/svg-export', () => ({
  renderToSVGString: (spec: unknown, ctx?: unknown) => mockRenderToSVGString(spec, ctx),
}));

function makeSpec(overrides: Partial<DesignSpec> = {}): DesignSpec {
  return {
    _protocol: 'design/v1',
    _mode: 'done',
    meta: { id: 'p1', name: 'Test Deck', type: 'presentation', created: '', modified: '' },
    document: { width: 1920, height: 1080, unit: 'px', dpi: 96 },
    layers: [],
    pages: [
      { id: 'slide_1', label: 'Intro', layers: [], notes: 'First slide note', transition: { type: 'fade', duration: 400 } },
      { id: 'slide_2', label: 'Content', layers: [] },
    ],
    ...overrides,
  } as unknown as DesignSpec;
}

describe('assemblePresentationHTML', () => {
  it('returns a valid HTML string', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('embeds title from spec meta', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('<title>Test Deck</title>');
  });

  it('allows title override via opts', () => {
    const html = assemblePresentationHTML(makeSpec(), { title: 'My Custom Title' });
    expect(html).toContain('<title>My Custom Title</title>');
  });

  it('defaults to dark theme', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('data-theme="dark"');
  });

  it('respects light theme option', () => {
    const html = assemblePresentationHTML(makeSpec(), { theme: 'light' });
    expect(html).toContain('data-theme="light"');
  });

  it('renders a section per page', () => {
    const html = assemblePresentationHTML(makeSpec());
    const sectionCount = (html.match(/<section /g) ?? []).length;
    expect(sectionCount).toBe(2);
  });

  it('first slide has active class', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('class="ft-slide active"');
  });

  it('embeds slide data JSON', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('folio-page-data');
    expect(html).toContain('"id":"slide_1"');
  });

  it('includes transition CSS keyframes', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('@keyframes ft-fade-400-in');
  });

  it('includes presentation runtime JS', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('FolioPresenter');
    expect(html).toContain('btn-prev');
    expect(html).toContain('btn-next');
  });

  it('includes keyboard navigation JS', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('ArrowRight');
    expect(html).toContain('ArrowLeft');
  });

  it('includes touch swipe support', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('touchstart');
    expect(html).toContain('touchend');
  });

  it('includes progress bar', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('folio-progress');
    expect(html).toContain('folio-progress-bar');
  });

  it('includes speaker notes panel', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('folio-notes');
    expect(html).toContain('btn-notes');
  });

  it('embeds notes in page data', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('First slide note');
  });

  it('embeds auto_advance override in page data', () => {
    const html = assemblePresentationHTML(makeSpec(), { auto_advance: 5000 });
    expect(html).toContain('"autoMs":5000');
  });

  it('renders audio tracks when spec.audio is provided', () => {
    const spec = makeSpec({
      audio: [{ id: 'bg', src: 'bg.mp3', loop: true }],
    } as Partial<DesignSpec>);
    const html = assemblePresentationHTML(spec);
    expect(html).toContain('<audio id="audio-bg"');
    expect(html).toContain('loop');
    expect(html).toContain('bg.mp3');
  });

  it('renders no audio elements when no audio tracks', () => {
    const html = assemblePresentationHTML(makeSpec());
    expect(html).not.toContain('<audio');
  });

  it('handles render error gracefully', () => {
    mockRenderToSVGString.mockImplementationOnce(() => { throw new Error('boom'); });
    const html = assemblePresentationHTML(makeSpec());
    expect(html).toContain('Render error');
  });

  it('handles spec with no pages', () => {
    const spec = makeSpec({ pages: [] } as Partial<DesignSpec>);
    const html = assemblePresentationHTML(spec);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<section');
  });

  it('escapes special chars in title', () => {
    const spec = makeSpec();
    spec.meta.name = '<script>alert("xss")</script>';
    const html = assemblePresentationHTML(spec);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
