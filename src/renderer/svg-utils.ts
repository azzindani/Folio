const SVG_NS = 'http://www.w3.org/2000/svg';

let defIdCounter = 0;

export function uniqueDefId(prefix: string): string {
  return `${prefix}-${++defIdCounter}`;
}

export function resetDefIdCounter(): void {
  defIdCounter = 0;
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
