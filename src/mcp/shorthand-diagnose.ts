// Folio shorthand parser — diagnostics: key/overlap checks + context compression. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer } from '../schema/types';
import { resolveIconName } from '../renderer/lucide-icons';

import { ShorthandLayer, Box } from './shorthand-helpers';

export const KNOWN_SHORTHAND_KEYS = new Set<string>([
  // engine-internal markers (set by the engine, not the model — never flagged)
  '__fillPage', '__variant', '__deckseed',
  // canonical
  'id', 'type', 'z', 'pos', 'x', 'y', 'width', 'height', 'opacity', 'rotation',
  'flip_h', 'flip_v', 'visible', 'locked', 'fill', 'stroke', 'radius', 'text',
  'font', 'size', 'weight', 'color', 'align', 'text_decoration', 'src', 'fit',
  'alt', 'icon', 'icon_size', 'name', 'd', 'sides', 'x1', 'y1', 'x2', 'y2',
  'definition', 'code', 'language', 'expression', 'layers',
  // typography craft
  'line_height', 'letter_spacing', 'lh', 'leading', 'track', 'tracking',
  // auto_layout / container
  'direction', 'gap', 'padding', 'justify', 'wrap', 'repeat', 'children', 'valign',
  'corner_radius', 'cornerRadius', 'borderRadius',
  // chart / kpi_card / component
  'chart', 'data', 'spec', 'value', 'label', 'delta', 'format', 'ref', 'slots', 'variant', 'overrides',
  // feature_grid preset
  'items', 'features', 'title', 'subtitle', 'card_fill', 'accent', 'text_color', 'muted', 'bg', 'columns',
  'preset', 'bg_gradient', 'benefit',
  // decor / marble_bg / backdrop preset
  'palette', 'corners', 'intensity', 'veins', 'rings', 'dots', 'style',
  // rich engine-composed background (composeBackground)
  'bg_style', 'background_style', 'bg_treatment', 'bg_image', 'photo', 'bg_photo',
  // editorial / split / list layout presets
  'kicker', 'eyebrow', 'headline', 'lede', 'deck', 'body', 'desc', 'footer',
  'side', 'ratio', 'panel', 'panel_fill', 'panel_label', 'panel_text', 'big',
  'marker', 'heading', 'description', 'cards',
  'stat', 'number', 'caption',
  'details', 'lines', 'info', 'date', 'venue', 'location', 'place', 'time', 'when', 'where',
  'blocks', 'sections', 'kind', 'cite', 'author', 'source', 'quote',
  // pattern / image fills (WS1)
  'pattern', 'fg', 'mode', 'tile_size', 'foreground', 'background',
  // parametric shapes (WS2)
  'points', 'inner_ratio', 'lobes', 'seed', 'cycles', 'amplitude', 'start', 'end',
  'thickness', 'teeth', 'hole',
  // typography craft (WS3)
  'transform', 'text_transform', 'uppercase', 'italic', 'font_style', 'underline',
  'decoration', 'variation', 'font_variation_settings', 'features', 'font_feature_settings',
  'outline', 'outline_color', 'outline_width', 'text_stroke', 'highlight', 'curve',
  'text_path', 'word_spacing',
  // per-style title treatment (highlight/underline/mega/rotate/rule)
  'headline_style', 'type_treatment',
  // decorative motif / illustration (fills negative space)
  'motif', 'shape',
  // aliases (verbose + terse)
  'content', 'font_size', 'fontSize', 'symbol', 'glyph', 'url', 'href', 'link',
  't', 'p', 'f', 'w', 'h', 'col', 'c', 's',
]);

// Flag shorthand keys the expander doesn't recognize (so they aren't silently
// dropped — the failure mode where a model sends {t:"text"} and gets a rect).
// Runs on the raw coerced shorthand, before expansion.

export function diagnoseShorthandKeys(raw: ShorthandLayer[]): string[] {
  const notes: string[] = [];
  raw.forEach((sh, i) => {
    if (!sh || typeof sh !== 'object') return;
    const unknown = Object.keys(sh).filter(k => !KNOWN_SHORTHAND_KEYS.has(k));
    if (unknown.length) notes.push(`layer "${sh.id ?? i}": unrecognized field(s) [${unknown.join(', ')}] were ignored. Text fields: text, font, size, weight, color, align, line_height (lh), letter_spacing (track). Box fields: pos, type, fill, stroke, radius, icon, src.`);
  });
  return notes;
}

// A few popular icon names to offer when a model picks one that doesn't exist.

export const SUGGESTED_ICONS = 'image, star, heart, check, arrow-right, user, mail, calendar, clock, zap, award, map-pin, phone, shopping-cart';

// Resolve a layer's bounding box from either pos:[x,y,w,h] or x/y/width/height.
// Returns null when any component is non-numeric (e.g. width:"auto") — we can't
// reason about overlap without a concrete box.

export function layerBox(l: Layer): Box | null {
  const a = l as Layer & { pos?: unknown; x?: number; y?: number; width?: number | 'auto'; height?: number | 'auto' };
  if (Array.isArray(a.pos) && a.pos.length === 4 && a.pos.every(n => typeof n === 'number')) {
    const [x, y, w, h] = a.pos as number[];
    return { x, y, w, h };
  }
  if (typeof a.x === 'number' && typeof a.y === 'number' && typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: a.x, y: a.y, w: a.width, h: a.height };
  }
  return null;
}

export function overlapRatio(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 ? inter / minArea : 0;
}

// Detect hand-placed TOP-LEVEL text layers whose boxes collide. Overlapping
// text is almost never intentional — it renders as an illegible pile (the
// classic small-model failure: hand-placing N card headings at the same spot).
// We check only top-level text siblings (shared canvas coords); container
// children are positioned by the engine and must not be flagged. Returns one
// note that steers toward the preset / container that owns layout.

export function detectTextOverlap(layers: Layer[]): string | null {
  const boxed = layers
    .filter(l => l.type === 'text')
    .map(l => ({ id: l.id, box: layerBox(l) }))
    .filter((t): t is { id: string; box: Box } => t.box !== null);
  const colliding = new Set<string>();
  for (let i = 0; i < boxed.length; i++) {
    for (let j = i + 1; j < boxed.length; j++) {
      if (overlapRatio(boxed[i].box, boxed[j].box) >= 0.35) {
        colliding.add(boxed[i].id);
        colliding.add(boxed[j].id);
      }
    }
  }
  if (colliding.size < 2) return null;
  const ids = [...colliding];
  const shown = ids.slice(0, 6).join(', ') + (ids.length > 6 ? '…' : '');
  return `${ids.length} text layers overlap (${shown}) — hand-placed coordinates collide, so they render on top of each other illegibly. For cards/columns/rows DON'T hand-place x/y: use the feature_grid preset ({type:"feature_grid", title, subtitle, items:[{icon,title,desc}]}) or a row/column container — the engine spaces them with no overlap.`;
}

// Inspect expanded layers for things that render but not the way the model
// likely intended — an unknown icon name (→ placeholder), a local image src
// (renders only if the asset exists), or empty text. Returns one actionable
// note per issue so a tool response can direct the model's next call. This is
// the self-correction signal for the multi-tool loop: the design still saves,
// and the model is told exactly what to fix.

export function diagnoseLayers(layers: Layer[]): string[] {
  const notes: string[] = [];
  const walk = (ls: Layer[] | undefined): void => {
    for (const l of ls ?? []) {
      if (l.type === 'icon') {
        const name = (l as Layer & { name?: string }).name ?? '';
        const hit = resolveIconName(name);
        if (!hit) notes.push(`icon "${l.id}": "${name}" is not a known icon → renders as a blank fallback circle. Use a real name, e.g.: ${SUGGESTED_ICONS}.`);
      } else if (l.type === 'image') {
        const src = (l as Layer & { src?: string }).src ?? '';
        if (src && !/^(https?:|data:|file:|\/\/)/i.test(src)) {
          notes.push(`image "${l.id}": src "${src}" is a local file — it renders only if that asset exists in the project, else a placeholder frame shows. Use an https:// URL, or replace the photo with a fill/gradient/shape/icon you can render directly.`);
        }
      } else if (l.type === 'text') {
        const v = (l as Layer & { content?: { value?: string } }).content?.value;
        if (typeof v === 'string' && v.trim() === '') notes.push(`text "${l.id}": value is empty — put the copy in the "content" (or "text") field.`);
        // A model that picked feature_grid but encoded it as a flat string lands
        // here as one text layer holding the raw DSL ("…items=icon=…:title=…").
        // Tell it the JSON shape so the next call is a real preset, not a blob.
        else if (typeof v === 'string' && (/\bitems\s*=/.test(v) || (/\btitle\s*=/.test(v) && /\bdesc\s*=/.test(v)) || /^\s*feature_grid\s*:/.test(v))) {
          notes.push(`text "${l.id}": the content looks like a feature_grid encoded as a string. Send it as a JSON object, not a colon/equals string: {type:"feature_grid", title:"…", subtitle:"…", bg:"gradient", items:[{icon:"…", title:"…", desc:"…"}]}.`);
        }
      }
      // Recurse into ANY nested container — group, auto_layout, feature_grid
      // cards… — not just `group`. Presets nest their icons and text inside
      // auto_layout rows, so a group-only walk silently skipped them and an
      // unknown icon (which renders as a placeholder box a blind model can't
      // see) went unwarned.
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(layers);
  const overlap = detectTextOverlap(layers);
  if (overlap) notes.unshift(overlap);
  return notes;
}

/**
 * Context compression for local LLMs
 * Returns a minimal summary of a design for feeding to LLMs with tight context windows.
 */

export function compressDesignContext(spec: {
  meta?: { name: string; type: string };
  pages?: { id: string; label?: string }[];
  theme?: { ref: string };
  layers?: { id: string; type: string }[];
}): string {
  const parts: string[] = [];
  parts.push(`Design: ${spec.meta?.name ?? 'Untitled'} (${spec.meta?.type ?? 'unknown'})`);

  if (spec.theme?.ref) {
    parts.push(`Theme: ${spec.theme.ref}`);
  }

  if (spec.pages && spec.pages.length > 0) {
    const pageNames = spec.pages.map(p => p.label ?? p.id).join(', ');
    parts.push(`Completed: [${pageNames}]`);
    parts.push(`Next: page ${spec.pages.length + 1}`);
  }

  if (spec.layers) {
    const layerSummary = spec.layers.map(l => `${l.id}(${l.type})`).join(', ');
    parts.push(`Layers: [${layerSummary}]`);
  }

  return parts.join('. ');
}
