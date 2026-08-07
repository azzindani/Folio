import { describe, it, expect, afterEach, vi } from 'vitest';
import { sc, modKey, altKey, shiftKey, resetPlatformCache } from './shortcut';

function pretendPlatform(platform: string, ua = 'Mozilla/5.0'): void {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  resetPlatformCache();
}

afterEach(() => { vi.restoreAllMocks(); resetPlatformCache(); });

describe('platform-correct shortcut labels', () => {
  it('spells modifiers out on Windows and Linux', () => {
    pretendPlatform('Win32');
    expect(modKey()).toBe('Ctrl');
    expect(altKey()).toBe('Alt');
    expect(shiftKey()).toBe('Shift');
    expect(sc('⌘K')).toBe('Ctrl+K');
    expect(sc('⌘⇧L')).toBe('Ctrl+Shift+L');
    expect(sc('⇧H')).toBe('Shift+H');
    pretendPlatform('Linux x86_64');
    expect(sc('⌘0')).toBe('Ctrl+0');
  });

  it('keeps the glyphs on a Mac, where they are what the keycaps say', () => {
    pretendPlatform('MacIntel');
    expect(modKey()).toBe('⌘');
    expect(sc('⌘⇧G')).toBe('⌘⇧G');
    expect(sc('⌥')).toBe('⌥');
  });

  it('treats iPadOS (which reports MacIntel) and iPhone as Mac', () => {
    pretendPlatform('iPhone');
    expect(modKey()).toBe('⌘');
  });

  it('orders modifiers conventionally, not in the order they were written', () => {
    pretendPlatform('Win32');
    expect(sc('⇧⌘D')).toBe('Ctrl+Shift+D');
    expect(sc('⌥⌘]')).toBe('Ctrl+Alt+]');
  });

  it('handles a bare key and a bare modifier without leaving a stray +', () => {
    pretendPlatform('Win32');
    expect(sc('V')).toBe('V');
    expect(sc('⌘')).toBe('Ctrl');
  });
});
