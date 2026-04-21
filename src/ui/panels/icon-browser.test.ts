import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IconBrowserManager } from './icon-browser';
import { ALL_ICON_NAMES } from '../../renderer/lucide-icons';

// ── Minimal StateManager mock ───────────────────────────────────────────────

function makeState(design: object | null = null) {
  const state = {
    design,
    selectedLayerIds: [] as string[],
  };

  const addLayer = vi.fn((layer: object) => {
    if (!state.design) return;
    // Simulate addLayer updating the design layers array
    (state.design as Record<string, unknown>).layers = [
      ...(((state.design as Record<string, unknown>).layers as unknown[]) ?? []),
      layer,
    ];
  });

  const set = vi.fn((key: string, value: unknown) => {
    (state as Record<string, unknown>)[key] = value;
  });

  const get = vi.fn(() => state);

  return { state, addLayer, set, get };
}

function makeDesign() {
  return {
    _protocol: 'design/v1' as const,
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [] as unknown[],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fireInput(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('IconBrowserManager', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('builds HTML with .ib-search input and .ib-grid element', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    expect(container.querySelector('.ib-search')).not.toBeNull();
    expect(container.querySelector('.ib-grid')).not.toBeNull();
  });

  it('.ib-footer shows total icon count initially', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const footer = container.querySelector('.ib-footer');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain(`${ALL_ICON_NAMES.length} icons`);
  });

  it('creates .ib-tile buttons for all icons initially', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const tiles = container.querySelectorAll('.ib-tile');
    expect(tiles.length).toBe(ALL_ICON_NAMES.length);
  });

  it('after search input event, grid filters icons by name', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const search = container.querySelector<HTMLInputElement>('.ib-search')!;
    // Use a term that matches a known subset
    const term = 'arrow';
    const expected = ALL_ICON_NAMES.filter(n => n.includes(term));

    fireInput(search, term);

    const tiles = container.querySelectorAll('.ib-tile');
    expect(tiles.length).toBe(expected.length);
    // Each tile's title should include the search term
    tiles.forEach(tile => {
      expect(tile.getAttribute('title')).toContain(term);
    });
  });

  it('empty search string shows all icons', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const search = container.querySelector<HTMLInputElement>('.ib-search')!;

    // First filter, then clear
    fireInput(search, 'arrow');
    fireInput(search, '');

    const tiles = container.querySelectorAll('.ib-tile');
    expect(tiles.length).toBe(ALL_ICON_NAMES.length);
  });

  it('footer count updates after search', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const search = container.querySelector<HTMLInputElement>('.ib-search')!;
    const term = 'arrow';
    const expected = ALL_ICON_NAMES.filter(n => n.includes(term));

    fireInput(search, term);

    const footer = container.querySelector('.ib-footer')!;
    expect(footer.textContent).toContain(`${expected.length} icons`);
  });

  it('clicking an icon tile calls state.addLayer() when design exists', () => {
    const design = makeDesign();
    const { get, addLayer, set } = makeState(design);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const firstTile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    firstTile.click();

    expect(addLayer).toHaveBeenCalledOnce();
    const added = addLayer.mock.calls[0][0] as Record<string, unknown>;
    expect(added.type).toBe('icon');
    expect(typeof added.id).toBe('string');
  });

  it('clicking an icon tile does nothing (no crash) when design is null', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const firstTile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    expect(() => firstTile.click()).not.toThrow();
    expect(addLayer).not.toHaveBeenCalled();
  });

  it('insertIcon sets selectedLayerIds to the new icon layer id', () => {
    const design = makeDesign();
    const { get, addLayer, set } = makeState(design);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const firstTile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    firstTile.click();

    expect(set).toHaveBeenCalledWith('selectedLayerIds', expect.any(Array));
    const [, ids] = set.mock.calls.find(c => c[0] === 'selectedLayerIds')!;
    expect((ids as string[]).length).toBe(1);
    // The id matches the added layer
    const added = addLayer.mock.calls[0][0] as Record<string, unknown>;
    expect((ids as string[])[0]).toBe(added.id);
  });

  it('mouseenter changes tile background style without crashing', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const tile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    expect(() => {
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }).not.toThrow();
    expect(tile.style.background).toBe('var(--color-surface)');
  });

  it('mouseleave resets tile background style without crashing', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const tile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(() => {
      tile.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }).not.toThrow();
    expect(tile.style.background).toBe('transparent');
  });

  it('icon tile has correct name as title attribute', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const tiles = container.querySelectorAll<HTMLButtonElement>('.ib-tile');
    const titles = Array.from(tiles).map(t => t.title);
    // ALL_ICON_NAMES is sorted; titles must match the sorted icon names
    expect(titles).toEqual([...ALL_ICON_NAMES].sort());
  });

  it('tile SVG is present inside each button', () => {
    const { get, addLayer, set } = makeState(null);
    new IconBrowserManager(container, { get, addLayer, set } as unknown as import('../../editor/state').StateManager);

    const firstTile = container.querySelector<HTMLButtonElement>('.ib-tile')!;
    expect(firstTile.querySelector('svg')).not.toBeNull();
  });
});
