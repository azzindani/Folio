/**
 * Time by name — markers and relative times for the composition ops.
 *
 * A 30 s piece timed in raw milliseconds is brittle for a model: move the hook
 * 400 ms later and every number after it is wrong. Here a time can be a
 * marker ("problem"), a layer's in/out point or track ("title.out",
 * "card.end"), or either with an offset ("problem+200", "title.end-150").
 * They resolve to milliseconds when an op writes — After Effects' markers
 * label the timeline, they do not drive it — so both players keep reading
 * plain numbers.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { AnimationSpec, TimeMarkers } from '../../animation/types';
import { trackEnd } from './motion-merge';

export interface TimeContext { markers: TimeMarkers; layers: Layer[] }

// The name is matched lazily so "cta-200" reads as the marker "cta" minus 200 ms
// while "stat-1.end" still names the layer "stat-1". Marker names may not end in
// -digits (usableMarkerName), so a bare name is never ambiguous.
const REF = /^\s*(?:(-?\d+(?:\.\d+)?)|([A-Za-z_][\w-]*?)(?:\.(in|out|start|end))?)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?\s*$/;

/** A marker (or shot) name a time can refer to without ambiguity. */
export function usableMarkerName(name: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(name) && !/-\d+(?:\.\d+)?$/.test(name);
}

/** Where a scope's markers live: its page, else a deck's first page, else the poster root. */
export function markerHost(spec: DesignSpec, page?: Page): { markers?: TimeMarkers } {
  return page ?? spec.pages?.[0] ?? spec;
}

export function readMarkers(spec: DesignSpec, page?: Page): TimeMarkers {
  const m = markerHost(spec, page).markers;
  return m && typeof m === 'object' ? { ...m } : {};
}

export function writeMarkers(spec: DesignSpec, page: Page | undefined, markers: TimeMarkers): void {
  const host = markerHost(spec, page);
  if (Object.keys(markers).length === 0) delete host.markers;
  else host.markers = Object.fromEntries(Object.entries(markers).sort((a, b) => a[1] - b[1]));
}

function findLayer(layers: Layer[], id: string): Layer | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    const hit = Array.isArray(kids) ? findLayer(kids, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/**
 * A time reference in ms, or a sentence saying why it cannot be read.
 * Accepts a number, a numeric string, `marker`, `layer.in|out|start|end`,
 * each optionally `+ms` / `-ms`. Never below 0.
 */
export function resolveTime(ref: unknown, ctx: TimeContext): number | string {
  if (typeof ref === 'number') return Number.isFinite(ref) ? Math.max(0, Math.round(ref)) : `${ref} is not a time.`;
  if (typeof ref !== 'string') return 'A time is a number of ms or a name like "hook", "hook+200", "title.out", "card.end-150".';
  const exact = ctx.markers[ref.trim()];
  if (exact !== undefined) return Math.max(0, Math.round(exact));
  const m = REF.exec(ref);
  if (!m) return `"${ref}" is not a time: use ms, a marker ("hook+200"), or a layer point ("title.in", "title.out", "card.start", "card.end").`;
  const [, digits, name, prop, sign, amount] = m;
  let base: number;
  if (digits !== undefined) base = Number(digits);
  else if (!prop) {
    const hit = ctx.markers[name ?? ''];
    if (hit === undefined) {
      const known = Object.keys(ctx.markers);
      return `No marker "${name}".${known.length ? ` Markers: ${known.join(', ')}.` : ' Set one with animation(op:markers).'} A layer's time needs .in, .out, .start or .end.`;
    }
    base = hit;
  } else {
    const layer = findLayer(ctx.layers, name ?? '') as (Layer & { animation?: AnimationSpec; in?: number; out?: number }) | undefined;
    if (!layer) return `No layer "${name}" for "${ref}".`;
    if (prop === 'in') base = layer.in ?? 0;
    else if (prop === 'out') {
      if (typeof layer.out !== 'number') return `"${name}" has no out point — set one with animation(op:span), or use ${name}.end (when its motion ends).`;
      base = layer.out;
    } else if (!layer.animation?.keyframes?.length) return `"${name}" has no motion, so it has no ${prop}.`;
    else base = prop === 'start' ? Math.max(0, layer.animation.playback?.delay ?? 0) : trackEnd(layer.animation);
  }
  const off = amount !== undefined ? Number(amount) * (sign === '-' ? -1 : 1) : 0;
  return Math.max(0, Math.round(base + off));
}
