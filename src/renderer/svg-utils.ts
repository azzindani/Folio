const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Ids for generated defs (gradients, filters, patterns, clips) are derived from
 * what the def CONTAINS — never from how many were minted before it.
 *
 * They used to come from a module-level counter that nothing in production ever
 * reset, so the same unchanged design exported as `lg-1 noise-2 noise-3` on one
 * call and `lg-4 noise-5 noise-6` on the next: three different files, identical
 * pixels. A `resetDefIdCounter` existed and was called by nine TEST files and
 * zero production ones — the tests reset it in beforeEach so their own ids
 * were stable, which is exactly why none of them could see the drift.
 *
 * Resetting per render was not the fix either. presentation-assembler and
 * html-assembler join many pages into ONE html document, so every slide would
 * have restarted at `lg-1` and `url(#lg-1)` resolves to the FIRST match in the
 * document — slide 5 would quietly paint with slide 1’s gradient.
 *
 * Content-derived ids solve both: the same design always produces the same ids,
 * and two slides sharing a gradient share an id whose definition is byte
 * identical, so resolving to either is correct.
 */

/** FNV-1a, 32-bit. Deliberately not node’s crypto: this module also runs in
 *  the browser, where the editor renders the same designs. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Append a def unless one with the same id is already in this <defs>.
 *
 * Content-derived ids mean two layers sharing a gradient now build the SAME id,
 * so without this the document would carry two identical elements under one id
 * — invalid, and pointlessly larger. Skipping the duplicate is also a real
 * saving: a poster whose every card uses one accent gradient now defines it
 * once instead of once per card.
 */
export function appendDefOnce(defs: SVGDefsElement, el: SVGElement): void {
  const id = el.getAttribute('id');
  if (id) {
    for (const child of Array.from(defs.children)) {
      if (child.getAttribute('id') === id) return;
    }
  }
  defs.appendChild(el);
}

/** A def id that depends only on the def’s own content. */
export function defIdFor(prefix: string, content: unknown): string {
  const key = typeof content === 'string' ? content : JSON.stringify(content) ?? String(content);
  return `${prefix}-${fnv1a(key)}`;
}

export function createSVGElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | undefined>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        el.setAttribute(key, String(value));
      }
    }
  }
  return el;
}

export function createSVGRoot(width: number, height: number): SVGSVGElement {
  return createSVGElement('svg', {
    xmlns: SVG_NS,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
}

export function getOrCreateDefs(svg: SVGSVGElement): SVGDefsElement {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = createSVGElement('defs');
    svg.prepend(defs);
  }
  return defs;
}
