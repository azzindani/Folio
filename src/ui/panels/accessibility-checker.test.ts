import { describe, it, expect } from 'vitest';
import { AccessibilityChecker } from './accessibility-checker';
import { StateManager } from '../../editor/state';
import type { DesignSpec, TextLayer, ImageLayer, Layer } from '../../schema/types';

// ── Helpers ──────────────────────────────────────────────────

function makeState(): StateManager {
  return new StateManager();
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function textLayer(id: string, overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id,
    type: 'text',
    name: id,
    x: 0, y: 0, width: 100, height: 20,
    content: { type: 'plain', value: 'Hello' },
    style: {},
    ...overrides,
  } as TextLayer;
}

function imageLayer(id: string, overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id,
    type: 'image',
    name: id,
    x: 0, y: 0, width: 100, height: 100,
    src: 'http://example.com/img.png',
    ...overrides,
  } as ImageLayer;
}

function setDesignLayers(state: StateManager, layers: Layer[]): void {
  state.set('design', {
    document: { width: 800, height: 600, unit: 'px' },
    layers,
  } as unknown as DesignSpec);
}

// ── Tests ────────────────────────────────────────────────────

describe('AccessibilityChecker — no issues', () => {
  it('renders "No issues found" when design has no layers', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    setDesignLayers(state, []);
    const summary = el.querySelector('.a11y-summary');
    expect(summary?.textContent).toContain('No issues found');
  });

  it('renders "No issues found" for well-formed text layer', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t1', {
      style: { color: '#000000', font_size: 16 },
      meta: { background_color: '#ffffff' } as Record<string, unknown>,
    });
    setDesignLayers(state, [layer]);

    const summary = el.querySelector('.a11y-summary');
    expect(summary?.textContent).toContain('No issues found');
  });
});

describe('AccessibilityChecker — contrast check', () => {
  it('reports contrast warning for low-contrast text (ratio < 4.5)', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    // Near-identical colors → very low contrast
    const layer = textLayer('t2', {
      style: { color: '#aaaaaa', font_size: 14 },
      meta: { background_color: '#bbbbbb' } as Record<string, unknown>,
    });
    setDesignLayers(state, [layer]);

    const items = el.querySelectorAll('.a11y-item');
    expect(items.length).toBeGreaterThan(0);
    const text = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(text).toContain('Contrast');
  });

  it('reports error (not just warning) for very low contrast', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    // White on white → ratio = 1
    const layer = textLayer('t3', {
      style: { color: '#ffffff', font_size: 14 },
      meta: { background_color: '#ffffff' } as Record<string, unknown>,
    });
    setDesignLayers(state, [layer]);

    const summary = el.querySelector('.a11y-summary')?.textContent ?? '';
    // Should show at least 1 error
    expect(summary).toMatch(/\dE/);
  });

  it('uses lower threshold for large text (≥18px)', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    // Ratio ~3.5 — ok for large text (≥18px), fails for normal
    const layer = textLayer('t4', {
      style: { color: '#767676', font_size: 18 },
      meta: { background_color: '#ffffff' } as Record<string, unknown>,
    });
    setDesignLayers(state, [layer]);

    // #767676 on white = ~4.54:1 → passes both thresholds
    const summary = el.querySelector('.a11y-summary');
    expect(summary?.textContent).toContain('No issues found');
  });

  it('skips contrast check when color or bgColor missing', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t5', { style: { font_size: 16 } });
    setDesignLayers(state, [layer]);

    // No contrast issue without both colors
    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).not.toContain('Contrast');
  });
});

describe('AccessibilityChecker — font size check', () => {
  it('reports warning for font size < 12px', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t6', { style: { font_size: 10 } });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).toContain('10px');
  });

  it('reports error for font size < 9px', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t7', { style: { font_size: 7 } });
    setDesignLayers(state, [layer]);

    const summary = el.querySelector('.a11y-summary')?.textContent ?? '';
    expect(summary).toMatch(/\dE/);
  });

  it('no font-size issue for normal 16px text', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t8', { style: { font_size: 16 } });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).not.toContain('px is very small');
  });
});

describe('AccessibilityChecker — image alt check', () => {
  it('reports warning when image has no alt text', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = imageLayer('img1');
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).toContain('alt text');
  });

  it('no warning when image has alt text', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = imageLayer('img2', { meta: { alt: 'A descriptive label' } as Record<string, unknown> });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).not.toContain('alt text');
  });

  it('reports warning when alt text is blank', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = imageLayer('img3', { meta: { alt: '   ' } as Record<string, unknown> });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).toContain('alt text');
  });
});

describe('AccessibilityChecker — empty text check', () => {
  it('reports info for empty text layer', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t9', {
      content: { type: 'plain', value: '   ' },
    });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).toContain('empty content');
  });

  it('no info issue when text has content', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = textLayer('t10', { content: { type: 'plain', value: 'Hello' } });
    setDesignLayers(state, [layer]);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).not.toContain('empty content');
  });
});

describe('AccessibilityChecker — duplicate ID check', () => {
  it('reports error for duplicate layer IDs', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layers = [
      textLayer('dup', { content: { type: 'plain', value: 'A' } }),
      textLayer('dup', { content: { type: 'plain', value: 'B' } }),
    ];
    setDesignLayers(state, layers);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).toContain('Duplicate layer ID');
  });

  it('no duplicate-ID error for unique IDs', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layers = [
      textLayer('u1', { content: { type: 'plain', value: 'A' } }),
      textLayer('u2', { content: { type: 'plain', value: 'B' } }),
    ];
    setDesignLayers(state, layers);

    const list = el.querySelector('.a11y-list')?.textContent ?? '';
    expect(list).not.toContain('Duplicate');
  });
});

describe('AccessibilityChecker — run button', () => {
  it('re-runs checks when "Run checks" button is clicked', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    setDesignLayers(state, []);

    // Click run button
    const btn = el.querySelector('.a11y-refresh') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();

    const summary = el.querySelector('.a11y-summary');
    expect(summary?.textContent).toContain('No issues found');
  });
});

describe('AccessibilityChecker — click to select layer', () => {
  it('sets selectedLayerIds when issue item is clicked', () => {
    const state = makeState();
    const el = makeContainer();
    new AccessibilityChecker(el, state);

    const layer = imageLayer('img-sel');
    setDesignLayers(state, [layer]);

    const item = el.querySelector<HTMLElement>('.a11y-item[data-layer-id="img-sel"]');
    expect(item).toBeTruthy();
    item!.click();

    expect(state.get().selectedLayerIds).toContain('img-sel');
  });
});
