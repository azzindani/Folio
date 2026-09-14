/**
 * The `count` channel — a figure that counts up to what the text says.
 *
 * `count` is the FRACTION of the written number showing: 0 counts from zero,
 * 1 is the text as authored. So a preset counts any figure without knowing it,
 * and the number keeps its own format — "$4.2M" counts in tenths, "1,250+"
 * keeps its separator and its plus, "Save 40% today" counts only the 40.
 */

export interface CountTemplate {
  prefix: string;
  value: number;
  decimals: number;
  /** Written with thousands separators. */
  grouped: boolean;
  suffix: string;
}

const NUMBER = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/;

/** The first number in a text and what surrounds it, or null when there is none. */
export function countTemplate(text: string): CountTemplate | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const raw = m[0];
  const dot = raw.indexOf('.');
  return {
    prefix: text.slice(0, m.index),
    value: Number(raw.replace(/,/g, '')),
    decimals: dot >= 0 ? raw.length - dot - 1 : 0,
    grouped: raw.includes(','),
    suffix: text.slice(m.index + raw.length),
  };
}

/**
 * The text at a count fraction, in the written number's own format. Clamped to
 * 0..1: an overshooting curve lands on the figure instead of passing it.
 */
export function countText(text: string, fraction: number): string {
  const tpl = countTemplate(text);
  if (!tpl) return text;
  const fixed = (tpl.value * Math.max(0, Math.min(1, fraction))).toFixed(tpl.decimals);
  const [whole = '0', frac] = fixed.split('.');
  const digits = tpl.grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${tpl.prefix}${digits}${frac !== undefined ? `.${frac}` : ''}${tpl.suffix}`;
}
