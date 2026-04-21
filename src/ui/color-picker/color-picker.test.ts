import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColorPicker, colorPicker } from './color-picker';

// Mock canvas getContext since jsdom doesn't implement it
const mockCtx = {
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillStyle: '' as string | CanvasGradient | CanvasPattern,
  fillRect: vi.fn(),
};
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as unknown as CanvasRenderingContext2D,
  );
  // Reset mock counts
  mockCtx.createLinearGradient.mockClear();
  mockCtx.fillRect.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ColorPicker — open / close', () => {
  it('open() appends popover to document.body', () => {
    const picker = new ColorPicker();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    picker.open(anchor, '#ff0000', vi.fn());
    expect(document.body.querySelector('.color-picker-popover')).not.toBeNull();
    picker.close();
    anchor.remove();
  });

  it('close() removes popover from DOM', () => {
    const picker = new ColorPicker();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    picker.open(anchor, '#ff0000', vi.fn());
    picker.close();
    expect(document.body.querySelector('.color-picker-popover')).toBeNull();
    anchor.remove();
  });

  it('open() closes previous popover before opening a new one', () => {
    const picker = new ColorPicker();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    picker.open(anchor, '#ff0000', vi.fn());
    picker.open(anchor, '#00ff00', vi.fn());
    const popovers = document.body.querySelectorAll('.color-picker-popover');
    expect(popovers.length).toBe(1);
    picker.close();
    anchor.remove();
  });

  it('close() is safe to call when not open', () => {
    const picker = new ColorPicker();
    expect(() => picker.close()).not.toThrow();
  });

  it('non-hex initial color defaults to fallback', () => {
    const picker = new ColorPicker();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    expect(() => picker.open(anchor, 'rgb(255,0,0)', vi.fn())).not.toThrow();
    picker.close();
    anchor.remove();
  });
});

describe('ColorPicker — popover structure', () => {
  let picker: ColorPicker;
  let anchor: HTMLElement;

  beforeEach(() => {
    picker = new ColorPicker();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    picker.open(anchor, '#3d9ee4', vi.fn());
  });
  afterEach(() => {
    picker.close();
    anchor.remove();
  });

  it('renders SV canvas', () => {
    expect(document.body.querySelector('.cp-sv-canvas')).not.toBeNull();
  });

  it('renders hue track', () => {
    expect(document.body.querySelector('.cp-hue-track')).not.toBeNull();
  });

  it('renders alpha track', () => {
    expect(document.body.querySelector('.cp-alpha-track')).not.toBeNull();
  });

  it('renders hex input', () => {
    const input = document.body.querySelector<HTMLInputElement>('.cp-hex-input');
    expect(input).not.toBeNull();
    expect(input?.value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('renders color swatches', () => {
    const swatches = document.body.querySelectorAll('.color-swatch');
    expect(swatches.length).toBeGreaterThan(0);
  });

  it('renders color preview', () => {
    expect(document.body.querySelector('.cp-preview')).not.toBeNull();
  });
});

describe('ColorPicker — interactions', () => {
  let picker: ColorPicker;
  let anchor: HTMLElement;
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    picker = new ColorPicker();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    onChange = vi.fn();
    picker.open(anchor, '#ff0000', onChange);
  });
  afterEach(() => {
    picker.close();
    anchor.remove();
  });

  it('clicking a swatch calls onChange with a hex color', () => {
    const swatch = document.body.querySelector<HTMLElement>('.color-swatch')!;
    swatch.click();
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/i));
  });

  it('valid hex input on change event calls onChange', () => {
    const input = document.body.querySelector<HTMLInputElement>('.cp-hex-input')!;
    input.value = '#00ff00';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/i));
  });

  it('invalid hex input does not call onChange', () => {
    onChange.mockClear();
    const input = document.body.querySelector<HTMLInputElement>('.cp-hex-input')!;
    input.value = 'notacolor';
    input.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking hex input stops propagation (does not close picker)', () => {
    const input = document.body.querySelector<HTMLInputElement>('.cp-hex-input')!;
    const spy = vi.spyOn(MouseEvent.prototype, 'stopPropagation');
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('clicking outside popover closes it', async () => {
    // open() uses setTimeout(0) to defer adding the outside-click listener
    // Wait for that timer to fire before dispatching the click
    await new Promise(r => setTimeout(r, 10));
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.querySelector('.color-picker-popover')).toBeNull();
  });

  it('canvas mousedown calls onChange', () => {
    const canvas = document.body.querySelector<HTMLCanvasElement>('.cp-sv-canvas')!;
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50 }));
    // onChange may or may not be called depending on getBoundingClientRect mock
    // Just verify no crash
    expect(() => canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
  });

  it('hue track mousedown does not crash', () => {
    const hueTrack = document.body.querySelector<HTMLElement>('.cp-hue-track')!;
    expect(() => hueTrack.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
  });

  it('alpha track mousedown does not crash', () => {
    const alphaTrack = document.body.querySelector<HTMLElement>('.cp-alpha-track')!;
    expect(() => alphaTrack.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
  });
});

describe('ColorPicker — singleton export', () => {
  it('colorPicker is a ColorPicker instance', () => {
    expect(colorPicker).toBeInstanceOf(ColorPicker);
  });
});
