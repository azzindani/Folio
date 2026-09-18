/**
 * A marker (or shot) name a time can refer to without ambiguity: letters,
 * digits, _ and -, starting with a letter or _, and not ending in -digits —
 * "cta-200" must read as the marker "cta" minus 200 ms. The MCP's time refs
 * and the editor's marker strip both check names here.
 */
export function usableMarkerName(name: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(name) && !/-\d+(?:\.\d+)?$/.test(name);
}
