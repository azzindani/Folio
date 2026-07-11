// Pure layer/spec predicates split out of engine-layer-tools.ts to hold that
// file under the 700-line budget. Re-exported from engine-layer-tools so all
// existing import sites keep working.

import type { DesignSpec, Layer } from '../schema/types';
import { ALL_THEMES } from '../themes/all-themes';

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Resolve a design's theme background + text to hex, for reconciling a preset's
 * content-seeded mood against the chosen theme (see seededDefaults). Handles an
 * inline `theme.colors` object and a builtin `theme.ref`; returns null when the
 * theme is absent or its background isn't a usable hex (custom project themes,
 * `$token` backgrounds → no override, mood stays in charge).
 */
export function resolveThemeColors(spec: DesignSpec): { bg: string; text: string } | null {
  const th = spec.theme as { ref?: string; colors?: Record<string, unknown> } | undefined;
  if (!th) return null;
  const colors = th.colors ?? (th.ref ? (ALL_THEMES[th.ref]?.colors as Record<string, unknown> | undefined) : undefined);
  if (!colors) return null;
  const bg = colors['background'];
  if (typeof bg !== 'string' || !HEX_RE.test(bg)) return null;
  const text = colors['text'];
  return { bg, text: typeof text === 'string' && HEX_RE.test(text) ? text : '' };
}

// Does a layer paint the whole canvas? A `rect` filled (hex / $token / `color:`)
// covering ≥90% at the origin, OR a `background`/`backdrop` type (the renderer
// fills the page with its fill regardless of dims). Mirrors design-lint's detector.
export function isFullCanvasBgRect(l: Layer, W: number, H: number): boolean {
  const o = l as unknown as Record<string, unknown>;
  const t = o['type'];
  const okStr = (s: unknown): boolean => typeof s === 'string' && s.trim() !== '' && s !== 'none' && s !== 'transparent';
  const f = o['fill'];
  let hasFill = false;
  if (typeof f === 'string') hasFill = okStr(f);
  else if (f && typeof f === 'object') {
    const fo = f as Record<string, unknown>;
    // a solid `fill.color`, OR a GRADIENT / pattern (stops[] or a fill `type`) — all
    // paint the canvas. Missing the gradient case made a composed-bg preset read as
    // "no backdrop" → a redundant auto-bg got stacked on it.
    hasFill = okStr(fo['color']) || Array.isArray(fo['stops']) || typeof fo['type'] === 'string';
  }
  if (!hasFill) hasFill = okStr(o['color']);                   // bare `color:` fallback
  if (!hasFill) return false;
  if (t === 'background' || t === 'backdrop') return true;     // renderer fills the page
  if (t !== 'rect') return false;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0, w = Number(o['width']) || 0, h = Number(o['height']) || 0;
  return x <= 2 && y <= 2 && w * h >= W * H * 0.9;
}

// Any full-canvas backdrop present (recurses ONE level into groups — a preset wraps
// its bg rect in its group, marble_bg/backdrop too).
export function hasFullCanvasBackdrop(layers: Layer[], W: number, H: number): boolean {
  for (const l of layers) {
    if (isFullCanvasBgRect(l, W, H)) return true;
    const kids = (l as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) if (isFullCanvasBgRect(k, W, H)) return true;
  }
  return false;
}

// Is there anything worth grounding — real text, an image, icon, chart? (Don't paint
// a ground onto a literally-empty scaffold; that's a different, model-side problem.)
export function hasRenderableContent(layers: Layer[]): boolean {
  for (const l of layers) {
    const t = l?.type;
    if (t === 'text' || t === 'rich_text') {
      const c = (l as unknown as Record<string, unknown>)['content'];
      const v = typeof c === 'string' ? c : (c && typeof c === 'object' ? (c as Record<string, unknown>)['value'] : '');
      if (typeof v === 'string' && v.trim()) return true;
    } else if (t === 'image' || t === 'icon' || t === 'chart' || t === 'kpi_card' || t === 'mermaid') {
      return true;
    }
    const kids = (l as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids) && hasRenderableContent(kids as Layer[])) return true;
  }
  return false;
}
