/**
 * The text a layer actually shows — every accepted content shape, one reader.
 *
 * `content` has four legal forms and the readers only knew one of them:
 *
 *   content: "Motion probe"                    ← tolerated bare scalar
 *   content: { type: plain,    value: "…" }    ← canonical
 *   content: { type: markdown, value: "…" }
 *   content: { type: rich,     spans: [{text}] }  ← no `value` at all
 *
 * Five separate call sites had written `content?.value` inline, so a layer in
 * the first or last form read back as the EMPTY STRING. The renderer draws
 * both of those perfectly well, which is what made it hard to see: the design
 * looked right and the checks quietly did nothing.
 *
 * The damage was not only the false "text slot is EMPTY" note telling a model
 * to fill copy that was already written. `measureTextLayer` bailed on an empty
 * string, so those layers got NO overflow or autofit check, and the
 * low-contrast pass skipped them outright — invisible text shipped unflagged.
 * Spatial correctness is the engine's job; it cannot do that job on text it
 * cannot read.
 */

interface RichSpan { text?: unknown }

/** The visible text of a layer, whichever content form it uses. '' if none. */
export function layerText(layer: unknown): string {
  const content = (layer as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (content == null || typeof content !== 'object') return '';

  const c = content as { value?: unknown; spans?: unknown };
  if (typeof c.value === 'string') return c.value;

  // Rich text carries its words in spans and has no `value` at all.
  if (Array.isArray(c.spans)) {
    return (c.spans as RichSpan[])
      .map(s => (typeof s?.text === 'string' ? s.text : ''))
      .join('');
  }
  return '';
}

/** Does this layer show any non-whitespace text? */
export function hasLayerText(layer: unknown): boolean {
  return layerText(layer).trim().length > 0;
}
