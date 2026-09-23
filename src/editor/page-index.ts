/**
 * The page to show for a requested 0-based index, or undefined to stay put.
 *
 * The MCP's open_url links carry ?page=N and the editor opened every one on
 * the first page; an MCP edit reloaded the design and threw the viewer back to
 * page 1 as well. Both now go through this: a page the design has is shown,
 * anything else (missing, out of range, not a whole number) is not.
 */
export function pageToShow(index: number | undefined, pageCount: number): number | undefined {
  return index !== undefined && Number.isInteger(index) && index > 0 && index < pageCount ? index : undefined;
}
